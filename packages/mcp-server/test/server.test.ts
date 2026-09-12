import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { signVerdict } from '@desk/signal'
import { createMcpHandler } from '../src/server.ts'

test('lists and calls get_conformance_verdict without exposing raw provider rows', async () => {
  const wallet = Wallet.createRandom()
  const signed = signVerdict({
    v: 1, requestId: 'request-123', issuedAt: '2026-09-12T10:00:00.000Z', standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9' },
    policy: { pinnedCid: null, lagBoundBlocks: 50 },
    checks: { cidMatch: { pass: true }, indexingErrors: { pass: true }, freshness: { pass: true }, shapeAgreement: { pass: true }, invariants: { pass: true } },
    verdict: 'CONFORMANT', evidence: { queryHash: `0x${'ab'.repeat(32)}`, queryText: '{}', block: 42 }, signer: wallet.address,
  }, wallet.privateKey)
  const handle = createMcpHandler({
    serviceUrl: 'https://seller.invalid', expectedSigner: wallet.address,
    paymentFetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
  })

  const listed = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any
  assert.equal(listed.result.tools[0].name, 'get_conformance_verdict')
  const called = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'get_conformance_verdict', arguments: { protocol: 'aave-v3', network: 'base', deploymentId: signed.subject.deploymentId },
  } }) as any
  assert.equal(called.result.structuredContent.verdict, 'CONFORMANT')
  assert.equal('rows' in called.result.structuredContent, false)
})
