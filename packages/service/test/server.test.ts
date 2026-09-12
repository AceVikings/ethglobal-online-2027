import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createRequire } from 'node:module'
import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import {
  clearingPolicyHash, verifyClearingAuthorization, verifyVerdict, type Checks,
} from '@desk/signal'
import { createVerdictServer } from '../src/server.ts'

const require = createRequire(import.meta.url)
const { verifyClearingAuthorization: verifyBuyerAuthorization } = require('../../agent/src/decision.cjs')

const key = Wallet.createRandom().privateKey
function checks(cidPass = true): Checks {
  return {
    cidMatch: { pass: cidPass, served: 'QmServed', pinned: cidPass ? 'QmServed' : 'QmOther' },
    indexingErrors: { pass: true, value: false },
    freshness: { pass: true, lagBlocks: 1, bound: 50, block: 41, headBlock: 42 },
    shapeAgreement: { pass: true, peers: 6, fieldsCompared: 5, mismatches: 0, missingByDeployment: {}, extraByDeployment: {} },
    invariants: { pass: true, checked: 5, violations: [] },
  }
}
const policy = { pinnedCid: null, lagBoundBlocks: 50 }
const trade = {
  chainId: '296',
  verifyingContract: `0x${'11'.repeat(20)}`,
  security: `0x${'22'.repeat(20)}`,
  partition: `0x${'00'.repeat(31)}01`,
  seller: `0x${'33'.repeat(20)}`,
  buyer: `0x${'44'.repeat(20)}`,
  amount: '25000000',
  holdId: '7',
  holdExpiry: String(Date.parse('2026-09-12T11:00:00Z') / 1000),
  policyHash: clearingPolicyHash('messari/lending-v3.1', policy),
}
const server = createVerdictServer({
  signingKey: key,
  requestId: () => '00000000-0000-4000-8000-000000000000',
  now: () => new Date('2026-09-12T10:00:00.000Z'),
  nonce: () => `0x${'99'.repeat(32)}`,
  paymentGate: {
    async authorize(request) {
      return request.headers['x-paid'] === 'yes'
        ? { ok: true, paymentRef: '0.0.123@1.2' }
        : { ok: false, headers: { 'payment-required': 'test-challenge' } }
    },
  },
  async evaluator() {
    return {
      checks: checks(),
      verdict: 'CONFORMANT',
      evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{ _meta { deployment } }', block: 42 },
    }
  },
})

let base = ''
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing listen address')
  base = `http://127.0.0.1:${address.port}`
})
after(() => server.close())

const body = {
  clientRequestId: 'request-00000001',
  standard: 'messari/lending-v3.1',
  subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'QmSJ9orPipkLpMYz8Qk1gRAyYzvFSJWG7Vw9dx5YYopvt1' },
  policy,
  trade,
}

test('health is free and exposes no secrets', async () => {
  const response = await fetch(`${base}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: 'conformance-desk', version: 1 })
})

test('public trade routes are empty rather than mocked when no read model is configured', async () => {
  const response = await fetch(`${base}/api/v1/trades?limit=20`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { trades: [], nextCursor: null })
  const missing = await fetch(`${base}/api/v1/trades/0xdeadbeef`)
  assert.equal(missing.status, 404)
})

test('allows only the exact configured frontend origin to read the public API', async () => {
  assert.throws(() => createVerdictServer({
    signingKey: key, paymentGate: { async authorize() { return { ok: false } } },
    async evaluator() { throw new Error('unused') }, corsAllowedOrigin: 'https://example.com/path',
  }), /exact HTTP\(S\) origin/)

  const cors = createVerdictServer({
    signingKey: key,
    paymentGate: { async authorize() { return { ok: false } } },
    async evaluator() { throw new Error('unused') },
    corsAllowedOrigin: 'https://desk.example',
  })
  await new Promise<void>((resolve) => cors.listen(0, '127.0.0.1', resolve))
  try {
    const address = cors.address()
    if (!address || typeof address === 'string') throw new Error('missing listen address')
    const url = `http://127.0.0.1:${address.port}/api/v1/trades`
    const allowed = await fetch(url, { headers: { origin: 'https://desk.example' } })
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://desk.example')
    assert.equal(allowed.headers.get('vary'), 'Origin')

    const denied = await fetch(url, { headers: { origin: 'https://attacker.example' } })
    assert.equal(denied.headers.get('access-control-allow-origin'), null)

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: { origin: 'https://desk.example', 'access-control-request-method': 'GET' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET')
  } finally {
    cors.close()
  }
})

test('verdict is payment gated', async () => {
  const response = await fetch(`${base}/verdict`, { method: 'POST', body: JSON.stringify(body) })
  assert.equal(response.status, 402)
  assert.equal(response.headers.get('payment-required'), 'test-challenge')
})

test('paid response is derived and includes a payment-bound EIP-712 authorization', async () => {
  const response = await fetch(`${base}/verdict`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-paid': 'yes' }, body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  const result = await response.json() as any
  assert.equal(result.verdict, 'CONFORMANT')
  assert.equal(response.headers.get('x-payment-ref'), '0.0.123@1.2')
  assert.equal(verifyVerdict(result).ok, true)
  assert.equal(result.authorization.action, 1)
  assert.equal(result.authorization.paymentRef, keccak256(toUtf8Bytes('0.0.123@1.2')))
  assert.deepEqual(
    Object.fromEntries(Object.keys(trade).map((field) => [field, result.authorization[field]])),
    trade,
  )
  assert.equal(
    verifyClearingAuthorization(result.authorization, result.authorizationSignature, new Wallet(key).address).ok,
    true,
  )
  assert.deepEqual(verifyBuyerAuthorization(result), { ok: true, recovered: new Wallet(key).address })
  assert.equal('rows' in result, false)
})

test('a stable client request id returns one paid authorization without charging twice', async () => {
  let authorizations = 0
  let settlements = 0
  let evaluations = 0
  const idempotent = createVerdictServer({
    signingKey: key,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
    nonce: () => `0x${'88'.repeat(32)}`,
    paymentGate: { async authorize() {
      authorizations += 1
      return { ok: true, settle: async () => {
        settlements += 1
        return { paymentRef: '0.0.123@9.9', responseHeaders: {} }
      } }
    } },
    async evaluator() {
      evaluations += 1
      return {
        checks: checks(),
        verdict: 'CONFORMANT', evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 },
      }
    },
  })
  await new Promise<void>((resolve) => idempotent.listen(0, '127.0.0.1', resolve))
  try {
    const address = idempotent.address()
    if (!address || typeof address === 'string') throw new Error('missing listen address')
    const url = `http://127.0.0.1:${address.port}/verdict`
    const first = await fetch(url, { method: 'POST', body: JSON.stringify({ ...body, clientRequestId: 'retry-safe-0001' }) })
    const second = await fetch(url, { method: 'POST', body: JSON.stringify({ ...body, clientRequestId: 'retry-safe-0001' }) })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.deepEqual(await second.json(), await first.json())
    assert.deepEqual({ authorizations, settlements, evaluations }, { authorizations: 1, settlements: 1, evaluations: 1 })

    const conflict = await fetch(url, { method: 'POST', body: JSON.stringify({
      ...body, clientRequestId: 'retry-safe-0001', trade: { ...trade, amount: '25000001' },
    }) })
    assert.equal(conflict.status, 409)
  } finally {
    idempotent.close()
  }
})

test('derives DENY from every non-conformant deterministic verdict', async () => {
  const denied = createVerdictServer({
    signingKey: key,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
    nonce: () => `0x${'77'.repeat(32)}`,
    paymentGate: { async authorize() { return { ok: true, paymentRef: '0.0.123@8.8' } } },
    async evaluator() {
      return {
        checks: checks(false),
        verdict: 'NON_CONFORMANT', evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 },
      }
    },
  })
  await new Promise<void>((resolve) => denied.listen(0, '127.0.0.1', resolve))
  try {
    const address = denied.address()
    if (!address || typeof address === 'string') throw new Error('missing listen address')
    const response = await fetch(`http://127.0.0.1:${address.port}/verdict`, {
      method: 'POST', body: JSON.stringify({ ...body, clientRequestId: 'denied-request-0001' }),
    })
    assert.equal(response.status, 200)
    const result = await response.json() as any
    assert.equal(result.authorization.action, 2)
    assert.equal(verifyClearingAuthorization(
      result.authorization, result.authorizationSignature, new Wallet(key).address,
    ).ok, true)
  } finally {
    denied.close()
  }
})

test('rejects a policy-hash mismatch before authorizing or settling payment', async () => {
  let paymentCalls = 0
  const guarded = createVerdictServer({
    signingKey: key,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
    paymentGate: { async authorize() { paymentCalls += 1; return { ok: true, paymentRef: 'never' } } },
    async evaluator() { throw new Error('must not evaluate') },
  })
  await new Promise<void>((resolve) => guarded.listen(0, '127.0.0.1', resolve))
  try {
    const address = guarded.address()
    if (!address || typeof address === 'string') throw new Error('missing listen address')
    const response = await fetch(`http://127.0.0.1:${address.port}/verdict`, {
      method: 'POST', body: JSON.stringify({
        ...body,
        clientRequestId: 'bad-policy-0001',
        trade: { ...trade, policyHash: `0x${'ff'.repeat(32)}` },
      }),
    })
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), { error: 'verdict_unavailable' })
    assert.equal(paymentCalls, 0)
  } finally {
    guarded.close()
  }
})

test('settles only after evaluation and fails closed on settlement failure', async () => {
  const events: string[] = []
  const failing = createVerdictServer({
    signingKey: key,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
    paymentGate: { async authorize() { return { ok: true, settle: async () => {
      events.push('settle')
      throw new Error('settlement rejected')
    } } } },
    async evaluator() {
      events.push('evaluate')
      return {
        checks: checks(),
        verdict: 'CONFORMANT', evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 },
      }
    },
  })
  await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', resolve))
  try {
    const address = failing.address()
    if (!address || typeof address === 'string') throw new Error('missing listen address')
    const response = await fetch(`http://127.0.0.1:${address.port}/verdict`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.equal(response.status, 502)
    assert.deepEqual(events, ['evaluate', 'settle'])
  } finally {
    failing.close()
  }
})
