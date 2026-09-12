import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Wallet } from 'ethers'
import { verifyVerdict } from '@desk/signal'
import { createVerdictServer } from '../src/server.ts'

const key = Wallet.createRandom().privateKey
const server = createVerdictServer({
  signingKey: key,
  requestId: () => '00000000-0000-4000-8000-000000000000',
  now: () => new Date('2026-09-12T10:00:00.000Z'),
  paymentGate: {
    async authorize(request) {
      return request.headers['x-paid'] === 'yes'
        ? { ok: true, paymentRef: '0.0.123@1.2' }
        : { ok: false, headers: { 'payment-required': 'test-challenge' } }
    },
  },
  async evaluator() {
    return {
      checks: {
        cidMatch: { pass: true }, indexingErrors: { pass: true }, freshness: { pass: true },
        shapeAgreement: { pass: true }, invariants: { pass: true },
      },
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
  standard: 'messari/lending-v3.1',
  subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9' },
  policy: { pinnedCid: null, lagBoundBlocks: 50 },
}

test('health is free and exposes no secrets', async () => {
  const response = await fetch(`${base}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, service: 'conformance-desk', version: 1 })
})

test('verdict is payment gated', async () => {
  const response = await fetch(`${base}/verdict`, { method: 'POST', body: JSON.stringify(body) })
  assert.equal(response.status, 402)
  assert.equal(response.headers.get('payment-required'), 'test-challenge')
})

test('paid response is derived and signed', async () => {
  const response = await fetch(`${base}/verdict`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-paid': 'yes' }, body: JSON.stringify(body),
  })
  assert.equal(response.status, 200)
  const result = await response.json() as any
  assert.equal(result.verdict, 'CONFORMANT')
  assert.equal(response.headers.get('x-payment-ref'), '0.0.123@1.2')
  assert.equal(verifyVerdict(result).ok, true)
  assert.equal('rows' in result, false)
})
