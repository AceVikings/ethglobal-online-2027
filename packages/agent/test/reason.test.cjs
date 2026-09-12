'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDecision, createReasoner } = require('../src/reason.cjs')

test('parses a bounded structured recommendation', () => {
  assert.deepEqual(parseDecision('```json\n{"recommendation":"REFUSE","rationale":"CID pin mismatch."}\n```'), {
    recommendation: 'REFUSE', rationale: 'CID pin mismatch.',
  })
  assert.throws(() => parseDecision('{"recommendation":"WAIT","rationale":"No."}'), /invalid recommendation/)
})

test('sends only derived verdict material and preserves the configured model', async () => {
  let request
  const reason = createReasoner({
    apiKey: 'fixture-key', model: 'fixture-model',
    client: { chat: { completions: { async create(value) {
      request = value
      return { choices: [{ message: { content: '{"recommendation":"ACT","rationale":"All signed checks passed."}' } }] }
    } } } },
  })
  const result = await reason({
    verdict: 'CONFORMANT', checks: { cidMatch: { pass: true } },
    subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'QmFixture' },
    policy: { pinnedCid: null, lagBoundBlocks: 50 },
  })
  assert.deepEqual(result, { recommendation: 'ACT', rationale: 'All signed checks passed.', model: 'fixture-model' })
  assert.equal(request.model, 'fixture-model')
  assert.equal(request.messages[0].content.includes('rows'), false)
})

test('maps action-bound clearing authorizations to the fixed explanation action', async () => {
  let request
  const reason = createReasoner({
    apiKey: 'fixture-key', model: 'fixture-model',
    client: { chat: { completions: { async create(value) {
      request = value
      return { choices: [{ message: { content: '{"recommendation":"ACT","rationale":"The signed action is approval."}' } }] }
    } } } },
  })

  await reason({ authorization: { action: 1, evidenceHash: `0x${'11'.repeat(32)}` }, checks: {} })

  assert.match(request.messages[0].content, /action 1 means APPROVE and requires ACT/)
  assert.equal(JSON.parse(request.messages[1].content).action, 1)
})

test('requires credentials only when the optional explanation path is constructed', () => {
  assert.throws(() => createReasoner({ model: 'deepseek-chat' }), /apiKey is required/)
  assert.throws(() => createReasoner({ apiKey: 'fixture-key' }), /model is required/)
})

test('uses the provider-neutral chat completions HTTP contract', async () => {
  let url
  let options
  const reason = createReasoner({
    apiKey: 'fixture-key',
    model: 'deepseek-chat',
    baseUrl: 'https://reasoner.example/v1/',
    async fetchImpl(requestUrl, requestOptions) {
      url = requestUrl
      options = requestOptions
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: '{"recommendation":"REFUSE","rationale":"Evidence is stale."}' } }] }
        },
      }
    },
  })

  assert.deepEqual(await reason({ verdict: 'STALE', checks: {} }), {
    recommendation: 'REFUSE', rationale: 'Evidence is stale.', model: 'deepseek-chat',
  })
  assert.equal(url, 'https://reasoner.example/v1/chat/completions')
  assert.equal(options.headers.authorization, 'Bearer fixture-key')
  assert.equal(options.body.includes('fixture-key'), false)
})

test('aborts an explanation request at the configured timeout', async () => {
  const reason = createReasoner({
    apiKey: 'fixture-key', model: 'deepseek-chat', timeoutMs: 100,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }),
  })
  await assert.rejects(() => reason({ verdict: 'CONFORMANT', checks: {} }), /timed out after 100ms/)
})
