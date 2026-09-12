#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {
  BYTES32, ENTITY_ID, EVM_ADDRESS, assertMatch, connectAts, createHoldAdapter, createHoldReader,
  executeRequested, loadConfig, output, required, run,
} = require('./lib/common.cjs')

const UINT = /^\d+$/

function positiveUint(value, name) {
  if (!UINT.test(value) || BigInt(value) <= 0n) throw new Error(`Invalid ${name}`)
  return value
}

run(async () => {
  const execute = executeRequested()
  const expiry = positiveUint(process.env.ATS_HOLD_EXPIRY || String(Math.floor(Date.now() / 1000) + 3600), 'ATS_HOLD_EXPIRY')
  const request = {
    securityId: process.env.ATS_SECURITY_ID || '<ATS_SECURITY_ID>',
    security: process.env.ATS_SECURITY_EVM_ADDRESS || '<ATS_SECURITY_EVM_ADDRESS>',
    partition: process.env.ATS_PARTITION || `0x${'0'.repeat(63)}1`,
    seller: process.env.SELLER_EVM_ADDRESS || '<SELLER_EVM_ADDRESS>',
    buyer: process.env.BUYER_EVM_ADDRESS || '<BUYER_EVM_ADDRESS>',
    escrow: process.env.CLEARING_ESCROW_ADDRESS || '<CLEARING_ESCROW_ADDRESS>',
    amount: process.env.TRADE_AMOUNT || '1',
    holdExpiry: expiry,
  }
  const holdFile = path.resolve(process.cwd(), process.env.ATS_HOLD_FILE || '.context/ats-hold.json')
  const intentFile = `${holdFile}.intent`
  if (!execute) return output({
    mode: 'dry-run', signer: 'seller-only', action: 'ATS createHoldByPartition', request, holdFile,
  })

  request.securityId = assertMatch(required(process.env, 'ATS_SECURITY_ID'), ENTITY_ID, 'ATS_SECURITY_ID')
  request.security = assertMatch(required(process.env, 'ATS_SECURITY_EVM_ADDRESS'), EVM_ADDRESS, 'ATS_SECURITY_EVM_ADDRESS')
  request.partition = assertMatch(request.partition, BYTES32, 'ATS_PARTITION')
  request.seller = assertMatch(required(process.env, 'SELLER_EVM_ADDRESS'), EVM_ADDRESS, 'SELLER_EVM_ADDRESS')
  request.buyer = assertMatch(required(process.env, 'BUYER_EVM_ADDRESS'), EVM_ADDRESS, 'BUYER_EVM_ADDRESS')
  request.escrow = assertMatch(required(process.env, 'CLEARING_ESCROW_ADDRESS'), EVM_ADDRESS, 'CLEARING_ESCROW_ADDRESS')
  request.amount = positiveUint(required(process.env, 'TRADE_AMOUNT'), 'TRADE_AMOUNT')
  if (BigInt(request.holdExpiry) <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('ATS_HOLD_EXPIRY must be in the future')

  const sellerEnv = {
    ...process.env,
    HEDERA_OPERATOR_ID: required(process.env, 'HEDERA_SELLER_ID'),
    HEDERA_OPERATOR_KEY: required(process.env, 'HEDERA_SELLER_KEY'),
    CONFORMANCE_EXPECTED_SIGNER: required(process.env, 'CONFORMANCE_EXPECTED_SIGNER'),
  }
  const sellerConfig = loadConfig(sellerEnv, { live: true })
  const { ats, wallet } = await connectAts(sellerConfig)
  if (wallet.address.toLowerCase() !== request.seller.toLowerCase()) {
    throw new Error('HEDERA_SELLER_KEY does not match SELLER_EVM_ADDRESS')
  }
  if (fs.existsSync(intentFile)) {
    throw new Error(`Unresolved hold creation intent at ${intentFile}; inspect ATS state before retrying`)
  }
  fs.mkdirSync(path.dirname(holdFile), { recursive: true })
  fs.writeFileSync(intentFile, `${JSON.stringify({ request, preparedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
  const result = await createHoldAdapter(ats, request.securityId).create({
    partition: request.partition,
    escrowId: request.escrow,
    amount: request.amount,
    buyerId: request.buyer,
    expirationDate: request.holdExpiry,
  })
  const holdId = result?.payload
  if (!Number.isSafeInteger(holdId) || holdId <= 0) throw new Error('ATS createHoldByPartition returned no valid hold ID')
  const onchain = await createHoldReader(wallet.provider, request.security).get({
    partition: request.partition,
    seller: request.seller,
    holdId: String(holdId),
  })
  if (onchain.escrow.toLowerCase() !== request.escrow.toLowerCase() ||
      onchain.destination.toLowerCase() !== request.buyer.toLowerCase()) {
    throw new Error('created ATS hold does not match escrow or buyer')
  }
  const transactionHash = result.transactionId
  const receipt = transactionHash?.startsWith('0x') ? await wallet.provider.waitForTransaction(transactionHash) : null
  const block = receipt ? await wallet.provider.getBlock(receipt.blockNumber) : null
  const artifact = {
    ...request,
    amount: onchain.amount,
    holdExpiry: onchain.expirationTimestamp,
    holdId: String(holdId),
    transactionId: transactionHash,
    createdAt: block ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString(),
  }
  const temporary = `${holdFile}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, holdFile)
  fs.unlinkSync(intentFile)
  output({ mode: 'execute', holdFile, holdId: artifact.holdId, transactionId: artifact.transactionId })
})
