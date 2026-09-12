'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { assertRestrictedTopic, mirrorContractResult } = require('../src/hedera.cjs')

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

test('contract result lookup resolves the Hedera transaction ID by its consensus timestamp', async () => {
  const requested = []
  const fetchResult = async (url) => {
    requested.push(url)
    if (url.includes('/contracts/results/')) {
      return new Response(JSON.stringify({ hash: '0xabc', timestamp: '1789244004.225533521', result: 'SUCCESS' }))
    }
    return new Response(JSON.stringify({ transactions: [{ transaction_id: '0.0.7-1789244000-000000001' }] }))
  }
  const result = await mirrorContractResult(config, '0xabc', fetchResult)
  assert.equal(result.transaction_id, '0.0.7-1789244000-000000001')
  assert.match(requested[1], /timestamp=eq:1789244004\.225533521/)
})
