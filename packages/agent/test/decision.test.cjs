'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { decideAndAct } = require('../src/decision.cjs')

function dependencies(verdict) {
  const calls = []
  return { calls, deps: {
    buyVerdict: async () => ({ verdict: { verdict, signature: '0xsig' }, paymentTxId: '0.0.1@1.2' }),
    verifyVerdict: async () => ({ ok: true, recovered: '0x1' }),
    signalHash: async () => `0x${'11'.repeat(32)}`,
    controlList: { unblock: async (id) => { calls.push(['unblock', id]); return { transactionId: 'unblock-tx' } } },
    executeTransfer: async (op) => { calls.push(['transfer', op]); return { transactionId: 'transfer-tx' } },
    buildAnchor: async () => `0x${'22'.repeat(32)}`,
    anchorHcs: async (message) => { calls.push(['hcs', message]); return { transactionId: 'hcs-tx' } },
    recordGate: async (args) => { calls.push(['gate', args]); return { transactionHash: 'gate-tx' } },
    now: () => new Date('2026-09-12T00:00:00Z'),
  }}
}

const input = { request: {}, recipientId: '0.0.2', operation: { calldata: '0x1234' } }

test('conformant verdict unblocks before executing and anchors both ledgers', async () => {
  const { calls, deps } = dependencies('CONFORMANT')
  const result = await decideAndAct(input, deps)
  assert.deepEqual(calls.map(([name]) => name), ['unblock', 'transfer', 'hcs', 'gate'])
  assert.equal(result.operation.status, 'EXECUTED')
})

test('failed verdict never unblocks or constructs a transfer', async () => {
  const { calls, deps } = dependencies('NON_CONFORMANT')
  const result = await decideAndAct(input, deps)
  assert.deepEqual(calls.map(([name]) => name), ['hcs', 'gate'])
  assert.equal(result.operation.status, 'REFUSED')
})

test('bad signature fails before any chain mutation', async () => {
  const { calls, deps } = dependencies('CONFORMANT')
  deps.verifyVerdict = async () => ({ ok: false, recovered: '0xbad' })
  await assert.rejects(() => decideAndAct(input, deps), /signature mismatch/)
  assert.deepEqual(calls, [])
})
