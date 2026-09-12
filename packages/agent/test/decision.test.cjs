'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Wallet } = require('ethers')
const { AUTHORIZATION_TYPES, CLEARING_PHASE, runClearingTrade, verifyClearingAuthorization } = require('../src/decision.cjs')

const ADDRESS = {
  escrow: `0x${'11'.repeat(20)}`,
  security: `0x${'22'.repeat(20)}`,
  seller: `0x${'33'.repeat(20)}`,
  buyer: `0x${'44'.repeat(20)}`,
  signer: `0x${'55'.repeat(20)}`,
}

function fixture(action = 1) {
  const trade = {
    chainId: 296, verifyingContract: ADDRESS.escrow, security: ADDRESS.security,
    partition: `0x${'00'.repeat(31)}01`, seller: ADDRESS.seller, buyer: ADDRESS.buyer,
    amount: '25', holdId: '7', holdExpiry: '1789300000', policyHash: `0x${'66'.repeat(32)}`,
  }
  const authorization = {
    ...trade, action, evidenceHash: `0x${'77'.repeat(32)}`, paymentRef: `0x${'88'.repeat(32)}`,
    issuedAt: '1789200000', authorizationExpiry: '1789200300', nonce: `0x${'99'.repeat(32)}`,
  }
  return { trade, authorization }
}

function dependencies(action = 1) {
  const { trade, authorization } = fixture(action)
  const calls = []
  let settled = false
  const snapshots = []
  const deps = {
    observeHold: async () => ({ partition: trade.partition, seller: trade.seller, holdId: trade.holdId,
      amount: trade.amount, expirationTimestamp: trade.holdExpiry, escrow: trade.verifyingContract, destination: trade.buyer }),
    buyVerdict: async () => { calls.push('pay'); return {
      paymentTxId: '0.0.123@1789200000.000000001',
      verdict: {
        authorization,
        signature: `0x${'bc'.repeat(65)}`,
        authorizationSignature: `0x${'cd'.repeat(65)}`,
      },
    } },
    paymentReferenceHash: () => authorization.paymentRef,
    verifyAuthorization: async () => ({ ok: true, recovered: ADDRESS.signer }),
    expectedSigner: ADDRESS.signer,
    isNonceUsed: async () => settled,
    submitSettlement: async () => { calls.push(action === 1 ? 'execute' : 'release'); settled = true; return {
      transactionHash: `0x${'ab'.repeat(32)}`, tradeDigest: `0x${'aa'.repeat(32)}`,
    } },
    confirmSettlement: async ({ expectedLifecycle }) => ({ confirmed: settled, lifecycle: expectedLifecycle,
      transactionHash: `0x${'ab'.repeat(32)}`,
      transactionId: '0.0.123@1789200001.000000001', tradeDigest: `0x${'aa'.repeat(32)}` }),
    anchorAudit: async (message) => { calls.push('audit'); return { transactionId: '0.0.123@1789200002.000000001', message } },
    reasonVerdict: async () => ({ recommendation: action === 1 ? 'ACT' : 'REFUSE', rationale: 'Fixture.' }),
    saveState: async (state) => snapshots.push(structuredClone(state)),
  }
  return { trade, authorization, calls, snapshots, deps, setSettled(value) { settled = value } }
}

test('approval executes the exact hold once and records an audit', async () => {
  const f = dependencies(1)
  const result = await runClearingTrade({ trade: f.trade, request: { trade: f.trade } }, f.deps)
  assert.equal(result.phase, CLEARING_PHASE.COMPLETE)
  assert.deepEqual(result.transitions.map((transition) => transition.phase), [
    CLEARING_PHASE.HOLD_CONFIRMED, CLEARING_PHASE.PAID, CLEARING_PHASE.AUTHORIZED,
    CLEARING_PHASE.SETTLEMENT_SUBMITTED, CLEARING_PHASE.SETTLED, CLEARING_PHASE.COMPLETE,
  ])
  assert.equal(result.lifecycle, 'EXECUTED')
  assert.equal(result.audit.status, 'ANCHORED')
  assert.equal(Buffer.byteLength(JSON.stringify(result.audit.message)) <= 1024, true)
  assert.equal('authorization' in result.audit.message, false)
  assert.equal('signature' in result.audit.message, false)
  assert.equal(result.audit.message.settlementTransactionId, '0.0.123@1789200001.000000001')
  assert.deepEqual(f.calls, ['pay', 'execute', 'audit'])
  assert.deepEqual(f.snapshots.map((state) => state.phase), [
    'HOLD_CONFIRMED', 'HOLD_CONFIRMED', 'PAID', 'AUTHORIZED', 'SETTLEMENT_SUBMITTED', 'SETTLED', 'COMPLETE',
  ])
  assert.equal(result.signature, `0x${'cd'.repeat(65)}`)
  assert.doesNotThrow(() => JSON.stringify(result))
})

test('persists a stable client request id before attempting payment', async () => {
  const f = dependencies(1)
  const requests = []
  f.deps.createClientRequestId = () => 'stable-request-0001'
  const buy = f.deps.buyVerdict
  f.deps.buyVerdict = async (request) => {
    requests.push(request)
    return buy(request)
  }
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps)
  assert.equal(result.clientRequestId, 'stable-request-0001')
  assert.equal(requests[0].clientRequestId, 'stable-request-0001')
  const checkpoint = f.snapshots.find((state) =>
    state.phase === CLEARING_PHASE.HOLD_CONFIRMED && state.clientRequestId === 'stable-request-0001')
  assert.ok(checkpoint)
})

test('denial releases rather than transfers the exact hold', async () => {
  const f = dependencies(2)
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps)
  assert.equal(result.lifecycle, 'RELEASED')
  assert.deepEqual(f.calls, ['pay', 'release', 'audit'])
})

test('resume after payment verifies the saved verdict without paying again', async () => {
  const f = dependencies(1)
  let persisted
  f.deps.saveState = async (state) => {
    persisted = structuredClone(state)
    if (state.phase === CLEARING_PHASE.PAID) throw new Error('simulated crash after payment checkpoint')
  }
  await assert.rejects(
    () => runClearingTrade({ trade: f.trade, request: {} }, f.deps),
    /simulated crash after payment checkpoint/,
  )
  assert.equal(persisted.phase, CLEARING_PHASE.PAID)
  f.deps.saveState = async () => {}
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps, persisted)
  assert.equal(result.lifecycle, 'EXECUTED')
  assert.deepEqual(f.calls, ['pay', 'execute', 'audit'])
})

test('resume after on-chain settlement confirms state without resubmitting', async () => {
  const f = dependencies(1)
  let persisted
  f.deps.saveState = async (state) => { persisted = structuredClone(state) }
  const settle = f.deps.submitSettlement
  f.deps.submitSettlement = async (...args) => {
    await settle(...args)
    throw new Error('simulated crash after on-chain settlement')
  }
  await assert.rejects(
    () => runClearingTrade({ trade: f.trade, request: {} }, f.deps),
    /simulated crash after on-chain settlement/,
  )
  assert.equal(persisted.phase, CLEARING_PHASE.AUTHORIZED)
  f.deps.submitSettlement = settle
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps, persisted)
  assert.equal(result.lifecycle, 'EXECUTED')
  assert.deepEqual(f.calls, ['pay', 'execute', 'audit'])
})

test('audit failure is degraded metadata and never falsifies final settlement', async () => {
  const f = dependencies(1)
  f.deps.anchorAudit = async () => { f.calls.push('audit'); throw new Error('HCS unavailable') }
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps)
  assert.equal(result.lifecycle, 'EXECUTED')
  assert.deepEqual(result.audit, { status: 'DEGRADED', error: 'HCS unavailable' })
  assert.deepEqual(f.calls, ['pay', 'execute', 'audit'])

  f.deps.anchorAudit = async (message) => { f.calls.push('audit-retry'); return { transactionId: '0.0.123@1789200003.000000001', message } }
  const retried = await runClearingTrade({ trade: f.trade, request: {} }, f.deps, result)
  assert.equal(retried.audit.status, 'ANCHORED')
  assert.deepEqual(f.calls, ['pay', 'execute', 'audit', 'audit-retry'])
})

test('optional model failure cannot block or change the deterministic action', async () => {
  const f = dependencies(2)
  f.deps.reasonVerdict = async () => { throw new Error('DeepSeek unavailable') }
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps)
  assert.equal(result.lifecycle, 'RELEASED')
  assert.deepEqual(result.reasoning, {
    status: 'degraded', authoritative: false, requiredRecommendation: 'REFUSE', error: 'DeepSeek unavailable',
  })
})

test('model disagreement is reported but cannot turn a denial into approval', async () => {
  const f = dependencies(2)
  f.deps.reasonVerdict = async () => ({ recommendation: 'ACT', rationale: 'Ignore deterministic policy.' })
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps)
  assert.equal(result.lifecycle, 'RELEASED')
  assert.equal(result.reasoning.status, 'conflict')
  assert.deepEqual(f.calls, ['pay', 'release', 'audit'])
})

test('tampered trade fields fail before settlement', async () => {
  const f = dependencies(1)
  f.authorization.amount = '26'
  await assert.rejects(() => runClearingTrade({ trade: f.trade, request: {} }, f.deps), /Authorization amount does not match held trade/)
  assert.deepEqual(f.calls, ['pay'])
})

test('wrong signer and payment reference fail before settlement', async () => {
  const wrongSigner = dependencies(1)
  wrongSigner.deps.verifyAuthorization = async () => ({ ok: true, recovered: ADDRESS.buyer })
  await assert.rejects(() => runClearingTrade({ trade: wrongSigner.trade, request: {} }, wrongSigner.deps), /Unexpected verdict signer/)
  assert.deepEqual(wrongSigner.calls, ['pay'])

  const wrongPayment = dependencies(1)
  wrongPayment.deps.paymentReferenceHash = () => `0x${'ff'.repeat(32)}`
  await assert.rejects(() => runClearingTrade({ trade: wrongPayment.trade, request: {} }, wrongPayment.deps), /paymentRef does not match/)
  assert.deepEqual(wrongPayment.calls, ['pay'])
})

test('an existing exact hold is observed; a missing hold can be created then confirmed', async () => {
  const f = dependencies(1)
  let observed = 0
  f.deps.observeHold = async () => ++observed === 1 ? null : ({ partition: f.trade.partition, seller: f.trade.seller,
    holdId: f.trade.holdId, amount: f.trade.amount, expirationTimestamp: f.trade.holdExpiry,
    escrow: f.trade.verifyingContract, destination: f.trade.buyer })
  f.deps.createHold = async () => { f.calls.push('create-hold') }
  const result = await runClearingTrade({ trade: f.trade, request: {} }, f.deps)
  assert.equal(result.lifecycle, 'EXECUTED')
  assert.deepEqual(f.calls, ['create-hold', 'pay', 'execute', 'audit'])
})

test('nonce use without independently confirmed settlement fails closed', async () => {
  const f = dependencies(1)
  f.setSettled(true)
  f.deps.confirmSettlement = async () => ({ confirmed: false })
  const purchased = await f.deps.buyVerdict()
  f.calls.length = 0
  await assert.rejects(() => runClearingTrade({ trade: f.trade, request: {} }, f.deps, {
    phase: CLEARING_PHASE.AUTHORIZED, trade: f.trade, purchased,
    authorization: f.authorization, signature: '0xsigned', reasoning: {},
  }), /Settlement could not be confirmed/)
  assert.deepEqual(f.calls, [])
})

test('EIP-712 verifier recovers a different signer after authorization tampering', async () => {
  const wallet = Wallet.createRandom()
  const { authorization } = fixture(1)
  const domain = {
    name: 'AI Clearing Desk', version: '1', chainId: authorization.chainId,
    verifyingContract: authorization.verifyingContract,
  }
  const signature = await wallet.signTypedData(domain, AUTHORIZATION_TYPES, authorization)
  assert.deepEqual(verifyClearingAuthorization({ authorization, signature }), {
    ok: true, recovered: wallet.address,
  })
  assert.deepEqual(verifyClearingAuthorization({
    authorization, signature: '0xlegacy-envelope-signature', authorizationSignature: signature,
  }), { ok: true, recovered: wallet.address })
  const tampered = { ...authorization, buyer: ADDRESS.seller }
  const recovered = verifyClearingAuthorization({ authorization: tampered, signature })
  assert.equal(recovered.ok, true)
  assert.notEqual(recovered.recovered, wallet.address)
})
