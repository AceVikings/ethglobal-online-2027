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
  const result = dryRun('run-caretaker.cjs', { ATS_HOLD_FILE: path.join(root, '.context', 'missing-test-hold.json') })
  assert.equal(result.serviceUrl, 'http://127.0.0.1:4020/verdict')
  assert.equal(result.x402Network, 'hedera:testnet')
  assert.equal(result.preview.request.standard, 'messari/lending-v3.1')
  assert.equal(result.preview.request.policy.lagBoundBlocks, 50)
  assert.deepEqual(result.explanation, { enabled: false })
  assert.deepEqual(result.flow, [
    'observe exact ATS hold',
    'buy one x402 action-bound verdict',
    'verify signature and immutable trade fields',
    'submit APPROVE/execute or DENY/release to ClearingEscrow',
    'confirm contract, ATS, and Mirror state',
    'anchor audit without changing settlement truth',
  ])
  assert.equal(result.preview.trade.holdId, '<ATS_HOLD_ID>')
  assert.equal(JSON.stringify(result).includes('control list'), false)
  assert.equal(JSON.stringify(result).includes('ConformanceGate'), false)
})

test('caretaker reports an explicitly configured optional explanation model', () => {
  const result = dryRun('run-caretaker.cjs', {
    DEEPSEEK_API_KEY: 'fixture-key',
    DEEPSEEK_MODEL: 'deepseek-chat',
  })
  assert.deepEqual(result.explanation, { enabled: true, model: 'deepseek-chat' })
})

test('a default model without a DeepSeek key keeps explanations disabled', () => {
  const result = dryRun('run-caretaker.cjs', { DEEPSEEK_MODEL: 'deepseek-chat' })
  assert.deepEqual(result.explanation, { enabled: false })
})

test('sweep dry-run derives canonical deployment list from signal package', () => {
  const result = dryRun('sweep.cjs', { HOST: 'localhost', PORT: '4888' })
  assert.equal(result.action, 'read-only Graph deployment health sweep')
  assert.equal(result.deployments.length, 6)
})

test('issuance dry-runs preserve ATS block-list mode and canonical config ids', () => {
  const equity = dryRun('issue-equity.cjs', { ATS_EQUITY_CONFIG_ID: `0x${'a'.repeat(64)}` })
  const bond = dryRun('issue-bond.cjs', { ATS_BOND_CONFIG_ID: `0x${'b'.repeat(64)}` })
  assert.equal(equity.request.isWhiteList, false)
  assert.equal(equity.request.internalKycActivated, false)
  assert.equal(equity.request.name, 'Spokane Private Credit Fund')
  assert.equal(equity.request.configId, `0x${'a'.repeat(64)}`)
  assert.equal(bond.request.isWhiteList, false)
  assert.equal(bond.request.configId, `0x${'b'.repeat(64)}`)
})

test('schedule dry-run does not claim recurring execution or agent invocation', () => {
  const result = dryRun('schedule-check.cjs')
  assert.equal(result.recurring, false)
  assert.equal(result.triggersAgent, false)
})

test('HCS audit topic is not publicly writable', () => {
  const result = dryRun('create-hcs-topic.cjs')
  assert.equal(result.memo, 'ai-clearing-desk-v2')
  assert.equal(result.submitPolicy, 'operator-key-restricted')
})

test('hold creation is seller-signed and dry-run first', () => {
  const result = dryRun('create-hold.cjs', { ATS_HOLD_EXPIRY: '1893456000' })
  assert.equal(result.action, 'ATS createHoldByPartition')
  assert.equal(result.signer, 'seller-only')
  assert.equal(result.request.escrow, '<CLEARING_ESCROW_ADDRESS>')
  assert.match(result.holdFile, /\.context\/ats-hold\.json$/)
})

test('equity seeding issues units directly to the distinct seller', () => {
  const result = dryRun('seed-equity.cjs')
  assert.equal(result.action, 'ATS Security.issue')
  assert.equal(result.request.amount, '1')
  assert.equal(result.request.sellerId, '<HEDERA_SELLER_ID>')
})

test('replay dry-run verifies clearing evidence instead of the retired gate record', () => {
  const result = dryRun('replay.cjs')
  assert.match(result.action, /signature, escrow event, Mirror result, and ATS hold state/)
  assert.equal(result.action.includes('ConformanceGate'), false)
})

test('caretaker live source binds raw ATS hold values rather than human-unit env input', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'scripts/run-caretaker.cjs'), 'utf8')
  assert.match(source, /positiveUint\(holdArtifact, 'amount'\)/)
  assert.doesNotMatch(source, /positiveUint\(process\.env, 'TRADE_AMOUNT'\)/)
})

test('replay fails closed when the restricted topic has no clearing messages', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'scripts/replay.cjs'), 'utf8')
  assert.match(source, /rows\.length === 0.*exitCode = 3/s)
})
