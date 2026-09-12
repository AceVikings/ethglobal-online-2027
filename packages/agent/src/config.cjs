'use strict'

const ENTITY_ID = /^0\.0\.\d+$/
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/

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
  const config = {
    network: env.HEDERA_NETWORK || 'testnet',
    mirrorNodeUrl: env.HEDERA_MIRROR_NODE_URL || 'https://testnet.mirrornode.hedera.com',
    rpcUrl: env.HEDERA_RPC_URL || 'https://testnet.hashio.io/api',
    facilitatorUrl: env.X402_FACILITATOR_URL || 'https://api.testnet.blocky402.com',
    usdcTokenId: env.HEDERA_USDC_TOKEN_ID || '0.0.429274',
    factoryId: env.ATS_FACTORY_ID || '0.0.9213391',
    resolverId: env.ATS_RESOLVER_ID || '0.0.9212226',
    serviceUrl: env.CONFORMANCE_SERVICE_URL || 'http://127.0.0.1:4021/verdict',
    execute: live,
  }
  if (config.network !== 'testnet') throw new Error('Only Hedera testnet is enabled by this project')
  assertMatch(config.usdcTokenId, ENTITY_ID, 'HEDERA_USDC_TOKEN_ID')
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

module.exports = { ENTITY_ID, EVM_ADDRESS, PRIVATE_KEY, loadConfig, required, assertMatch }
