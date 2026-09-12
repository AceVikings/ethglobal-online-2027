'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
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

test('expired hold reclaim validates the full trade identity and remains seller-only', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-reclaim-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const holdFile = path.join(directory, 'hold.json')
  const partition = `0x${'0'.repeat(63)}1`
  const security = `0x${'1'.repeat(40)}`
  const seller = `0x${'2'.repeat(40)}`
  const buyer = `0x${'3'.repeat(40)}`
  const escrow = `0x${'4'.repeat(40)}`
  fs.writeFileSync(holdFile, JSON.stringify({
    securityId: '0.0.123', security, partition, seller, buyer, escrow,
    holdId: '7', amount: '1000000', holdExpiry: '1',
  }))
  const result = dryRun('reclaim-hold.cjs', {
    ATS_HOLD_FILE: holdFile,
    ATS_SECURITY_ID: '0.0.123',
    ATS_SECURITY_EVM_ADDRESS: security,
    ATS_PARTITION: partition,
    SELLER_EVM_ADDRESS: seller,
    BUYER_EVM_ADDRESS: buyer,
    CLEARING_ESCROW_ADDRESS: escrow,
  })
  assert.equal(result.action, 'ATS reclaimHoldByPartition')
  assert.equal(result.signer, 'seller-only')
  assert.equal(result.request.holdId, '7')
  assert.equal(result.request.amount, '1000000')
  assert.match(result.evidenceFile, /\.context\/ats-hold-reclaims\/0-0-123-hold-7-[0-9a-f]{16}\.json$/)
})

test('hold reclaim rejects an artifact whose identity differs from configuration', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-reclaim-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const holdFile = path.join(directory, 'hold.json')
  const address = (digit) => `0x${digit.repeat(40)}`
  fs.writeFileSync(holdFile, JSON.stringify({
    securityId: '0.0.123', security: address('1'), partition: `0x${'0'.repeat(63)}1`,
    seller: address('2'), buyer: address('3'), escrow: address('4'),
    holdId: '7', amount: '1000000', holdExpiry: '1',
  }))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'reclaim-hold.cjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ATS_HOLD_FILE: holdFile,
      ATS_SECURITY_ID: '0.0.999',
      ATS_SECURITY_EVM_ADDRESS: address('1'),
      SELLER_EVM_ADDRESS: address('2'),
      BUYER_EVM_ADDRESS: address('3'),
      CLEARING_ESCROW_ADDRESS: address('4'),
    },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ATS_SECURITY_ID does not match ATS_HOLD_FILE/)
})

test('hold reclaim refuses an unexpired artifact before loading seller credentials', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-reclaim-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const holdFile = path.join(directory, 'hold.json')
  const address = (digit) => `0x${digit.repeat(40)}`
  fs.writeFileSync(holdFile, JSON.stringify({
    securityId: '0.0.123', security: address('1'), partition: `0x${'0'.repeat(63)}1`,
    seller: address('2'), buyer: address('3'), escrow: address('4'),
    holdId: '7', amount: '1000000', holdExpiry: String(Math.floor(Date.now() / 1000) + 3600),
  }))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'reclaim-hold.cjs'), '--execute'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      ATS_HOLD_FILE: holdFile,
      ATS_SECURITY_ID: '0.0.123',
      ATS_SECURITY_EVM_ADDRESS: address('1'),
      SELLER_EVM_ADDRESS: address('2'),
      BUYER_EVM_ADDRESS: address('3'),
      CLEARING_ESCROW_ADDRESS: address('4'),
    },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ATS hold has not expired/)
  assert.doesNotMatch(result.stderr, /HEDERA_SELLER_KEY/)
})

test('live hold reclaim confirms a zero balance before atomically publishing evidence', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/reclaim-hold.cjs'), 'utf8')
  assert.match(source, /HEDERA_OPERATOR_KEY: required\(process\.env, 'HEDERA_SELLER_KEY'\)/)
  assert.doesNotMatch(source, /required\(process\.env, 'HEDERA_OPERATOR_KEY'\)/)
  assert.match(source, /if \(after\.amount !== '0'\).*atomicWrite\(evidenceFile, artifact\)/s)
  assert.match(source, /fs\.writeFileSync\(temporary,.*fs\.renameSync\(temporary, file\)/s)
})

test('zero-amount recovery validates remaining live identity before writing resumed evidence', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/reclaim-hold.cjs'), 'utf8')
  assert.match(source, /if \(before\.amount === '0'\).*before\.expirationTimestamp !== '0'.*before\.escrow\.toLowerCase\(\) !== zeroAddress.*before\.destination\.toLowerCase\(\) !== zeroAddress/s)
  assert.match(source, /if \(before\.amount === '0'\).*reader\.findReclaim.*sameAddress\(reclaim\.operator.*sameAddress\(reclaim\.tokenHolder.*reclaim\.partition.*reclaim\.holdId.*reclaim\.amount/s)
  assert.match(source, /if \(before\.amount === '0'\).*resumed: true.*amountAfter: '0'.*observedClearedState.*reclaimEvent: reclaim.*atomicWrite\(evidenceFile, artifact\).*return output/s)
  assert.match(source, /previousEvidence\?\.transactionId \|\| reclaim\.transactionHash/)
})

test('ATS reader finds an exact reclaim event over a bounded recent block range', () => {
  const source = fs.readFileSync(path.join(root, 'packages/agent/src/ats.cjs'), 'utf8')
  assert.match(source, /event HoldByPartitionReclaimed\(address indexed operator,address indexed tokenHolder,bytes32 indexed partition,uint256 holdId,uint256 amount\)/)
  assert.match(source, /findReclaim.*HoldByPartitionReclaimed\(null, seller, partition\).*latestBlock - 100000.*candidate\.args\.holdId.*candidate\.args\.amount/s)
})

test('Hedera providers disable JSON-RPC batching for Hashio log compatibility', () => {
  for (const file of ['packages/agent/src/ats.cjs', 'packages/agent/src/hedera.cjs', 'scripts/replay.cjs']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(source, /new JsonRpcProvider\([^\n]+batchMaxCount: 1/)
  }
})

test('escrow event recovery uses a Hashio-compatible bounded block range', () => {
  const source = fs.readFileSync(path.join(root, 'packages/agent/src/ats.cjs'), 'utf8')
  assert.match(source, /recentEvents.*latestBlock - 100000.*findSettlement.*recentEvents.*findSettlementByDigest.*recentEvents/s)
})

test('HCS anchoring requires and returns the consensus sequence number', () => {
  const source = fs.readFileSync(path.join(root, 'packages/agent/src/hedera.cjs'), 'utf8')
  assert.match(source, /receipt\.topicSequenceNumber.*HCS receipt returned no topic sequence number.*topicSequenceNumber/s)
})

test('reclaim evidence is scoped to a full hold identity and rejects unrelated collisions', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/reclaim-hold.cjs'), 'utf8')
  assert.match(source, /createHash\('sha256'\).*identity\.securityId.*identity\.security.*identity\.partition.*identity\.seller.*identity\.buyer.*identity\.escrow.*holdId/s)
  assert.match(source, /existingEvidence\(evidenceFile, request\)/)
  assert.match(source, /already contains evidence for a different hold/)
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
