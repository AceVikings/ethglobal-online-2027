import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalRunFingerprint, validateRunEvent } from '../src/index.ts'

test('run fingerprints are stable but distinguish economic requests', () => {
  const request = { vaultId: 'vault-1', mandateHash: `0x${'11'.repeat(32)}`, unitsBase: '100', quoteId: 'quote-1' }
  assert.equal(canonicalRunFingerprint(request), canonicalRunFingerprint({ ...request }))
  assert.notEqual(canonicalRunFingerprint(request), canonicalRunFingerprint({ ...request, unitsBase: '101' }))
})

test('events require positive monotonic sequence and public classification', () => {
  const event = { runId: 'run-1', sequence: 1, type: 'QUEUED', occurredAt: '2026-09-13T00:00:00.000Z', visibility: 'private' as const, detail: 'Queued' }
  assert.deepEqual(validateRunEvent(event), event)
  assert.throws(() => validateRunEvent({ ...event, sequence: 0 }), /sequence/)
})
