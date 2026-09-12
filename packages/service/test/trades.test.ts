import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createFileTradeReadModel } from '../src/trades.ts'

let directory = ''
let stateFile = ''

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'conformance-trades-'))
  stateFile = join(directory, 'state.json')
})
after(async () => rm(directory, { recursive: true, force: true }))

const digest = `0x${'ab'.repeat(32)}`
const state = {
  phase: 'COMPLETE', updatedAt: '2026-09-12T10:00:05.000Z',
  transitions: [
    { phase: 'HOLD_CONFIRMED', occurredAt: '2026-09-12T10:00:00.000Z' },
    { phase: 'PAID', occurredAt: '2026-09-12T10:00:01.000Z' },
    { phase: 'AUTHORIZED', occurredAt: '2026-09-12T10:00:02.000Z' },
    { phase: 'SETTLED', occurredAt: '2026-09-12T10:00:04.000Z' },
    { phase: 'COMPLETE', occurredAt: '2026-09-12T10:00:05.000Z' },
  ],
  authorization: {
    chainId: '296', verifyingContract: `0x${'11'.repeat(20)}`, security: `0x${'22'.repeat(20)}`,
    partition: `0x${'00'.repeat(31)}01`, seller: `0x${'33'.repeat(20)}`, buyer: `0x${'44'.repeat(20)}`,
    amount: '1000000', holdId: '1', holdExpiry: '1893456000', action: 1,
    policyHash: `0x${'55'.repeat(32)}`, evidenceHash: `0x${'66'.repeat(32)}`,
    paymentRef: `0x${'77'.repeat(32)}`, issuedAt: '1789207202', authorizationExpiry: '1789207502',
    nonce: `0x${'88'.repeat(32)}`,
  },
  hold: {
    createdAt: '2026-09-12T10:00:00.000Z', creationTransactionId: `0x${'aa'.repeat(32)}`,
  },
  purchased: {
    paymentTxId: '0.0.123@1789207201.000000001',
    paymentProvenance: {
      payerProvider: 'privy', payerAccountId: '0.0.101', tokenId: '0.0.429274',
      payTo: '0.0.102', feePayer: '0.0.123',
    },
    verdict: {
    issuedAt: '2026-09-12T10:00:02.000Z', signer: `0x${'99'.repeat(20)}`,
    standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'ethereum', deploymentId: 'QmDeployment' },
    evidence: { block: 123456, queryHash: `0x${'aa'.repeat(32)}`, queryText: 'private query' },
    checks: {
      freshness: { pass: true, lagBlocks: 1, bound: 50 },
      shapeAgreement: { pass: true, peers: 5, mismatches: 0 },
    },
    authorizationSignature: 'private signature',
  } },
  reasoning: { status: 'ok', rationale: 'All deterministic checks passed.' },
  settlement: {
    tradeDigest: digest, transactionId: '0.0.123@1789207204.000000001',
    balances: { before: { seller: '0', buyer: '0' }, after: { seller: '0', buyer: '1000000' } },
  },
  audit: { status: 'ANCHORED', transactionId: '0.0.123@1789207205.000000001', topicSequenceNumber: '4' },
  replay: {
    verifiedAt: '2026-09-12T10:00:06.000Z', checked: 1, passed: 1, failed: 0,
    checks: { signature: true, tradeDigest: true, mirrorFinality: true, atsHoldConsumed: true },
  },
}

test('projects only completed, chain-confirmed caretaker state into public trade data', async () => {
  await writeFile(stateFile, JSON.stringify(state))
  const reader = createFileTradeReadModel({ stateFile, securityId: '0.0.456', topicId: '0.0.789', priceUsd: '0.01' })
  const list = await reader.list() as any
  assert.equal(list.trades.length, 1)
  assert.equal(list.trades[0].tradeDigest, digest)
  assert.equal(list.trades[0].state, 'EXECUTED')
  assert.equal(list.trades[0].hold.units, '1.0')
  assert.equal(list.trades[0].payment.transactionId, state.purchased.paymentTxId)
  assert.deepEqual(list.trades[0].payment.provenance, state.purchased.paymentProvenance)
  assert.deepEqual(list.trades[0].decision.evidence, {
    standard: 'messari/lending-v3.1', protocol: 'aave-v3', network: 'ethereum',
    deploymentId: 'QmDeployment', block: 123456, queryHash: `0x${'aa'.repeat(32)}`,
    deploymentsCompared: 6,
  })
  assert.equal(list.trades[0].hold.creationTransactionId, state.hold.creationTransactionId)
  assert.deepEqual(list.trades[0].settlement.balances, state.settlement.balances)
  assert.equal(list.trades[0].settlement.auditStatus, 'ANCHORED')
  assert.equal(list.trades[0].settlement.hcsTransactionId, state.audit.transactionId)
  assert.deepEqual(list.trades[0].verification, state.replay)
  assert.match(list.trades[0].links.holdCreation, /hashscan\.io\/testnet\/transaction/)
  assert.match(list.trades[0].links.hcsAudit, /hashscan\.io\/testnet\/transaction/)
  assert.equal(list.trades[0].settlement.hcsSequenceNumber, 4)
  assert.equal(list.trades[0].decision.checks[0].publicValue, '1 / 50 blocks')
  for (const forbidden of ['queryText', 'rows', 'appSecret', 'privateKey', 'walletId', 'authorizationSignature']) {
    assert.equal(JSON.stringify(list).includes(forbidden), false)
  }
  assert.equal((await reader.events(digest))?.length, 6)
  assert.equal(await reader.get(`0x${'ff'.repeat(32)}`), null)
})

test('does not invent a public trade before settlement is confirmed', async () => {
  await writeFile(stateFile, JSON.stringify({ phase: 'PAID', purchased: state.purchased }))
  const reader = createFileTradeReadModel({ stateFile })
  assert.deepEqual(await reader.list(), { trades: [], nextCursor: null })
})
