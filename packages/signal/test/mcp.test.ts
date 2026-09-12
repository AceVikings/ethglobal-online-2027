import assert from 'node:assert/strict'
import test from 'node:test'
import { SubgraphMcpClient, SUBGRAPH_MCP_TOOLS } from '../src/mcp.ts'

test('MCP SSE transport initializes and invokes a named tool', async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const posts: Array<Record<string, unknown>> = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      controller.enqueue(encoder.encode('event: endpoint\ndata: /messages?session=test\n\n'))
    },
  })

  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    if (!init?.method) return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    posts.push(body)
    if (body.id !== undefined) {
      const result = body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '1' } }
        : { structuredContent: { count: 42 } }
      queueMicrotask(() => {
        streamController.enqueue(
          encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`),
        )
      })
    }
    return new Response(null, { status: 202 })
  }

  const client = new SubgraphMcpClient({ apiKey: 'secret', endpoint: 'https://example.test/sse', fetch: mockFetch })
  const result = await client.getDeployment30DayQueryCounts<{ count: number }>(['QmDeployment'])
  assert.deepEqual(result, { count: 42 })
  assert.deepEqual(posts.map((post) => post.method), ['initialize', 'notifications/initialized', 'tools/call'])
  assert.deepEqual((posts[2].params as { arguments: unknown }).arguments, { ipfs_hashes: ['QmDeployment'] })
  client.close()
})

test('tool constants cover all five required Graph MCP capabilities', () => {
  assert.deepEqual(Object.values(SUBGRAPH_MCP_TOOLS).slice(0, 5), [
    'search_subgraphs_by_keyword',
    'get_top_subgraph_deployments',
    'get_deployment_30day_query_counts',
    'execute_query_by_deployment_id',
    'get_schema_by_deployment_id',
  ])
})

test('deployment query tools reject mismatched response metadata', async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      controller.enqueue(encoder.encode('event: endpoint\ndata: /messages?session=test\n\n'))
    },
  })
  const mockFetch: typeof globalThis.fetch = async (_input, init) => {
    if (!init?.method) return new Response(stream)
    const body = JSON.parse(String(init.body)) as { id?: number; method: string }
    if (body.id !== undefined) {
      const result = body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '1' } }
        : { structuredContent: { data: { _meta: { deployment: 'QmWrong' } } } }
      queueMicrotask(() => streamController.enqueue(encoder.encode(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`,
      )))
    }
    return new Response(null, { status: 202 })
  }
  const client = new SubgraphMcpClient({ apiKey: 'secret', endpoint: 'https://example.test/sse', fetch: mockFetch })
  await assert.rejects(
    () => client.executeQueryByDeploymentId('QmExpected', '{ _meta { deployment } }'),
    /deployment metadata mismatch/,
  )
  client.close()
})
