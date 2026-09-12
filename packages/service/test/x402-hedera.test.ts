import assert from 'node:assert/strict'
import test from 'node:test'
import type { IncomingMessage } from 'node:http'
import { createPaymentGate } from '../src/adapters/x402-hedera.ts'
import { paymentGateFromEnv } from '../src/x402.ts'

const body = {
  standard: 'messari/lending-v3.1' as const,
  subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9' },
  policy: { pinnedCid: null, lagBoundBlocks: 50 },
}

test('constructs a Blocky402 v2 Hedera exact challenge offline', async () => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'hedera:testnet', extra: { feePayer: '0.0.7162784' } }],
      extensions: [], signers: {},
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const gate = createPaymentGate({
      facilitatorUrl: 'https://api.testnet.blocky402.com', network: 'hedera:testnet', payTo: '0.0.1234', price: '$0.01',
    })
    const request = { method: 'POST', url: '/verdict', headers: { accept: 'application/json' } } as unknown as IncomingMessage
    const result = await gate.authorize(request, body)
    assert.equal(result.ok, false)
    assert.equal(result.status, 402)
    assert.ok(result.headers?.['PAYMENT-REQUIRED'])
    assert.deepEqual(calls, ['https://api.testnet.blocky402.com/supported'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects non-testnet or insecure payment configuration', () => {
  assert.throws(() => createPaymentGate({
    facilitatorUrl: 'https://api.testnet.blocky402.com', network: 'hedera:mainnet', payTo: '0.0.1234', price: '$0.01',
  }), /only hedera:testnet/)
  assert.throws(() => createPaymentGate({
    facilitatorUrl: 'http://localhost:4021', network: 'hedera:testnet', payTo: '0.0.1234', price: '$0.01',
  }), /must use HTTPS/)
})

test('the environment loader defaults to the concrete Hedera adapter', async () => {
  const gate = await paymentGateFromEnv({
    X402_FACILITATOR_URL: 'https://api.testnet.blocky402.com',
    X402_NETWORK: 'hedera:testnet', X402_PAY_TO: '0.0.1234', X402_PRICE_USDC: '0.01',
  })
  assert.equal(typeof gate.authorize, 'function')
})
