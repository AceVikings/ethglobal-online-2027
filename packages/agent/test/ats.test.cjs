'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createClearingEscrowAdapter } = require('../src/ats.cjs')

test('clearing escrow adapter rejects missing connection inputs', () => {
  assert.throws(() => createClearingEscrowAdapter(null, '0x0000000000000000000000000000000000000001'), /provider or signer/)
  assert.throws(() => createClearingEscrowAdapter({}, ''), /address is required/)
})
