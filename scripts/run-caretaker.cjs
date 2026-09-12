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
    security: process.env.ATS_SECURITY_EVM_ADDRESS || holdArtifact.security || '<ATS_SECURITY_EVM_ADDRESS>',
    partition: process.env.ATS_PARTITION || holdArtifact.partition || `0x${'0'.repeat(63)}1`,
    seller: process.env.SELLER_EVM_ADDRESS || holdArtifact.seller || '<SELLER_EVM_ADDRESS>',
    buyer: process.env.BUYER_EVM_ADDRESS || holdArtifact.buyer || '<BUYER_EVM_ADDRESS>',
    amount: process.env.TRADE_AMOUNT || holdArtifact.amount || '1',
    holdId: process.env.ATS_HOLD_ID || holdArtifact.holdId || '<ATS_HOLD_ID>',
    holdExpiry: process.env.ATS_HOLD_EXPIRY || holdArtifact.holdExpiry || '<ATS_HOLD_EXPIRY>',
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

  const topicId = assertMatch(required(process.env, 'HCS_TOPIC_ID'), ENTITY_ID, 'HCS_TOPIC_ID')
  await assertRestrictedTopic(config, topicId)
  trade.verifyingContract = assertMatch(required(process.env, 'CLEARING_ESCROW_ADDRESS'), EVM_ADDRESS, 'CLEARING_ESCROW_ADDRESS')
  trade.security = assertMatch(required(process.env, 'ATS_SECURITY_EVM_ADDRESS'), EVM_ADDRESS, 'ATS_SECURITY_EVM_ADDRESS')
  trade.partition = assertMatch(trade.partition, BYTES32, 'ATS_PARTITION')
  trade.seller = assertMatch(required(process.env, 'SELLER_EVM_ADDRESS'), EVM_ADDRESS, 'SELLER_EVM_ADDRESS')
  trade.buyer = assertMatch(required(process.env, 'BUYER_EVM_ADDRESS'), EVM_ADDRESS, 'BUYER_EVM_ADDRESS')
  trade.amount = positiveUint(process.env, 'TRADE_AMOUNT')
  trade.holdId = positiveUint(process.env, 'ATS_HOLD_ID')
  trade.holdExpiry = positiveUint(process.env, 'ATS_HOLD_EXPIRY')
  trade.policyHash = assertMatch(required(process.env, 'POLICY_HASH'), BYTES32, 'POLICY_HASH')
  request.subject.deploymentId = required(process.env, 'DEPLOYMENT_ID')

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
    observeHold: () => hold.get({ partition: trade.partition, seller: trade.seller, holdId: trade.holdId }),
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
    async confirmSettlement({ authorization, expectedLifecycle, submitted }) {
      if (!await escrow.isNonceUsed(authorization.nonce)) return { confirmed: false }
      const event = submitted?.transactionHash ? submitted : await escrow.findSettlement(authorization)
      if (!event?.transactionHash) return { confirmed: false }
      const mirror = await waitForMirror(config, event.transactionHash)
      const remaining = await hold.get({ partition: trade.partition, seller: trade.seller, holdId: trade.holdId })
      if (remaining && BigInt(remaining.amount) > 0n) return { confirmed: false }
      return {
        confirmed: true, lifecycle: expectedLifecycle,
        transactionHash: event.transactionHash,
        transactionId: mirror.transaction_id,
        tradeDigest: event.tradeDigest || submitted?.tradeDigest,
      }
    },
    anchorAudit: (message) => submitHcsMessage(config, topicId, message),
    saveState: (state) => store.save(state),
  }, store.load())
  output({ mode: 'execute', stateFile: process.env.CARETAKER_STATE_FILE || '.context/caretaker-state.json', result })
})
