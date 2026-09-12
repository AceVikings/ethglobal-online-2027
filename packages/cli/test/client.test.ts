import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { signVerdict } from '@desk/signal'
import { getVerdict } from '../src/client.ts'

const checks = {
  cidMatch: { pass: true }, indexingErrors: { pass: true }, freshness: { pass: true },
  shapeAgreement: { pass: true }, invariants: { pass: true },
}

test('consumer verifies a seller signature and preserves the payment reference', async () => {
  const wallet = Wallet.createRandom()
  const signed = signVerdict({
    v: 1, requestId: 'request-123', issuedAt: '2026-09-12T10:00:00.000Z', standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9' },
    policy: { pinnedCid: null, lagBoundBlocks: 50 }, checks, verdict: 'CONFORMANT',
    evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{ _meta { deployment } }', block: 42 }, signer: wallet.address,
  }, wallet.privateKey)

  const result = await getVerdict({
    serviceUrl: 'https://seller.invalid', expectedSigner: wallet.address,
    input: { standard: 'messari/lending-v3.1', subject: signed.subject, policy: signed.policy },
    paymentFetch: async () => new Response(JSON.stringify(signed), {
      status: 200, headers: { 'content-type': 'application/json', 'x-payment-ref': '0.0.123@1.2' },
    }),
  })
  assert.equal(result.verdict.verdict, 'CONFORMANT')
  assert.equal(result.paymentRef, '0.0.123@1.2')
})

test('consumer rejects a response signed by an unexpected seller', async () => {
  const wallet = Wallet.createRandom()
  const signed = signVerdict({
    v: 1, requestId: 'request-123', issuedAt: '2026-09-12T10:00:00.000Z', standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9' },
    policy: { pinnedCid: null, lagBoundBlocks: 50 }, checks, verdict: 'CONFORMANT',
    evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 }, signer: wallet.address,
  }, wallet.privateKey)
  await assert.rejects(() => getVerdict({
    serviceUrl: 'https://seller.invalid', input: { standard: 'messari/lending-v3.1', subject: signed.subject, policy: signed.policy },
    expectedSigner: Wallet.createRandom().address,
    paymentFetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
  }), /unexpected verdict signer/)
})
