'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { assertRestrictedTopic } = require('../src/hedera.cjs')

const config = { mirrorNodeUrl: 'https://testnet.mirrornode.hedera.com' }

test('audit preflight rejects a publicly writable HCS topic', async () => {
  const publicTopic = async () => new Response(JSON.stringify({ topic_id: '0.0.1', submit_key: null }))
  await assert.rejects(() => assertRestrictedTopic(config, '0.0.1', publicTopic), /must have a submit key/)
})

test('audit preflight accepts a submit-key-restricted HCS topic', async () => {
  let requested
  const restrictedTopic = async (url) => {
    requested = url
    return new Response(JSON.stringify({ topic_id: '0.0.2', submit_key: { _type: 'ECDSA_SECP256K1', key: '02aa' } }))
  }
  assert.deepEqual(await assertRestrictedTopic(config, '0.0.2', restrictedTopic), {
    topicId: '0.0.2', restricted: true,
  })
  assert.equal(requested, 'https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.2')
})
