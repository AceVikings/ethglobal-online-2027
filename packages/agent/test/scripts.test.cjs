'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../../..')

function dryRun(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...extraEnv },
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('caretaker dry-run matches seller request and default endpoint', () => {
  const result = dryRun('run-caretaker.cjs')
  assert.equal(result.serviceUrl, 'http://127.0.0.1:4020/verdict')
  assert.equal(result.x402Network, 'hedera:testnet')
  assert.equal(result.preview.request.standard, 'messari/lending-v3.1')
  assert.equal(result.preview.request.policy.lagBoundBlocks, 50)
})

test('sweep dry-run derives canonical deployment list from signal package', () => {
  const result = dryRun('sweep.cjs', { HOST: 'localhost', PORT: '4888' })
  assert.equal(result.serviceUrl, 'http://localhost:4888/verdict')
  assert.equal(result.deployments.length, 6)
})

test('issuance dry-runs preserve ATS block-list mode and canonical config ids', () => {
  const equity = dryRun('issue-equity.cjs', { ATS_EQUITY_CONFIG_ID: `0x${'a'.repeat(64)}` })
  const bond = dryRun('issue-bond.cjs', { ATS_BOND_CONFIG_ID: `0x${'b'.repeat(64)}` })
  assert.equal(equity.request.isWhiteList, false)
  assert.equal(equity.request.configId, `0x${'a'.repeat(64)}`)
  assert.equal(bond.request.isWhiteList, false)
  assert.equal(bond.request.configId, `0x${'b'.repeat(64)}`)
})

test('schedule dry-run does not claim recurring execution or agent invocation', () => {
  const result = dryRun('schedule-check.cjs')
  assert.equal(result.recurring, false)
  assert.equal(result.triggersAgent, false)
})
