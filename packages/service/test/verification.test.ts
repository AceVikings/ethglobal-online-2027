import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { createPublicTradeVerifier } from '../src/verification.ts'

const digest = `0x${'ab'.repeat(32)}`
const deploymentId = 'QmVerifiedDeployment'
const paymentId = '0.0.101@1789207201.000000001'
const settlementId = '0.0.102@1789207202.000000002'
const topicId = '0.0.103'
const sequence = 7
const requests: Array<{ url: string; method: string; authorization?: string; body: string }> = []

const upstream = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  requests.push({
    url: request.url ?? '', method: request.method ?? '',
    authorization: request.headers.authorization, body,
  })
  response.setHeader('content-type', 'application/json')
  if (request.url === `/graph/${deploymentId}`) {
    response.end(JSON.stringify({ data: { _meta: {
      deployment: deploymentId, hasIndexingErrors: false, block: { number: 123456 },
    } } }))
    return
  }
  if (request.url?.startsWith('/api/v1/transactions/')) {
    response.end(JSON.stringify({ transactions: [{ transaction_id: '0.0.101-1789207201-000000001', result: 'SUCCESS' }] }))
    return
  }
  if (request.url?.startsWith('/api/v1/contracts/results/')) {
    response.end(JSON.stringify({ transaction_id: '0.0.102-1789207202-000000002', result: 'SUCCESS' }))
    return
  }
  if (request.url === `/api/v1/topics/${topicId}/messages/${sequence}`) {
    response.end(JSON.stringify({
      sequence_number: sequence,
      message: Buffer.from(JSON.stringify({ t: 'CLEARING_DECISION', tradeDigest: digest })).toString('base64'),
    }))
    return
  }
  response.writeHead(404).end(JSON.stringify({ error: 'not_found' }))
})

let base = ''
before(async () => {
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('missing listen address')
  base = `http://127.0.0.1:${address.port}`
})
after(() => upstream.close())

const trade = {
  tradeDigest: digest,
  state: 'EXECUTED',
  payment: { transactionId: paymentId },
  decision: { evidence: { deploymentId, block: 123456 } },
  settlement: { transactionId: settlementId, hcsTopicId: topicId, hcsSequenceNumber: sequence },
}

test('replays a confirmed trade against real HTTP upstream responses', async () => {
  requests.length = 0
  const verifier = createPublicTradeVerifier({
    graphApiKey: 'server-only-key', graphGatewayUrl: `${base}/graph`, mirrorNodeUrl: base,
    now: () => new Date('2026-09-12T10:05:00.000Z'),
  })
  const report = await verifier.verify(trade)

  assert.equal(report.status, 'VERIFIED')
  assert.deepEqual(report.summary, { passed: 4, failed: 0, total: 4 })
  assert.deepEqual(report.stages.map(({ id, status }) => ({ id, status })), [
    { id: 'graph_evidence', status: 'PASS' },
    { id: 'x402_payment', status: 'PASS' },
    { id: 'ats_settlement', status: 'PASS' },
    { id: 'hcs_audit', status: 'PASS' },
  ])
  assert.equal(requests.length, 4)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].authorization, 'Bearer server-only-key')
  assert.deepEqual(JSON.parse(requests[0].body).variables, { block: 123456 })
  assert.equal(requests[1].url, '/api/v1/transactions/0.0.101-1789207201-000000001')
  assert.equal(JSON.stringify(report).includes('server-only-key'), false)
})

test('returns honest stage failures when an upstream proof does not match', async () => {
  const verifier = createPublicTradeVerifier({
    graphApiKey: 'server-only-key', graphGatewayUrl: `${base}/graph`, mirrorNodeUrl: base,
    fetch: async (input, init) => {
      if (String(input).includes('/transactions/')) {
        return Response.json({ transactions: [{ transaction_id: '0.0.999-1-2', result: 'SUCCESS' }] })
      }
      return fetch(input, init)
    },
  })
  const report = await verifier.verify(trade)
  assert.equal(report.status, 'FAILED')
  assert.deepEqual(report.summary, { passed: 3, failed: 1, total: 4 })
  assert.equal(report.stages.find((item) => item.id === 'x402_payment')?.status, 'FAIL')
})

test('rejects unfinished or incomplete local trade records before contacting upstreams', async () => {
  let called = false
  const verifier = createPublicTradeVerifier({
    graphApiKey: 'server-only-key',
    fetch: async () => { called = true; throw new Error('must not fetch') },
  })
  await assert.rejects(() => verifier.verify({ ...trade, state: 'PAID' }), /not confirmed/)
  await assert.rejects(() => verifier.verify({ ...trade, settlement: null }), /no anchored settlement/)
  assert.equal(called, false)
})
