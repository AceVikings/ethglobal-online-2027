import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryVaultRepository } from '../src/repositories/memory.ts'

test('memory repository isolates owners and enforces idempotency fingerprints', async () => {
  const repo = createMemoryVaultRepository({ id: (() => { let n = 0; return () => `id-${++n}` })() })
  const vault = await repo.createVault('user-a', { name: 'Income', offeringId: 'spcf', receiver: `0x${'11'.repeat(20)}`, executorRef: 'wallet-1', policy: { maxUtilizationBps: 8000, maxLagBlocks: 50, minTvlUsdMinor: '100', requireSchemaAgreement: true, requireInvariantPass: true } })
  assert.equal((await repo.listVaults('user-b')).length, 0)
  assert.equal(await repo.getVault('user-b', vault.id), null)

  const input = { vaultId: vault.id, requestId: 'request-1', mandateHash: `0x${'22'.repeat(32)}`, actor: { kind: 'web' as const, clientId: 'web', requestId: 'request-1' }, snapshot: { unitsBase: '1' } }
  const first = await repo.createRun('user-a', input)
  const duplicate = await repo.createRun('user-a', input)
  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.run.id, first.run.id)
  await assert.rejects(() => repo.createRun('user-a', { ...input, snapshot: { unitsBase: '2' } }), /idempotency conflict/)
})

test('memory repository appends ordered events and replays after a cursor', async () => {
  const repo = createMemoryVaultRepository({ id: (() => { let n = 0; return () => `id-${++n}` })() })
  const vault = await repo.createVault('user-a', { name: 'Income', offeringId: 'spcf', receiver: `0x${'11'.repeat(20)}`, executorRef: 'wallet-1', policy: { maxUtilizationBps: 8000, maxLagBlocks: 50, minTvlUsdMinor: '100', requireSchemaAgreement: true, requireInvariantPass: true } })
  const { run } = await repo.createRun('user-a', { vaultId: vault.id, requestId: 'request-1', mandateHash: `0x${'22'.repeat(32)}`, actor: { kind: 'web', clientId: 'web', requestId: 'request-1' }, snapshot: {} })
  await repo.appendEvent('user-a', run.id, { type: 'PRECHECK', visibility: 'private', detail: 'Checking' })
  const events = await repo.listEvents('user-a', run.id, 1)
  assert.deepEqual(events.map((event) => event.sequence), [2])
  await assert.rejects(() => repo.appendEvent('user-b', run.id, { type: 'NOPE', visibility: 'private', detail: 'No' }), /run not found/)
})
