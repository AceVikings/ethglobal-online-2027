#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Contract, Interface, JsonRpcProvider, keccak256, recoverAddress, toUtf8Bytes } = require('ethers')
const {
  ATS_HOLD_ABI, BYTES32, CLEARING_ESCROW_ABI, EVM_ADDRESS, assertMatch,
  createClearingEscrowAdapter, executeRequested, loadConfig, mirrorContractResult,
  normalizeAuthorization, output, run, required,
} = require('./lib/common.cjs')

async function messages(baseUrl, topicId) {
  let next = `${baseUrl.replace(/\/$/, '')}/api/v1/topics/${topicId}/messages?limit=100&order=asc`
  const all = []
  while (next) {
    const response = await fetch(next)
    if (!response.ok) throw new Error(`Mirror Node returned ${response.status}`)
    const page = await response.json()
    all.push(...page.messages)
    next = page.links?.next ? new URL(page.links.next, baseUrl).toString() : null
  }
  return all
}

async function holdConsumed(provider, authorization) {
  const security = new Contract(authorization.security, ATS_HOLD_ABI, provider)
  try {
    const hold = await security.getHoldForByPartition({
      partition: authorization.partition,
      tokenHolder: authorization.seller,
      holdId: authorization.holdId,
    })
    return BigInt(hold.amount) === 0n
  } catch (error) {
    // Some ATS-compatible implementations revert for a missing record; the ATS
    // v8 implementation returns a zero-valued hold. Transport errors stay fatal.
    if (error?.code === 'CALL_EXCEPTION') return true
    throw error
  }
}

function persistReplay(filename, rows) {
  if (!filename || !fs.existsSync(filename) || rows.length !== 1) return
  const state = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const row = rows[0]
  const tradeDigest = state.settlement?.tradeDigest || state.submitted?.tradeDigest
  if (!tradeDigest || tradeDigest.toLowerCase() !== row.tradeDigest.toLowerCase()) return
  state.replay = {
    verifiedAt: new Date().toISOString(),
    checked: rows.length,
    passed: rows.filter((entry) => entry.pass).length,
    failed: rows.filter((entry) => !entry.pass).length,
    checks: row.checks,
  }
  const temporary = `${filename}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filename)
}

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: false })
  const topicId = process.env.HCS_TOPIC_ID
  if (!execute) return output({
    mode: 'dry-run', action: 'replay HCS CLEARING_DECISION messages against signature, escrow event, Mirror result, and ATS hold state',
    topicId: topicId || '<HCS_TOPIC_ID>', mirrorNodeUrl: config.mirrorNodeUrl,
  })
  required(process.env, 'HCS_TOPIC_ID')
  // Hashio rejects eth_getLogs when ethers includes it in a JSON-RPC batch.
  const provider = new JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1 })
  const expectedEscrow = assertMatch(required(process.env, 'CLEARING_ESCROW_ADDRESS'), EVM_ADDRESS, 'CLEARING_ESCROW_ADDRESS')
  const expectedSecurity = assertMatch(required(process.env, 'ATS_SECURITY_EVM_ADDRESS'), EVM_ADDRESS, 'ATS_SECURITY_EVM_ADDRESS')
  const expectedSigner = assertMatch(required(process.env, 'CONFORMANCE_EXPECTED_SIGNER'), EVM_ADDRESS, 'CONFORMANCE_EXPECTED_SIGNER')
  const expectedPolicy = assertMatch(required(process.env, 'POLICY_HASH'), BYTES32, 'POLICY_HASH')
  const expectedTradeDigest = process.env.REPLAY_TRADE_DIGEST
    ? assertMatch(process.env.REPLAY_TRADE_DIGEST, BYTES32, 'REPLAY_TRADE_DIGEST').toLowerCase()
    : null
  const escrow = createClearingEscrowAdapter(provider, expectedEscrow)
  const settlementInterface = new Interface(CLEARING_ESCROW_ABI)
  const [trustedSigner, committedPolicy] = await Promise.all([escrow.signer(), escrow.policyHash()])
  if (trustedSigner.toLowerCase() !== expectedSigner.toLowerCase()) throw new Error('Pinned escrow signer does not match CONFORMANCE_EXPECTED_SIGNER')
  if (committedPolicy.toLowerCase() !== expectedPolicy.toLowerCase()) throw new Error('Pinned escrow policy does not match POLICY_HASH')
  const rows = []
  for (const envelope of await messages(config.mirrorNodeUrl, topicId)) {
    let message
    try { message = JSON.parse(Buffer.from(envelope.message, 'base64').toString('utf8')) } catch { continue }
    if (message.t !== 'CLEARING_DECISION' || message.v !== 2) continue
    if (expectedTradeDigest && message.tradeDigest?.toLowerCase() !== expectedTradeDigest) continue
    if (message.escrow?.toLowerCase() !== expectedEscrow.toLowerCase()) throw new Error('HCS message references an untrusted escrow')
    if (message.security?.toLowerCase() !== expectedSecurity.toLowerCase()) throw new Error('HCS message references an unexpected ATS security')
    const [event, transaction, mirror] = await Promise.all([
      escrow.findSettlementByDigest(message.tradeDigest),
      provider.getTransaction(message.settlementTransactionHash),
      mirrorContractResult(config, message.settlementTransactionHash),
    ])
    const parsed = transaction ? settlementInterface.parseTransaction({ data: transaction.data, value: transaction.value }) : null
    if (!parsed || parsed.name !== 'settle') throw new Error('Settlement transaction calldata is unavailable or invalid')
    const authorization = normalizeAuthorization(parsed.args.authorization)
    const recomputedDigest = await escrow.hashAuthorization(authorization)
    let recovered = null
    try { recovered = recoverAddress(recomputedDigest, parsed.args.signature) } catch {}
    const paymentRefMatches = keccak256(toUtf8Bytes(message.paymentTxId)) === authorization.paymentRef
    const consumed = await holdConsumed(provider, authorization)
    const nonceUsed = event ? await escrow.isNonceUsed(event.args.nonce) : false
    const expectedAction = event && Number(event.args.action) === 1 ? 'APPROVE' : 'DENY'
    const expectedLifecycle = expectedAction === 'APPROVE' ? 'EXECUTED' : 'RELEASED'
    const checks = {
      signature: Boolean(recovered) && recovered.toLowerCase() === trustedSigner.toLowerCase(),
      tradeDigest: message.tradeDigest.toLowerCase() === event?.tradeDigest.toLowerCase() &&
        recomputedDigest.toLowerCase() === message.tradeDigest.toLowerCase(),
      paymentRef: paymentRefMatches && authorization.paymentRef.toLowerCase() === event?.args.paymentRef.toLowerCase(),
      evidenceHash: authorization.evidenceHash.toLowerCase() === event?.args.evidenceHash.toLowerCase(),
      authorizationPins: authorization.verifyingContract.toLowerCase() === expectedEscrow.toLowerCase() &&
        authorization.security.toLowerCase() === expectedSecurity.toLowerCase() &&
        authorization.policyHash.toLowerCase() === expectedPolicy.toLowerCase(),
      action: message.action === expectedAction && message.lifecycle === expectedLifecycle,
      heldTrade: authorization.security.toLowerCase() === event?.args.security.toLowerCase() &&
        authorization.security.toLowerCase() === expectedSecurity.toLowerCase() &&
        BigInt(authorization.holdId) === event?.args.holdId,
      nonceConsumed: nonceUsed,
      contractEvent: Boolean(event) && event.transactionHash.toLowerCase() === message.settlementTransactionHash.toLowerCase() &&
        transaction.to?.toLowerCase() === expectedEscrow.toLowerCase(),
      mirrorFinality: Boolean(mirror) && (!message.settlementTransactionId ||
        mirror.transaction_id === message.settlementTransactionId),
      atsHoldConsumed: consumed,
    }
    rows.push({
      sequence: envelope.sequence_number,
      consensusTimestamp: envelope.consensus_timestamp,
      tradeDigest: message.tradeDigest,
      lifecycle: message.lifecycle,
      checks,
      pass: Object.values(checks).every(Boolean),
    })
  }
  persistReplay(process.env.CARETAKER_STATE_FILE
    ? path.resolve(process.cwd(), process.env.CARETAKER_STATE_FILE)
    : null, rows)
  output({
    mode: 'execute', topicId, checked: rows.length,
    passed: rows.filter((row) => row.pass).length,
    failed: rows.filter((row) => !row.pass).length,
    rows,
  })
  if (rows.length === 0) process.exitCode = 3
  else if (rows.some((row) => !row.pass)) process.exitCode = 2
})
