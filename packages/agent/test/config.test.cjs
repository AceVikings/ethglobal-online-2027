'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadConfig } = require('../src/config.cjs')

test('dry-run config validates without credentials', () => {
  const config = loadConfig({}, { live: false })
  assert.equal(config.network, 'testnet')
  assert.equal(config.usdcTokenId, '0.0.429274')
})

test('live config fails closed without credentials', () => {
  assert.throws(() => loadConfig({}, { live: true }), /HEDERA_OPERATOR_ID/)
})

test('live config rejects ED25519-shaped input', () => {
  assert.throws(() => loadConfig({ HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'not-a-key' }, { live: true }), /Invalid HEDERA_OPERATOR_KEY/)
})
