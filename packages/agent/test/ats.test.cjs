'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createClearingEscrowAdapter, createEip1193Wallet, holdSettlementBalancesMatch,
} = require('../src/ats.cjs')

test('ATS Node adapter exposes the configured signer through EIP-1193', async () => {
  const sent = []
  const wallet = {
    address: `0x${'11'.repeat(20)}`,
    provider: { send: async (method, params) => ({ method, params }) },
    sendTransaction: async (request) => { sent.push(request); return { hash: `0x${'22'.repeat(32)}` } },
  }
  const ethereum = createEip1193Wallet(wallet)
  assert.deepEqual(await ethereum.request({ method: 'eth_accounts' }), [wallet.address])
  assert.equal(await ethereum.request({ method: 'eth_chainId' }), '0x128')
  assert.deepEqual(await ethereum.request({ method: 'eth_blockNumber', params: [] }), {
    method: 'eth_blockNumber', params: [],
  })
  assert.equal(await ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: wallet.address, to: `0x${'33'.repeat(20)}`, data: '0x1234', gas: '0x5208' }],
  }), `0x${'22'.repeat(32)}`)
  assert.deepEqual(sent, [{ to: `0x${'33'.repeat(20)}`, data: '0x1234', value: undefined, gasLimit: '0x5208' }])
  await assert.rejects(() => ethereum.request({
    method: 'eth_sendTransaction', params: [{ from: `0x${'44'.repeat(20)}` }],
  }), /sender does not match/)
})

test('clearing escrow adapter rejects missing connection inputs', () => {
  assert.throws(() => createClearingEscrowAdapter(null, '0x0000000000000000000000000000000000000001'), /provider or signer/)
  assert.throws(() => createClearingEscrowAdapter({}, ''), /address is required/)
})

test('ATS settlement checks balanceOf semantics for held units', () => {
  const held = { seller: '0', buyer: '500000' }
  assert.equal(holdSettlementBalancesMatch(1, '1000000', held, {
    seller: '0', buyer: '1500000',
  }), true)
  assert.equal(holdSettlementBalancesMatch(2, '1000000', held, {
    seller: '1000000', buyer: '500000',
  }), true)
  assert.equal(holdSettlementBalancesMatch(1, '1000000', held, {
    seller: '1000000', buyer: '1500000',
  }), false)
  assert.equal(holdSettlementBalancesMatch(2, '1000000', held, {
    seller: '0', buyer: '500000',
  }), false)
  assert.equal(holdSettlementBalancesMatch(3, '1000000', held, held), false)
})
