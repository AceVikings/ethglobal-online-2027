'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseDecision, createAnthropicReasoner } = require('../src/reason.cjs')

test('parses a bounded structured recommendation', () => {
  assert.deepEqual(parseDecision('```json\n{"recommendation":"REFUSE","rationale":"CID pin mismatch."}\n```'), {
    recommendation: 'REFUSE', rationale: 'CID pin mismatch.',
  })
  assert.throws(() => parseDecision('{"recommendation":"WAIT","rationale":"No."}'), /invalid recommendation/)
})

test('sends only derived verdict material and preserves the configured model', async () => {
  let request
  const reason = createAnthropicReasoner({
    apiKey: 'fixture-key', model: 'fixture-model',
    client: { messages: { async create(value) {
      request = value
      return { content: [{ type: 'text', text: '{"recommendation":"ACT","rationale":"All signed checks passed."}' }] }
    } } },
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
