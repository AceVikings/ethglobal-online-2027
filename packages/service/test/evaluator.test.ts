import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluatorFromEnv } from '../src/evaluator.ts'

test('defaults to the concrete Graph evaluator with the canonical key name', async () => {
  const evaluator = await evaluatorFromEnv({
    GRAPH_STUDIO_KEY: 'fixture-key',
    GRAPH_GATEWAY_BASE: 'https://gateway.example/api/deployments/id',
    GRAPH_MCP_URL: 'https://mcp.example/sse',
  })
  assert.equal(typeof evaluator, 'function')
})

test('fails closed without the seller-side Graph credential', async () => {
  await assert.rejects(() => evaluatorFromEnv({}), /GRAPH_STUDIO_KEY/)
})
