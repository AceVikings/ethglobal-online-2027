import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import {
  clearingEvidenceHash,
  clearingPolicyHash,
  signClearingAuthorization,
  signVerdict,
  type SignedClearingVerdict,
} from '@desk/signal'
import { createVerdictServer } from '../../service/src/server.ts'
import { getVerdict, type CheckInput } from '../src/client.ts'

const checks = {
  cidMatch: { pass: true, served: 'QmDeployment', pinned: null },
  indexingErrors: { pass: true, value: false },
  freshness: { pass: true, lagBlocks: 1, bound: 50, block: 41, headBlock: 42 },
  shapeAgreement: { pass: true, peers: 5, fieldsCompared: 5, mismatches: 0, missingByDeployment: {}, extraByDeployment: {} },
  invariants: { pass: true, checked: 5, violations: [] },
}
const policy = { pinnedCid: null, lagBoundBlocks: 50 }
const trade = {
  chainId: '296',
  verifyingContract: `0x${'11'.repeat(20)}`,
  security: `0x${'22'.repeat(20)}`,
  partition: `0x${'00'.repeat(31)}01`,
  seller: `0x${'33'.repeat(20)}`,
  buyer: `0x${'44'.repeat(20)}`,
  amount: '25',
  holdId: '7',
  holdExpiry: '1789225200',
  policyHash: clearingPolicyHash('messari/lending-v3.1', policy),
}
const input: CheckInput = {
  clientRequestId: 'request-00000001',
  standard: 'messari/lending-v3.1',
  subject: { protocol: 'aave-v3', network: 'ethereum', deploymentId: 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd' },
  policy,
  trade,
}

function signedResponse(wallet: Wallet, paymentRef = '0.0.123@1.2'): SignedClearingVerdict {
  const signed = signVerdict({
    v: 1,
    requestId: 'request-123',
    issuedAt: '2026-09-12T10:00:00.000Z',
    standard: input.standard,
    subject: input.subject,
    policy: input.policy,
    checks,
    verdict: 'CONFORMANT',
    evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{ _meta { deployment } }', block: 42 },
    signer: wallet.address,
  }, wallet.privateKey)
  const authorization = {
    ...trade,
    action: 1 as const,
    evidenceHash: clearingEvidenceHash({
      standard: signed.standard,
      subject: signed.subject,
      policy: signed.policy,
      checks: signed.checks,
      verdict: signed.verdict,
      evidence: signed.evidence,
    }),
    paymentRef: keccak256(toUtf8Bytes(paymentRef)),
    issuedAt: '1789207200',
    authorizationExpiry: '1789207500',
    nonce: `0x${'99'.repeat(32)}`,
  }
  return {
    ...signed,
    authorization,
    authorizationSignature: signClearingAuthorization(authorization, wallet.privateKey),
  }
}

test('consumer verifies both signatures, the exact trade, evidence, and settled payment', async () => {
  const wallet = Wallet.createRandom()
  const signed = signedResponse(wallet)
  const result = await getVerdict({
    serviceUrl: 'https://seller.invalid',
    expectedSigner: wallet.address,
    input,
    paymentFetch: async () => new Response(JSON.stringify(signed), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-payment-ref': '0.0.123@1.2' },
    }),
  })
  assert.equal(result.verdict.verdict, 'CONFORMANT')
  assert.equal(result.paymentRef, '0.0.123@1.2')
})

test('consumer rejects a wrong signer and a separately valid but misbound authorization', async () => {
  const wallet = Wallet.createRandom()
  await assert.rejects(() => getVerdict({
    serviceUrl: 'https://seller.invalid',
    input,
    expectedSigner: Wallet.createRandom().address,
    paymentFetch: async () => new Response(JSON.stringify(signedResponse(wallet)), {
      status: 200,
      headers: { 'x-payment-ref': '0.0.123@1.2' },
    }),
  }), /unexpected verdict signer/)

  const mismatched = signedResponse(wallet, '0.0.123@9.9')
  await assert.rejects(() => getVerdict({
    serviceUrl: 'https://seller.invalid',
    input,
    expectedSigner: wallet.address,
    paymentFetch: async () => new Response(JSON.stringify(mismatched), {
      status: 200,
      headers: { 'x-payment-ref': '0.0.123@1.2' },
    }),
  }), /paymentRef does not match/)
})

test('client contract integrates with the real verdict service handler', async () => {
  const wallet = Wallet.createRandom()
  const server = createVerdictServer({
    signingKey: wallet.privateKey,
    now: () => new Date('2026-09-12T10:00:00.000Z'),
    nonce: () => `0x${'88'.repeat(32)}`,
    paymentGate: { async authorize() { return { ok: true, paymentRef: '0.0.123@1.2' } } },
    async evaluator() {
      return {
        checks,
        verdict: 'CONFORMANT',
        evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 },
      }
    },
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing server address')
    const result = await getVerdict({
      serviceUrl: `http://127.0.0.1:${address.port}`,
      expectedSigner: wallet.address,
      input,
    })
    assert.equal(result.verdict.authorization.amount, trade.amount)
    assert.equal(result.paymentRef, '0.0.123@1.2')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
