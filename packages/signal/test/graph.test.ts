import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GraphEvidenceError,
  GraphGatewayClient,
  GraphGatewayError,
  graphQueryHash,
} from '../src/graph.ts'

const deployment = 'QmExpectedDeployment'

function graphData(overrides: Record<string, unknown> = {}) {
  return {
    _meta: {
      deployment,
      hasIndexingErrors: false,
      block: { number: 123, timestamp: 1_000 },
    },
    ...overrides,
  }
}

test('Gateway sends bearer auth and returns data', async () => {
  let seen: RequestInit | undefined
  const client = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async (_url, init) => {
      seen = init
      return Response.json({ data: graphData({ markets: [{ id: 'one' }] }) })
    },
  })
  const data = await client.query<{ _meta: ReturnType<typeof graphData>['_meta']; markets: Array<{ id: string }> }>(
    deployment,
    '{ _meta { deployment } markets { id } }',
  )
  assert.equal(data.markets[0].id, 'one')
  assert.equal((seen?.headers as Record<string, string>).authorization, 'Bearer secret')
})

test('Gateway retries one transient failure but not GraphQL errors', async () => {
  let attempts = 0
  const transient = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async () => {
      attempts += 1
      if (attempts === 1) return Response.json({}, { status: 503 })
      return Response.json({ data: graphData({ ok: true }) })
    },
  })
  assert.deepEqual(await transient.query(deployment, '{ _meta { deployment } ok }'), graphData({ ok: true }))
  assert.equal(attempts, 2)

  attempts = 0
  const invalid = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async () => {
      attempts += 1
      return Response.json({ errors: [{ message: 'bad query' }] })
    },
  })
  await assert.rejects(() => invalid.query(deployment, 'bad'), GraphGatewayError)
  assert.equal(attempts, 1)
})

test('Gateway fails closed for invalid, mismatched, and malformed deployment metadata', async () => {
  for (const [body, code] of [
    [{ errors: [{ message: 'subgraph not found: invalid deployment ID' }] }, 'INVALID_DEPLOYMENT'],
    [{ data: graphData({ _meta: { ...graphData()._meta, deployment: 'QmWrong' } }) }, 'DEPLOYMENT_MISMATCH'],
    [{ data: { markets: [] } }, 'MALFORMED_RESPONSE'],
  ] as const) {
    const client = new GraphGatewayClient({ apiKey: 'secret', retries: 0, fetch: async () => Response.json(body) })
    await assert.rejects(
      () => client.query(deployment, '{ _meta { deployment hasIndexingErrors block { number timestamp } } }'),
      (error: unknown) => error instanceof GraphEvidenceError && error.code === code,
    )
  }
})

test('health inspection denies stale evidence and schema drift without returning raw rows', async () => {
  const fields = ['id', 'totalValueLockedUSD', 'totalBorrowBalanceUSD', 'totalDepositBalanceUSD', 'inputTokenBalance']
  const makeClient = (timestamp: number, returnedFields = fields) => new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async () => Response.json({
      data: graphData({
        _meta: { ...graphData()._meta, block: { number: 123, timestamp } },
        __type: { fields: returnedFields.map((name) => ({ name })) },
        markets: [{ id: 'raw-row-that-must-not-escape' }],
      }),
    }),
  })
  const catalog = { deploymentId: deployment, requiredMarketFields: fields }

  await assert.rejects(
    () => makeClient(900).inspectDeployment(catalog, { nowUnix: 1_000, maxAgeSeconds: 50 }),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === 'STALE',
  )
  const indexingClient = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async () => Response.json({
      data: graphData({
        _meta: { ...graphData()._meta, hasIndexingErrors: true },
        __type: { fields: fields.map((name) => ({ name })) },
        markets: [{ id: 'one' }],
      }),
    }),
  })
  await assert.rejects(
    () => indexingClient.inspectDeployment(catalog, { nowUnix: 1_000, maxAgeSeconds: 50 }),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === 'INDEXING_ERROR',
  )
  await assert.rejects(
    () => makeClient(990, fields.slice(0, -1)).inspectDeployment(catalog, { nowUnix: 1_000, maxAgeSeconds: 50 }),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === 'SCHEMA_DRIFT',
  )
  const emptyClient = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async () => Response.json({
      data: graphData({
        __type: { fields: fields.map((name) => ({ name })) },
        markets: [],
      }),
    }),
  })
  await assert.rejects(
    () => emptyClient.inspectDeployment(catalog, { nowUnix: 1_000, maxAgeSeconds: 50 }),
    (error: unknown) => error instanceof GraphEvidenceError && error.code === 'INVARIANT_FAILURE',
  )

  const result = await makeClient(990).inspectDeployment(catalog, { nowUnix: 1_000, maxAgeSeconds: 50 })
  assert.deepEqual(result, {
    deploymentId: deployment,
    status: 'healthy',
    block: 123,
    timestamp: 990,
    ageSeconds: 10,
    schemaFieldsChecked: fields.length,
  })
  assert.equal(JSON.stringify(result).includes('markets'), false)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('query hash is deterministic', () => {
  assert.equal(graphQueryHash('{ id }'), graphQueryHash('{ id }'))
  assert.notEqual(graphQueryHash('{ id }'), graphQueryHash('{ name }'))
})
