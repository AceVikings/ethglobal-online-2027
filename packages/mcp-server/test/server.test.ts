import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceToken, verifyServiceToken } from '../src/auth.ts'
import { createMcpHttpServer } from '../src/http.ts'
import { createMcpHandler } from '../src/server.ts'

const secret = 'test-secret-that-is-at-least-thirty-two-bytes-long'
const issuer = 'https://auth.desk.test'
const audience = 'https://mcp.desk.test/mcp'

function token(scopes: string[], subject = 'did:privy:user-1') {
  return createServiceToken({ subject, clientId: 'codex-demo', scopes }, {
    secret, issuer, audience, ttlSeconds: 300, now: () => 1_800_000_000,
  })
}

test('signed service tokens enforce signature, issuer, audience, expiry, and subject', () => {
  const value = token(['offerings:read'])
  const claims = verifyServiceToken(value, { secret, issuer, audience, now: () => 1_800_000_001 })
  assert.equal(claims.sub, 'did:privy:user-1')
  assert.deepEqual(claims.scopes, ['offerings:read'])
  assert.throws(() => verifyServiceToken(value, {
    secret: `${secret}!`, issuer, audience, now: () => 1_800_000_001,
  }), /signature/)
  assert.throws(() => verifyServiceToken(value, {
    secret, issuer, audience: 'https://other.invalid/mcp', now: () => 1_800_000_001,
  }), /audience/)
  assert.throws(() => verifyServiceToken(value, {
    secret, issuer, audience, now: () => 1_800_000_301,
  }), /expired/)
})

test('MCP exposes bounded tools and denies missing scopes before backend access', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const bearer = token(['offerings:read'])
  const handle = createMcpHandler({
    backendUrl: 'https://api.desk.test',
    backendFetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return Response.json({ offerings: [{ id: 'bond-1' }] })
    },
  })
  const principal = { ...verifyServiceToken(bearer, {
    secret, issuer, audience, now: () => 1_800_000_001,
  }), rawToken: bearer }

  const listed = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, principal) as any
  assert.deepEqual(listed.result.tools.map((item: any) => item.name), ['list_offerings'])

  const denied = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'list_vaults', arguments: {},
  } }, principal) as any
  assert.equal(denied.error.code, -32003)
  assert.equal(calls.length, 0)

  const called = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
    name: 'list_offerings', arguments: {},
  } }, principal) as any
  assert.equal(called.result.structuredContent.offerings[0].id, 'bond-1')
  assert.equal(calls[0].url, 'https://api.desk.test/api/v1/offerings')
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), `Bearer ${bearer}`)
})

test('run tools never accept an owner id and preserve approval boundaries', async () => {
  let request: { url: string; body: any } | undefined
  const bearer = token(['runs:request', 'runs:read', 'proof:read'])
  const principal = { ...verifyServiceToken(bearer, { secret, issuer, audience, now: () => 1_800_000_001 }), rawToken: bearer }
  const handle = createMcpHandler({
    backendUrl: 'https://api.desk.test',
    backendFetch: async (input, init) => {
      request = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined }
      return Response.json({ status: 'approval_required', approvalUrl: 'https://desk.test/approve/opaque' }, { status: 202 })
    },
  })
  const denied = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
    name: 'request_run', arguments: { vaultId: 'vault-1', requestId: 'req-1', ownerId: 'did:privy:other' },
  } }, principal) as any
  assert.equal(denied.error.code, -32602)

  const approved = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {
    name: 'request_run', arguments: { vaultId: 'vault-1', requestId: 'req-1' },
  } }, principal) as any
  assert.equal(approved.result.structuredContent.status, 'approval_required')
  assert.deepEqual(request, {
    url: 'https://api.desk.test/api/v1/vaults/vault-1/run-requests',
    body: { requestId: 'req-1' },
  })
})

test('vault drafts reject fields outside the bounded nested schema', async () => {
  let backendCalls = 0
  const bearer = token(['vaults:write'])
  const principal = { ...verifyServiceToken(bearer, { secret, issuer, audience, now: () => 1_800_000_001 }), rawToken: bearer }
  const handle = createMcpHandler({
    backendUrl: 'https://api.desk.test', backendFetch: async () => { backendCalls += 1; return Response.json({}) },
  })
  const result = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
    name: 'create_vault_draft', arguments: { offeringId: 'bond-1', units: '2', risk: { maxLagBlocks: 20, rawWalletRpc: true } },
  } }, principal) as any
  assert.equal(result.error.code, -32602)
  assert.equal(backendCalls, 0)
})

test('HTTP transport publishes discovery and requires bearer auth for MCP POST', async () => {
  const server = createMcpHttpServer({
    backendUrl: 'https://api.desk.test', secret, issuer, audience,
    backendFetch: async () => Response.json({ offerings: [] }), now: () => 1_800_000_001,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    const base = `http://127.0.0.1:${address.port}`
    const discovery = await fetch(`${base}/.well-known/oauth-protected-resource`)
    assert.equal(discovery.status, 200)
    assert.deepEqual(await discovery.json(), {
      resource: audience,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['offerings:read', 'vaults:read', 'vaults:write', 'runs:request', 'runs:read', 'proof:read'],
    })

    const denied = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' })
    assert.equal(denied.status, 401)
    assert.match(denied.headers.get('www-authenticate') ?? '', /Bearer/)

    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token(['offerings:read'])}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as any).result.tools[0].name, 'list_offerings')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
