import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkCidMatch,
  checkConformance,
  checkFreshness,
  checkInvariants,
  checkShapeAgreement,
  buildVerdictPayload,
} from '../src/checks.ts'

const policy = { pinnedCid: 'QmPinned', lagBoundBlocks: 50 }
const schemas = [
  { deploymentId: 'subject', fields: ['id', 'totalValueLockedUSD'] },
  { deploymentId: 'peer', fields: ['totalValueLockedUSD', 'id'] },
]
const markets = [
  {
    id: 'market-1',
    totalValueLockedUSD: '100',
    totalBorrowBalanceUSD: '40',
    totalDepositBalanceUSD: '60',
    inputTokenBalance: '10',
  },
]

test('CID pin is caller-controlled and nullable', () => {
  assert.deepEqual(checkCidMatch('QmServed', null), { pass: true, served: 'QmServed', pinned: null })
  assert.equal(checkCidMatch('QmServed', 'QmPinned').pass, false)
})

test('freshness clamps a provider ahead of head to zero lag', () => {
  assert.deepEqual(checkFreshness(110, 100, 0), {
    pass: true,
    lagBlocks: 0,
    bound: 0,
    block: 110,
    headBlock: 100,
  })
  assert.equal(checkFreshness(49, 100, 50).pass, false)
  assert.throws(() => checkFreshness(-1, 100, 50), /indexedBlock/)
})

test('shape agreement ignores ordering and reports exact field drift', () => {
  assert.equal(checkShapeAgreement(schemas).pass, true)
  assert.deepEqual(
    checkShapeAgreement([
      schemas[0],
      { deploymentId: 'drifted', fields: ['id', 'unexpected'] },
    ]),
    {
      pass: false,
      peers: 1,
      fieldsCompared: 2,
      mismatches: 2,
      missingByDeployment: { drifted: ['totalValueLockedUSD'] },
      extraByDeployment: { drifted: ['unexpected'] },
    },
  )
})

test('standardized shape agreement permits protocol-specific extension fields', () => {
  const result = checkShapeAgreement([
    { deploymentId: 'subject', fields: ['id', 'totalValueLockedUSD', 'subjectExtension'] },
    { deploymentId: 'peer', fields: ['peerExtension', 'totalValueLockedUSD', 'id'] },
  ], ['id', 'totalValueLockedUSD'])

  assert.equal(result.pass, true)
  assert.deepEqual(result.extraByDeployment, {})
  assert.equal(result.fieldsCompared, 2)
})

test('invariants report bad and missing numeric values plus timestamp regression', () => {
  const result = checkInvariants(
    [{ id: 'bad', totalValueLockedUSD: -1, totalBorrowBalanceUSD: 5, totalDepositBalanceUSD: 4 }],
    99,
    100,
  )
  assert.equal(result.pass, false)
  assert.equal(result.checked, 4)
  assert.equal(result.violations.length, 4)
})

test('verdict precedence is non-conformant, disagreement, stale, conformant', () => {
  const baseline = {
    policy,
    servedCid: 'QmPinned',
    hasIndexingErrors: false,
    indexedBlock: 100,
    headBlock: 120,
    schemas,
    markets,
    indexedTimestamp: 200,
    previousIndexedTimestamp: 100,
  }
  assert.equal(checkConformance(baseline).verdict, 'CONFORMANT')
  assert.equal(checkConformance({ ...baseline, indexedBlock: 1 }).verdict, 'STALE')
  assert.equal(
    checkConformance({
      ...baseline,
      indexedBlock: 1,
      schemas: [schemas[0], { deploymentId: 'peer', fields: ['id'] }],
    }).verdict,
    'DISAGREEMENT',
  )
  assert.equal(
    checkConformance({
      ...baseline,
      indexedBlock: 1,
      schemas: [schemas[0], { deploymentId: 'peer', fields: ['id'] }],
      servedCid: 'QmOther',
    }).verdict,
    'NON_CONFORMANT',
  )
})

test('payload builder carries normalized evidence into an unsigned verdict', () => {
  const result = buildVerdictPayload({
    requestId: 'request-1',
    issuedAt: '2026-09-13T09:14:02Z',
    standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'QmDeployment' },
    policy,
    servedCid: 'QmPinned',
    hasIndexingErrors: false,
    indexedBlock: 100,
    headBlock: 120,
    schemas,
    markets,
    signer: '0x0000000000000000000000000000000000000001',
    evidence: { queryHash: `0x${'11'.repeat(32)}`, queryText: '{ markets { id } }', block: 100 },
  })
  assert.equal(result.v, 1)
  assert.equal(result.verdict, 'CONFORMANT')
  assert.equal(result.checks.freshness.lagBlocks, 20)
  assert.equal('signature' in result, false)
})
