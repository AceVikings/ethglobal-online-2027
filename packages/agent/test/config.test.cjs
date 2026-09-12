'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadConfig } = require('../src/config.cjs')

test('dry-run config validates without credentials', () => {
  const config = loadConfig({}, { live: false })
  assert.equal(config.network, 'testnet')
  assert.equal(config.usdcTokenId, '0.0.429274')
  assert.equal(config.rpcUrl, 'https://testnet.hashio.io/api')
  assert.equal(config.serviceUrl, 'http://127.0.0.1:4020/verdict')
  assert.equal(config.x402FeePayer, '0.0.7162784')
  assert.equal(config.x402PriceUsd, '0.01')
})

test('config consumes canonical env names from .env.example and service', () => {
  const config = loadConfig({
    HEDERA_JSON_RPC: 'https://rpc.example.test', HTS_USDC_ID: '0.0.99',
    X402_NETWORK: 'hedera:testnet', X402_SCHEME: 'exact', X402_FEE_PAYER: '0.0.77',
    X402_PRICE_USDC: '0.02', HOST: 'localhost', PORT: '4999',
  })
  assert.equal(config.rpcUrl, 'https://rpc.example.test')
  assert.equal(config.usdcTokenId, '0.0.99')
  assert.equal(config.serviceUrl, 'http://localhost:4999/verdict')

  const example = fs.readFileSync(path.resolve(__dirname, '../../../.env.example'), 'utf8')
  for (const name of ['HEDERA_JSON_RPC', 'HTS_USDC_ID', 'X402_NETWORK', 'X402_SCHEME', 'X402_FEE_PAYER', 'X402_PRICE_USDC']) assert.match(example, new RegExp(`^${name}=`, 'm'))
  const source = fs.readFileSync(path.resolve(__dirname, '../src/config.cjs'), 'utf8')
  assert.doesNotMatch(source, /HEDERA_RPC_URL|HEDERA_USDC_TOKEN_ID|CONFORMANCE_SERVICE_URL/)
})

test('live config fails closed without credentials', () => {
  assert.throws(() => loadConfig({}, { live: true }), /HEDERA_OPERATOR_ID/)
})

test('live config rejects a malformed operator key', () => {
  assert.throws(() => loadConfig({ HEDERA_OPERATOR_ID: '0.0.1', HEDERA_OPERATOR_KEY: 'not-a-key' }, { live: true }), /Invalid HEDERA_OPERATOR_KEY/)
})

test('invalid service port fails in dry-run and live modes consistently', () => {
  assert.throws(() => loadConfig({ PORT: '0' }, { live: false }), /Invalid PORT/)
  assert.throws(() => loadConfig({ PORT: '65536' }, { live: true }), /Invalid PORT/)
})

test('unsupported x402 scheme fails before credentials are loaded', () => {
  assert.throws(() => loadConfig({ X402_SCHEME: 'other' }, { live: false }), /X402_SCHEME must be exact/)
})
