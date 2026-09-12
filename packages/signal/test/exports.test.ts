import assert from 'node:assert/strict'
import test from 'node:test'
import * as signal from '../src/index.ts'

test('consumer-facing entrypoint exports the core operations', () => {
  assert.equal(signal.computeConformanceVerdict, signal.checkConformance)
  assert.equal(typeof signal.buildVerdictPayload, 'function')
  assert.equal(typeof signal.signVerdict, 'function')
  assert.equal(typeof signal.verifyVerdict, 'function')
  assert.equal(typeof signal.clearingAuthorizationHash, 'function')
  assert.equal(typeof signal.signClearingAuthorization, 'function')
  assert.equal(typeof signal.clearingPolicyHash, 'function')
  assert.equal(typeof signal.clearingEvidenceHash, 'function')
  assert.equal(typeof signal.GraphGatewayClient, 'function')
  assert.equal(typeof signal.SubgraphMcpClient, 'function')
})
