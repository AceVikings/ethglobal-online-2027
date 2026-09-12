#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { keccak256, toUtf8Bytes } = require('ethers')
const {
  BYTES32, ENTITY_ID, EVM_ADDRESS, assertMatch, executeRequested, loadConfig,
  loadReasonerConfig, createHoldReader, createClearingEscrowAdapter,
  hederaEvmSigner, mirrorContractResult, assertRestrictedTopic, createPaidFetch, buyVerdict,
  submitHcsMessage, createReasoner, runClearingTrade, verifyClearingAuthorization,
  output, run, required,
} = require('./lib/common.cjs')

const UINT = /^\d+$/

function positiveUint(env, key, fallback) {
  const value = env[key] || fallback
  if (!value || !UINT.test(value) || BigInt(value) <= 0n) throw new Error(`Invalid ${key}`)
  return value
}

function pinnedArtifact(artifact, artifactKey, envKey, pattern, label = envKey) {
  const value = assertMatch(required(artifact, artifactKey), pattern, `ATS hold ${artifactKey}`)
  const pinned = assertMatch(required(process.env, envKey), pattern, envKey)
  if (value.toLowerCase() !== pinned.toLowerCase()) throw new Error(`ATS hold ${artifactKey} does not match ${envKey}`)
  return value
}

function stateStore(filename) {
  return {
    load() {
      if (!fs.existsSync(filename)) return null
      return JSON.parse(fs.readFileSync(filename, 'utf8'))
    },
    save(state) {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      const temporary = `${filename}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, filename)
    },
  }
}

async function waitForMirror(config, transactionHash) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await mirrorContractResult(config, transactionHash)
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Mirror Node did not index settlement ${transactionHash}`)
}

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const explanationConfigured = Boolean(process.env.DEEPSEEK_API_KEY)
  const reasonerConfig = explanationConfigured ? loadReasonerConfig(process.env) : null
  const request = {
    standard: 'messari/lending-v3.1',
    subject: {
      protocol: process.env.PROTOCOL || 'aave-v3',
      network: process.env.SUBJECT_NETWORK || 'ethereum',
      deploymentId: process.env.DEPLOYMENT_ID || '<DEPLOYMENT_ID>',
    },
    policy: { pinnedCid: process.env.PINNED_CID || null, lagBoundBlocks: Number(process.env.LAG_BOUND_BLOCKS || 50) },
  }
  const holdFile = path.resolve(process.cwd(), process.env.ATS_HOLD_FILE || '.context/ats-hold.json')
  const holdArtifact = fs.existsSync(holdFile) ? JSON.parse(fs.readFileSync(holdFile, 'utf8')) : {}
  const trade = {
    chainId: Number(process.env.HEDERA_CHAIN_ID || 296),
    verifyingContract: process.env.CLEARING_ESCROW_ADDRESS || holdArtifact.escrow || '<CLEARING_ESCROW_ADDRESS>',
    security: holdArtifact.security || process.env.ATS_SECURITY_EVM_ADDRESS || '<ATS_SECURITY_EVM_ADDRESS>',
    partition: holdArtifact.partition || process.env.ATS_PARTITION || `0x${'0'.repeat(63)}1`,
    seller: holdArtifact.seller || process.env.SELLER_EVM_ADDRESS || '<SELLER_EVM_ADDRESS>',
    buyer: holdArtifact.buyer || process.env.BUYER_EVM_ADDRESS || '<BUYER_EVM_ADDRESS>',
    amount: holdArtifact.amount || process.env.TRADE_AMOUNT || '1',
    holdId: holdArtifact.holdId || process.env.ATS_HOLD_ID || '<ATS_HOLD_ID>',
    holdExpiry: holdArtifact.holdExpiry || process.env.ATS_HOLD_EXPIRY || '<ATS_HOLD_EXPIRY>',
    policyHash: process.env.POLICY_HASH || '<POLICY_HASH>',
  }
  const flow = [
    'observe exact ATS hold',
    'buy one x402 action-bound verdict',
    'verify signature and immutable trade fields',
    'submit APPROVE/execute or DENY/release to ClearingEscrow',
    'confirm contract, ATS, and Mirror state',
    'anchor audit without changing settlement truth',
  ]
  const preview = { request: { ...request, trade }, trade, holdFile, expectedSigner: process.env.CONFORMANCE_EXPECTED_SIGNER || '<CONFORMANCE_EXPECTED_SIGNER>' }
  if (!execute) return output({
    mode: 'dry-run', serviceUrl: config.serviceUrl, x402Network: config.x402Network,
    explanation: reasonerConfig ? { enabled: true, model: reasonerConfig.model } : { enabled: false },
    flow, preview,
  })

  if (!fs.existsSync(holdFile)) throw new Error('ATS_HOLD_FILE is required for live clearing')
  const topicId = assertMatch(required(process.env, 'HCS_TOPIC_ID'), ENTITY_ID, 'HCS_TOPIC_ID')
  await assertRestrictedTopic(config, topicId)
  trade.verifyingContract = pinnedArtifact(holdArtifact, 'escrow', 'CLEARING_ESCROW_ADDRESS', EVM_ADDRESS)
  trade.security = pinnedArtifact(holdArtifact, 'security', 'ATS_SECURITY_EVM_ADDRESS', EVM_ADDRESS)
  trade.partition = pinnedArtifact(holdArtifact, 'partition', 'ATS_PARTITION', BYTES32)
  trade.seller = pinnedArtifact(holdArtifact, 'seller', 'SELLER_EVM_ADDRESS', EVM_ADDRESS)
  trade.buyer = pinnedArtifact(holdArtifact, 'buyer', 'BUYER_EVM_ADDRESS', EVM_ADDRESS)
  // ATS accepts human units when creating a hold but its on-chain read returns
  // base units. Settlement must bind the exact raw values from that read.
  trade.amount = positiveUint(holdArtifact, 'amount')
  trade.holdId = positiveUint(holdArtifact, 'holdId')
  trade.holdExpiry = positiveUint(holdArtifact, 'holdExpiry')
  trade.policyHash = assertMatch(required(process.env, 'POLICY_HASH'), BYTES32, 'POLICY_HASH')
  if (!process.env.DEPLOYMENT_ID) {
    const { requireDeployment } = await import('@desk/signal')
    request.subject.deploymentId = requireDeployment(request.subject.protocol, request.subject.network).deploymentId
  } else {
    request.subject.deploymentId = process.env.DEPLOYMENT_ID
  }

  const relayer = hederaEvmSigner(config)
  const hold = createHoldReader(relayer.provider, trade.security)
  const escrow = createClearingEscrowAdapter(relayer, trade.verifyingContract)
  const expectedPayTo = assertMatch(required(process.env, 'X402_PAY_TO'), ENTITY_ID, 'X402_PAY_TO')
  const privyConfigured = Boolean(
    process.env.PRIVY_APP_ID || process.env.PRIVY_APP_SECRET ||
    process.env.PRIVY_WALLET_ID || process.env.PRIVY_HEDERA_ACCOUNT_ID,
  )
  let paymentAccountId = config.operatorId
  let paymentSigner
  if (privyConfigured) {
    const { PrivyClient, createPrivyBackedHederaSigner } = await import('@desk/privy-hedera-poc')
    const client = new PrivyClient({
      appId: required(process.env, 'PRIVY_APP_ID'),
      appSecret: required(process.env, 'PRIVY_APP_SECRET'),
    })
    const wallet = await client.getWallet(required(process.env, 'PRIVY_WALLET_ID'))
    paymentAccountId = assertMatch(
      required(process.env, 'PRIVY_HEDERA_ACCOUNT_ID'), ENTITY_ID, 'PRIVY_HEDERA_ACCOUNT_ID',
    )
    paymentSigner = await createPrivyBackedHederaSigner({
      accountId: paymentAccountId,
      wallet,
      client,
      network: config.x402Network,
    })
  }
  const paidFetch = await createPaidFetch({
    accountId: paymentAccountId,
    ...(paymentSigner ? { signer: paymentSigner } : { privateKey: config.operatorKey }),
    network: config.x402Network,
    expectedPayTo, expectedAsset: config.usdcTokenId, expectedFeePayer: config.x402FeePayer,
    maxAmountPerPayment: `$${config.x402PriceUsd}`,
  })
  const reasonVerdict = reasonerConfig ? createReasoner(reasonerConfig) : undefined
  const store = stateStore(path.resolve(process.cwd(), process.env.CARETAKER_STATE_FILE || '.context/caretaker-state.json'))

  const result = await runClearingTrade({ request, trade, expectedSigner: config.expectedSigner }, {
    expectedSigner: config.expectedSigner,
    observeHold: async () => {
      const [record, balances] = await Promise.all([
        hold.get({ partition: trade.partition, seller: trade.seller, holdId: trade.holdId }),
        hold.balances({ seller: trade.seller, buyer: trade.buyer }),
      ])
      return { ...record, balances, ...(holdArtifact.createdAt ? { createdAt: holdArtifact.createdAt } : {}) }
    },
    buyVerdict: (body) => buyVerdict({ url: config.serviceUrl, body, paidFetch }),
    paymentReferenceHash: (paymentTxId) => keccak256(toUtf8Bytes(paymentTxId)),
    verifyAuthorization: verifyClearingAuthorization,
    reasonVerdict,
    isNonceUsed: (nonce) => escrow.isNonceUsed(nonce),
  async submitSettlement(authorization, signature) {
      const tradeDigest = await escrow.hashAuthorization(authorization)
      const transaction = await escrow.settle(authorization, signature)
      const receipt = await transaction.wait()
      return { transactionHash: receipt.hash, tradeDigest }
    },
    async confirmSettlement({ hold: observed, authorization, expectedLifecycle, submitted }) {
      if (!await escrow.isNonceUsed(authorization.nonce)) return { confirmed: false }
      const event = submitted?.transactionHash ? submitted : await escrow.findSettlement(authorization)
      if (!event?.transactionHash) return { confirmed: false }
      const mirror = await waitForMirror(config, event.transactionHash)
      const remaining = await hold.get({ partition: trade.partition, seller: trade.seller, holdId: trade.holdId })
      if (remaining && BigInt(remaining.amount) > 0n) return { confirmed: false }
      const after = await hold.balances({ seller: trade.seller, buyer: trade.buyer })
      const amount = BigInt(authorization.amount)
      const sellerBefore = BigInt(observed.balances.seller)
      const buyerBefore = BigInt(observed.balances.buyer)
      const balancesMatch = authorization.action === 1
        ? BigInt(after.seller) === sellerBefore - amount && BigInt(after.buyer) === buyerBefore + amount
        : BigInt(after.seller) === sellerBefore && BigInt(after.buyer) === buyerBefore
      if (!balancesMatch) return { confirmed: false }
      return {
        confirmed: true, lifecycle: expectedLifecycle,
        transactionHash: event.transactionHash,
        transactionId: mirror.transaction_id,
        tradeDigest: event.tradeDigest || submitted?.tradeDigest, balances: { before: observed.balances, after },
      }
    },
    anchorAudit: (message) => submitHcsMessage(config, topicId, message),
    saveState: (state) => store.save(state),
  }, store.load())
  output({ mode: 'execute', stateFile: process.env.CARETAKER_STATE_FILE || '.context/caretaker-state.json', result })
})
