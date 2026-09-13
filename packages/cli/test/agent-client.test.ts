import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentClient } from '../src/agent-client.ts'

test('agent client maps identity, vault, run, history, and proof routes', async () => {
  const calls: Array<{ url: string; method: string; body?: unknown; authorization: string | null }> = []
  const client = new AgentClient({
    baseUrl: 'https://api.desk.test/', token: 'signed-token',
    fetch: async (input, init) => {
      calls.push({
        url: String(input), method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        authorization: new Headers(init?.headers).get('authorization'),
      })
      return Response.json({ ok: true })
    },
  })
  await client.whoami()
  await client.offerings()
  await client.listVaults()
  await client.createVault({ offeringId: 'bond-1', units: '2' })
  await client.requestRun('vault/one', { requestId: 'req-1' })
  await client.history('vault/one')
  await client.verify('run/one')

  assert.deepEqual(calls.map(({ url, method }) => ({ url, method })), [
    { url: 'https://api.desk.test/api/v1/me', method: 'GET' },
    { url: 'https://api.desk.test/api/v1/offerings', method: 'GET' },
    { url: 'https://api.desk.test/api/v1/vaults', method: 'GET' },
    { url: 'https://api.desk.test/api/v1/vaults', method: 'POST' },
    { url: 'https://api.desk.test/api/v1/vaults/vault%2Fone/run-requests', method: 'POST' },
    { url: 'https://api.desk.test/api/v1/vaults/vault%2Fone/runs', method: 'GET' },
    { url: 'https://api.desk.test/api/v1/runs/run%2Fone/proof', method: 'GET' },
  ])
  assert.ok(calls.every(call => call.authorization === 'Bearer signed-token'))
  assert.deepEqual(calls[3].body, { offeringId: 'bond-1', units: '2' })
})

test('agent client reports bounded backend errors without leaking bodies', async () => {
  const client = new AgentClient({
    baseUrl: 'https://api.desk.test', token: 'secret-token',
    fetch: async () => new Response('upstream secret and stack', { status: 403 }),
  })
  await assert.rejects(() => client.listVaults(), { message: 'API request failed with HTTP 403' })
})

test('agent client watches replayable SSE with bearer auth and Last-Event-ID', async () => {
  let headers = new Headers()
  const client = new AgentClient({
    baseUrl: 'https://api.desk.test', token: 'signed-token',
    fetch: async (_input, init) => {
      headers = new Headers(init?.headers)
      return new Response('id: 8\r\ndata: {"sequence":8}\r\n\r\nid: 9\ndata: {"sequence":9}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    },
  })
  const events: unknown[] = []
  for await (const event of client.watch('run-1', '7')) events.push(event)
  assert.deepEqual(events, [{ sequence: 8 }, { sequence: 9 }])
  assert.equal(headers.get('authorization'), 'Bearer signed-token')
  assert.equal(headers.get('last-event-id'), '7')
})
