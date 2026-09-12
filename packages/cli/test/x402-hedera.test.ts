import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { createPaymentFetch } from '../src/adapters/x402-hedera.ts'
import { paymentFetchFromEnv } from '../src/client.ts'

test('constructs the Hedera v2 client and leaves non-402 responses untouched', async () => {
  let calls = 0
  const baseFetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  const paymentFetch = createPaymentFetch({
    baseFetch: baseFetch as typeof fetch,
    env: {
      HEDERA_ACCOUNT_ID: '0.0.1001',
      HEDERA_PRIVATE_KEY: Wallet.createRandom().privateKey,
      X402_EXPECTED_PAY_TO: '0.0.2002',
      X402_NETWORK: 'hedera:testnet',
      X402_MAX_PRICE: '$0.10',
    },
  })
  const response = await paymentFetch('https://seller.invalid/health')
  assert.equal(response.status, 200)
  assert.equal(calls, 1)
})

test('fails closed without a pinned seller account or with the wrong network', () => {
  const base = {
    HEDERA_ACCOUNT_ID: '0.0.1001',
    HEDERA_PRIVATE_KEY: Wallet.createRandom().privateKey,
    X402_EXPECTED_PAY_TO: '0.0.2002',
  }
  assert.throws(() => createPaymentFetch({ baseFetch: fetch, env: { ...base, X402_EXPECTED_PAY_TO: '' } }),
    /X402_EXPECTED_PAY_TO is required/)
  assert.throws(() => createPaymentFetch({ baseFetch: fetch, env: { ...base, X402_NETWORK: 'hedera:mainnet' } }),
    /only hedera:testnet/)
})

test('the environment loader defaults to the concrete Hedera adapter', async () => {
  const paymentFetch = await paymentFetchFromEnv({
    HEDERA_ACCOUNT_ID: '0.0.1001', HEDERA_PRIVATE_KEY: Wallet.createRandom().privateKey,
    X402_EXPECTED_PAY_TO: '0.0.2002', X402_NETWORK: 'hedera:testnet', X402_MAX_PRICE: '$0.10',
  })
  assert.equal(typeof paymentFetch, 'function')
})
