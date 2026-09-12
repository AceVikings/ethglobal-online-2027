'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buyVerdict, createPaidFetch, paymentReference } = require('../src/x402-buyer.cjs')

test('buyer refuses to initialize without a trusted payee', async () => {
  await assert.rejects(() => createPaidFetch({
    accountId: '0.0.123', privateKey: `0x${'1'.repeat(64)}`,
  }), /expectedPayTo must be a Hedera entity ID/)
})

test('buyer accepts an injected remote signer without local private-key material', async () => {
  const paidFetch = await createPaidFetch({
    accountId: '0.0.123',
    signer: { accountId: '0.0.123', createPartiallySignedTransferTransaction: async () => '' },
    expectedPayTo: '0.0.456',
  })
  assert.equal(typeof paidFetch, 'function')
})

test('reads the service x-payment-ref contract directly', () => {
  const response = { headers: new Headers({ 'x-payment-ref': '0.0.123@1.2' }) }
  assert.equal(paymentReference(response), '0.0.123@1.2')
})

test('reads a transaction id from standard encoded payment response', () => {
  const encoded = Buffer.from(JSON.stringify({ transactionId: '0.0.456@2.3' })).toString('base64url')
  const response = { headers: new Headers({ 'payment-response': encoded }) }
  assert.equal(paymentReference(response), '0.0.456@2.3')
})

test('paid verdict without payment evidence fails closed', async () => {
  const paidFetch = async () => new Response(JSON.stringify({ verdict: 'CONFORMANT' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
  await assert.rejects(() => buyVerdict({ url: 'https://example.test/verdict', body: {}, paidFetch }), /omitted x402 payment reference/)
})
