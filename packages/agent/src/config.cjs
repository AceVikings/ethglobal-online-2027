'use strict'

const ENTITY_ID = /^0\.0\.\d+$/
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/

function required(env, key) {
  const value = env[key]
  if (!value) throw new Error(`Missing required environment variable ${key}`)
  return value
}

function assertMatch(value, pattern, key) {
  if (!pattern.test(value)) throw new Error(`Invalid ${key}`)
  return value
}

function loadConfig(env = process.env, { live = false } = {}) {
  const host = env.HOST || '127.0.0.1'
  const port = env.PORT || '4020'
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid PORT')
  const config = {
    network: env.HEDERA_NETWORK || 'testnet',
    mirrorNodeUrl: 'https://testnet.mirrornode.hedera.com',
    rpcUrl: env.HEDERA_JSON_RPC || 'https://testnet.hashio.io/api',
    facilitatorUrl: env.X402_FACILITATOR_URL || 'https://api.testnet.blocky402.com',
    x402Network: env.X402_NETWORK || 'hedera:testnet',
    x402Scheme: env.X402_SCHEME || 'exact',
    x402FeePayer: env.X402_FEE_PAYER || '0.0.7162784',
    x402PriceUsd: env.X402_PRICE_USDC || '0.01',
    x402PayTo: env.X402_PAY_TO,
    usdcTokenId: env.HTS_USDC_ID || '0.0.429274',
    factoryId: env.ATS_FACTORY_ID || '0.0.9213391',
    resolverId: env.ATS_RESOLVER_ID || '0.0.9212226',
    serviceUrl: `http://${host}:${port}/verdict`,
    execute: live,
  }
  if (config.network !== 'testnet') throw new Error('Only Hedera testnet is enabled by this project')
  if (config.x402Network !== 'hedera:testnet') throw new Error('X402_NETWORK must be hedera:testnet')
  if (config.x402Scheme !== 'exact') throw new Error('X402_SCHEME must be exact')
  assertMatch(config.x402FeePayer, ENTITY_ID, 'X402_FEE_PAYER')
  if (!/^\d+(\.\d+)?$/.test(config.x402PriceUsd) || Number(config.x402PriceUsd) <= 0) throw new Error('Invalid X402_PRICE_USDC')
  if (config.x402PayTo) assertMatch(config.x402PayTo, ENTITY_ID, 'X402_PAY_TO')
  assertMatch(config.usdcTokenId, ENTITY_ID, 'HTS_USDC_ID')
  assertMatch(config.factoryId, ENTITY_ID, 'ATS_FACTORY_ID')
  assertMatch(config.resolverId, ENTITY_ID, 'ATS_RESOLVER_ID')
  for (const key of ['mirrorNodeUrl', 'rpcUrl', 'facilitatorUrl', 'serviceUrl']) new URL(config[key])

  if (live) {
    config.operatorId = assertMatch(required(env, 'HEDERA_OPERATOR_ID'), ENTITY_ID, 'HEDERA_OPERATOR_ID')
    config.operatorKey = assertMatch(required(env, 'HEDERA_OPERATOR_KEY'), PRIVATE_KEY, 'HEDERA_OPERATOR_KEY')
    if (env.ATS_SECURITY_ID) config.securityId = assertMatch(env.ATS_SECURITY_ID, ENTITY_ID, 'ATS_SECURITY_ID')
    if (env.CONFORMANCE_GATE_ADDRESS) config.gateAddress = assertMatch(env.CONFORMANCE_GATE_ADDRESS, EVM_ADDRESS, 'CONFORMANCE_GATE_ADDRESS')
  }
  return config
}

module.exports = { ENTITY_ID, EVM_ADDRESS, PRIVATE_KEY, BYTES32, loadConfig, required, assertMatch }
