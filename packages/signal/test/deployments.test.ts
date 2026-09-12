import assert from 'node:assert/strict'
import test from 'node:test'
import { LENDING_DEPLOYMENTS, findDeployment, requireDeployment } from '../src/deployments.ts'

test('catalog contains six unique version-pinned deployments', () => {
  assert.equal(LENDING_DEPLOYMENTS.length, 6)
  assert.equal(new Set(LENDING_DEPLOYMENTS.map((item) => item.deploymentId)).size, 6)
  assert.ok(LENDING_DEPLOYMENTS.every((item) => item.standard === 'messari/lending-v3.1'))
  assert.ok(LENDING_DEPLOYMENTS.every((item) => item.deploymentId.startsWith('Qm')))
  assert.ok(LENDING_DEPLOYMENTS.every((item) => item.schemaVersion === '3.1.0'))
  assert.ok(LENDING_DEPLOYMENTS.every((item) => item.verifiedAt.startsWith('2026-09-12T')))
  assert.ok(LENDING_DEPLOYMENTS.every((item) => item.requiredMarketFields.includes('totalValueLockedUSD')))
})

test('lookup resolves supported pairs and rejects unsupported ones', () => {
  assert.equal(findDeployment('aave-v3', 'ethereum')?.deploymentId, 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd')
  assert.equal(findDeployment('unknown', 'base'), undefined)
  assert.throws(() => requireDeployment('unknown', 'base'), /Unsupported lending deployment/)
})
