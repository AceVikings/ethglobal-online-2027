import assert from 'node:assert/strict'
import test from 'node:test'
import { LENDING_DEPLOYMENTS } from '@desk/signal'
import { createVerdictEvaluator, marketFieldsFromSchema } from '../src/index.ts'
import { MARKET_SCHEMA, snapshotFixtures } from './fixtures.ts'

const target = LENDING_DEPLOYMENTS[3]

function harness(options: {
  snapshots?: ReturnType<typeof snapshotFixtures>
  schemas?: Map<string, string>
  head?: number
} = {}) {
  const snapshots = options.snapshots ?? snapshotFixtures()
  const schemas = options.schemas ?? new Map(LENDING_DEPLOYMENTS.map((item) => [item.deploymentId, MARKET_SCHEMA]))
  const gatewayCalls: string[] = []
  const schemaCalls: string[] = []
  const searches: string[] = []
  const countCalls: string[][] = []
  const evaluator = createVerdictEvaluator({
    graphApiKey: 'fixture-key',
    graphGatewayUrl: 'https://fixture.test/api/subgraphs/id',
    graphMcpUrl: 'https://fixture.test/sse',
    gatewayClient: {
      async readEntities(deploymentId) {
        gatewayCalls.push(deploymentId)
        const value = snapshots.get(deploymentId)
        if (!value) throw new Error('missing snapshot fixture')
        return structuredClone(value) as never
      },
    },
    mcpClient: {
      async searchSubgraphsByKeyword(keyword) {
        searches.push(keyword)
        return { results: [] }
      },
      async getDeployment30DayQueryCounts(ids) {
        countCalls.push([...ids])
        return { counts: [] }
      },
      async getSchemaByIpfsHash(id) {
        schemaCalls.push(id)
        return { schema: schemas.get(id) }
      },
    },
    headBlockProvider: async () => options.head ?? 1_020,
  })
  return { evaluator, gatewayCalls, schemaCalls, searches, countCalls }
}

function request(pin: string | null = target.deploymentId) {
  return {
    standard: 'messari/lending-v3.1' as const,
    subject: {
      protocol: target.protocol,
      network: target.network,
      deploymentId: target.deploymentId,
    },
    policy: { pinnedCid: pin, lagBoundBlocks: 50 },
  }
}

test('evaluates the target against all six Gateway snapshots and schemas', async () => {
  const { evaluator, gatewayCalls, schemaCalls, searches, countCalls } = harness()
  const result = await evaluator(request())

  assert.equal(result.verdict, 'CONFORMANT')
  assert.equal(result.checks.shapeAgreement.peers, 5)
  assert.equal(gatewayCalls.length, 6)
  assert.equal(schemaCalls.length, 6)
  assert.deepEqual(searches, [target.protocol])
  assert.equal(countCalls[0].length, 6)
  assert.equal(result.evidence.block, 1_003)
  assert.equal(JSON.stringify(result).includes('market-one'), false)
  assert.deepEqual(Object.keys(result).sort(), ['checks', 'evidence', 'verdict'])
})

test('caller pin mismatch deterministically produces NON_CONFORMANT', async () => {
  const { evaluator } = harness()
  const result = await evaluator(request('QmDefinitelyDifferent'))
  assert.equal(result.verdict, 'NON_CONFORMANT')
  assert.equal(result.checks.cidMatch.pass, false)
  assert.equal(result.checks.cidMatch.served, target.deploymentId)
})

test('schema drift across a peer produces DISAGREEMENT', async () => {
  const schemas = new Map(LENDING_DEPLOYMENTS.map((item) => [item.deploymentId, MARKET_SCHEMA]))
  schemas.set(
    LENDING_DEPLOYMENTS[0].deploymentId,
    MARKET_SCHEMA.replace('    inputTokenBalance: BigInt!\n', ''),
  )
  const { evaluator } = harness({ schemas })
  const result = await evaluator(request())
  assert.equal(result.verdict, 'DISAGREEMENT')
  assert.equal(result.checks.shapeAgreement.mismatches, 1)
})

test('protocol-specific schema extensions do not violate the shared standard', async () => {
  const schemas = new Map(LENDING_DEPLOYMENTS.map((item) => [item.deploymentId, MARKET_SCHEMA]))
  schemas.set(LENDING_DEPLOYMENTS[0].deploymentId, MARKET_SCHEMA.replace('}', '    protocolExtension: String\n}'))
  const { evaluator } = harness({ schemas })
  const result = await evaluator(request())
  assert.equal(result.checks.shapeAgreement.pass, true)
})

test('fails closed when a Gateway response identifies a different deployment', async () => {
  const snapshots = snapshotFixtures()
  const mismatched = snapshots.get(LENDING_DEPLOYMENTS[0].deploymentId) as { _meta: { deployment: string } }
  mismatched._meta.deployment = LENDING_DEPLOYMENTS[1].deploymentId
  const { evaluator } = harness({ snapshots })
  await assert.rejects(() => evaluator(request()), /Graph served deployment/)
})

test('tight caller freshness bound produces STALE', async () => {
  const { evaluator } = harness({ head: 2_000 })
  const input = request()
  input.policy.lagBoundBlocks = 1
  const result = await evaluator(input)
  assert.equal(result.verdict, 'STALE')
  assert.equal(result.checks.freshness.lagBlocks, 997)
})

test('timestamp regression is detected between polls without poisoning stored state', async () => {
  const snapshots = snapshotFixtures()
  const { evaluator } = harness({ snapshots })
  assert.equal((await evaluator(request())).verdict, 'CONFORMANT')

  const current = snapshots.get(target.deploymentId) as { _meta: { block: { timestamp: number } } }
  current._meta.block.timestamp -= 100
  const regressed = await evaluator(request())
  assert.equal(regressed.verdict, 'NON_CONFORMANT')
  assert.ok(regressed.checks.invariants.violations.includes('_meta.block.timestamp must be monotonic'))
})

test('rejects a subject that does not match the six-deployment catalog', async () => {
  const { evaluator, gatewayCalls } = harness()
  await assert.rejects(
    () => evaluator({ ...request(), subject: { ...request().subject, deploymentId: 'QmUnknown' } }),
    /does not match catalog/,
  )
  assert.equal(gatewayCalls.length, 0)
})

test('schema parser accepts nested MCP response envelopes and ignores field order', () => {
  assert.deepEqual(marketFieldsFromSchema({ content: [{ text: MARKET_SCHEMA }] }), [
    'id',
    'inputTokenBalance',
    'totalBorrowBalanceUSD',
    'totalDepositBalanceUSD',
    'totalValueLockedUSD',
  ])
  assert.throws(() => marketFieldsFromSchema({ schema: 'type Pool { id: ID! }' }), /Market schema/)
})
