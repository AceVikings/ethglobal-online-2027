import assert from 'node:assert/strict'
import test from 'node:test'
import { GraphGatewayClient, GraphGatewayError, graphQueryHash } from '../src/graph.ts'

test('Gateway sends bearer auth and returns data', async () => {
  let seen: RequestInit | undefined
  const client = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async (_url, init) => {
      seen = init
      return Response.json({ data: { markets: [{ id: 'one' }] } })
    },
  })
  const data = await client.query<{ markets: Array<{ id: string }> }>('deployment', '{ markets { id } }')
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
      return Response.json({ data: { ok: true } })
    },
  })
  assert.deepEqual(await transient.query('deployment', '{ ok }'), { ok: true })
  assert.equal(attempts, 2)

  attempts = 0
  const invalid = new GraphGatewayClient({
    apiKey: 'secret',
    fetch: async () => {
      attempts += 1
      return Response.json({ errors: [{ message: 'bad query' }] })
    },
  })
  await assert.rejects(() => invalid.query('deployment', 'bad'), GraphGatewayError)
  assert.equal(attempts, 1)
})

test('query hash is deterministic', () => {
  assert.equal(graphQueryHash('{ id }'), graphQueryHash('{ id }'))
  assert.notEqual(graphQueryHash('{ id }'), graphQueryHash('{ name }'))
})
