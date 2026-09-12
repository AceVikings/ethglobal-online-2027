import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import {
  clearingEvidenceHash,
  clearingPolicyHash,
  signClearingAuthorization,
  signVerdict,
} from '@desk/signal'
import { createMcpHandler } from '../src/server.ts'

test('lists and calls get_conformance_verdict with one exact trade and no raw provider rows', async () => {
  const wallet = Wallet.createRandom()
  const policy = { pinnedCid: null, lagBoundBlocks: 50 }
  const trade = {
    chainId: '296', verifyingContract: `0x${'11'.repeat(20)}`, security: `0x${'22'.repeat(20)}`,
    partition: `0x${'00'.repeat(31)}01`, seller: `0x${'33'.repeat(20)}`, buyer: `0x${'44'.repeat(20)}`,
    amount: '25', holdId: '7', holdExpiry: '1789225200',
    policyHash: clearingPolicyHash('messari/lending-v3.1', policy),
  }
  const checks = {
    cidMatch: { pass: true, served: 'QmDeployment', pinned: null },
    indexingErrors: { pass: true, value: false },
    freshness: { pass: true, lagBlocks: 1, bound: 50, block: 41, headBlock: 42 },
    shapeAgreement: { pass: true, peers: 5, fieldsCompared: 5, mismatches: 0, missingByDeployment: {}, extraByDeployment: {} },
    invariants: { pass: true, checked: 5, violations: [] },
  }
  const signed = signVerdict({
    v: 1, requestId: 'request-123', issuedAt: '2026-09-12T10:00:00.000Z', standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'ethereum', deploymentId: 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd' },
    policy, checks, verdict: 'CONFORMANT',
    evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 }, signer: wallet.address,
  }, wallet.privateKey)
  const authorization = {
    ...trade, action: 1 as const,
    evidenceHash: clearingEvidenceHash({
      standard: signed.standard, subject: signed.subject, policy: signed.policy,
      checks: signed.checks, verdict: signed.verdict, evidence: signed.evidence,
    }),
    paymentRef: keccak256(toUtf8Bytes('0.0.123@1.2')),
    issuedAt: '1789207200', authorizationExpiry: '1789207500', nonce: `0x${'99'.repeat(32)}`,
  }
  const response = {
    ...signed,
    authorization,
    authorizationSignature: signClearingAuthorization(authorization, wallet.privateKey),
  }
  const handle = createMcpHandler({
    serviceUrl: 'https://seller.invalid', expectedSigner: wallet.address,
    paymentFetch: async () => new Response(JSON.stringify(response), {
      status: 200, headers: { 'x-payment-ref': '0.0.123@1.2' },
    }),
  })

  const listed = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any
  const schema = listed.result.tools[0].inputSchema
  assert.equal(listed.result.tools[0].name, 'get_conformance_verdict')
  assert.deepEqual(schema.required, ['clientRequestId', 'protocol', 'network', 'deploymentId', 'trade'])
  assert.equal(schema.properties.trade.additionalProperties, false)

  const called = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'get_conformance_verdict', arguments: {
      clientRequestId: 'request-00000001', protocol: 'aave-v3', network: 'ethereum',
      deploymentId: signed.subject.deploymentId, trade,
    },
  } }) as any
  assert.equal(called.result.structuredContent.verdict, 'CONFORMANT')
  assert.equal(called.result.structuredContent.authorization.holdId, '7')
  assert.equal('rows' in called.result.structuredContent, false)
})

test('tool rejects calls that omit the exact trade contract', async () => {
  const handle = createMcpHandler({
    serviceUrl: 'https://seller.invalid', expectedSigner: Wallet.createRandom().address,
    paymentFetch: async () => { throw new Error('must not fetch') },
  })
  const called = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'get_conformance_verdict', arguments: {
      clientRequestId: 'request-00000001', protocol: 'aave-v3', network: 'ethereum', deploymentId: 'QmDeployment',
    },
  } }) as any
  assert.equal(called.error.code, -32602)
})
