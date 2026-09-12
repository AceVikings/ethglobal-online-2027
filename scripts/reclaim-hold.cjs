#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const {
  BYTES32, ENTITY_ID, EVM_ADDRESS, assertMatch, connectAts, createHoldAdapter, createHoldReader,
  executeRequested, loadConfig, output, required, run, txId,
} = require('./lib/common.cjs')

const UINT = /^\d+$/

function positiveUint(value, name) {
  const normalized = String(value)
  if (!UINT.test(normalized) || BigInt(normalized) <= 0n) throw new Error(`Invalid ${name}`)
  return normalized
}

function sameAddress(actual, expected, name) {
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${name} does not match ATS_HOLD_FILE`)
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function evidenceIdentity(value) {
  if (!value || ![value.securityId, value.security, value.partition, value.seller, value.buyer, value.escrow]
    .every((field) => typeof field === 'string') || value.holdId === undefined) return null
  return [value.securityId, value.security.toLowerCase(), value.partition.toLowerCase(), value.seller.toLowerCase(),
    value.buyer.toLowerCase(), value.escrow.toLowerCase(), String(value.holdId)]
}

function existingEvidence(file, request) {
  if (!fs.existsSync(file)) return null
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'))
  const existingIdentity = evidenceIdentity(existing)
  const requestIdentity = evidenceIdentity(request)
  if (!existingIdentity || existingIdentity.some((value, index) => value !== requestIdentity[index])) {
    throw new Error(`ATS_HOLD_RECLAIM_FILE already contains evidence for a different hold: ${file}`)
  }
  return existing
}

run(async () => {
  const execute = executeRequested()
  const holdFile = path.resolve(process.cwd(), process.env.ATS_HOLD_FILE || '.context/ats-hold.json')
  if (!fs.existsSync(holdFile)) throw new Error(`ATS_HOLD_FILE does not exist: ${holdFile}`)

  const hold = JSON.parse(fs.readFileSync(holdFile, 'utf8'))
  const identity = {
    securityId: assertMatch(required(process.env, 'ATS_SECURITY_ID'), ENTITY_ID, 'ATS_SECURITY_ID'),
    security: assertMatch(required(process.env, 'ATS_SECURITY_EVM_ADDRESS'), EVM_ADDRESS, 'ATS_SECURITY_EVM_ADDRESS'),
    partition: assertMatch(process.env.ATS_PARTITION || `0x${'0'.repeat(63)}1`, BYTES32, 'ATS_PARTITION'),
    seller: assertMatch(required(process.env, 'SELLER_EVM_ADDRESS'), EVM_ADDRESS, 'SELLER_EVM_ADDRESS'),
    buyer: assertMatch(required(process.env, 'BUYER_EVM_ADDRESS'), EVM_ADDRESS, 'BUYER_EVM_ADDRESS'),
    escrow: assertMatch(required(process.env, 'CLEARING_ESCROW_ADDRESS'), EVM_ADDRESS, 'CLEARING_ESCROW_ADDRESS'),
  }
  assertMatch(hold.securityId, ENTITY_ID, 'ATS_HOLD_FILE.securityId')
  assertMatch(hold.security, EVM_ADDRESS, 'ATS_HOLD_FILE.security')
  assertMatch(hold.partition, BYTES32, 'ATS_HOLD_FILE.partition')
  assertMatch(hold.seller, EVM_ADDRESS, 'ATS_HOLD_FILE.seller')
  assertMatch(hold.buyer, EVM_ADDRESS, 'ATS_HOLD_FILE.buyer')
  assertMatch(hold.escrow, EVM_ADDRESS, 'ATS_HOLD_FILE.escrow')
  const holdId = positiveUint(hold.holdId, 'ATS_HOLD_FILE.holdId')
  const amount = positiveUint(hold.amount, 'ATS_HOLD_FILE.amount')
  const holdExpiry = positiveUint(hold.holdExpiry, 'ATS_HOLD_FILE.holdExpiry')
  if (hold.securityId !== identity.securityId) throw new Error('ATS_SECURITY_ID does not match ATS_HOLD_FILE')
  sameAddress(hold.security, identity.security, 'ATS_SECURITY_EVM_ADDRESS')
  if (hold.partition.toLowerCase() !== identity.partition.toLowerCase()) throw new Error('ATS_PARTITION does not match ATS_HOLD_FILE')
  sameAddress(hold.seller, identity.seller, 'SELLER_EVM_ADDRESS')
  sameAddress(hold.buyer, identity.buyer, 'BUYER_EVM_ADDRESS')
  sameAddress(hold.escrow, identity.escrow, 'CLEARING_ESCROW_ADDRESS')

  const fingerprint = crypto.createHash('sha256')
    .update([identity.securityId, identity.security.toLowerCase(), identity.partition.toLowerCase(),
      identity.seller.toLowerCase(), identity.buyer.toLowerCase(), identity.escrow.toLowerCase(), holdId].join(':'))
    .digest('hex').slice(0, 16)
  const defaultEvidenceFile = `.context/ats-hold-reclaims/${identity.securityId.replaceAll('.', '-')}-hold-${holdId}-${fingerprint}.json`
  const evidenceFile = path.resolve(process.cwd(), process.env.ATS_HOLD_RECLAIM_FILE || defaultEvidenceFile)
  const contextDirectory = path.resolve(process.cwd(), '.context')
  const evidenceRelative = path.relative(contextDirectory, evidenceFile)
  if (evidenceRelative.startsWith('..') || path.isAbsolute(evidenceRelative)) {
    throw new Error('ATS_HOLD_RECLAIM_FILE must be inside the gitignored .context directory')
  }

  const now = Math.floor(Date.now() / 1000)
  if (BigInt(holdExpiry) > BigInt(now)) {
    throw new Error(`ATS hold has not expired; reclaim is available after ${holdExpiry}`)
  }
  const request = { ...identity, holdId, amount, holdExpiry }
  const previousEvidence = existingEvidence(evidenceFile, request)
  if (!execute) return output({
    mode: 'dry-run', signer: 'seller-only', action: 'ATS reclaimHoldByPartition', request, holdFile, evidenceFile,
  })

  const sellerId = assertMatch(required(process.env, 'HEDERA_SELLER_ID'), ENTITY_ID, 'HEDERA_SELLER_ID')
  const sellerEnv = {
    ...process.env,
    HEDERA_OPERATOR_ID: sellerId,
    HEDERA_OPERATOR_KEY: required(process.env, 'HEDERA_SELLER_KEY'),
    CONFORMANCE_EXPECTED_SIGNER: required(process.env, 'CONFORMANCE_EXPECTED_SIGNER'),
  }
  const sellerConfig = loadConfig(sellerEnv, { live: true })
  const { ats, wallet } = await connectAts(sellerConfig)
  if (wallet.address.toLowerCase() !== identity.seller.toLowerCase()) {
    throw new Error('HEDERA_SELLER_KEY does not match SELLER_EVM_ADDRESS')
  }
  const reader = createHoldReader(wallet.provider, identity.security)
  const before = await reader.get({ partition: identity.partition, seller: identity.seller, holdId })
  const baseArtifact = {
    action: 'ATS reclaimHoldByPartition',
    securityId: identity.securityId,
    security: identity.security,
    partition: identity.partition,
    sellerId,
    seller: identity.seller,
    buyer: identity.buyer,
    escrow: identity.escrow,
    holdId,
    holdExpiry,
    expectedAmount: amount,
  }
  if (before.amount === '0') {
    const zeroAddress = `0x${'0'.repeat(40)}`
    if (before.expirationTimestamp !== '0' || before.escrow.toLowerCase() !== zeroAddress ||
        before.destination.toLowerCase() !== zeroAddress) {
      throw new Error('On-chain ATS zero-amount hold is not a fully cleared hold record')
    }
    const reclaim = await reader.findReclaim({
      partition: identity.partition, seller: identity.seller, holdId, amount,
    })
    if (!reclaim) throw new Error('No exact HoldByPartitionReclaimed event proves the cleared ATS hold')
    sameAddress(reclaim.operator, identity.seller, 'ATS reclaim operator')
    sameAddress(reclaim.tokenHolder, identity.seller, 'ATS reclaimed token holder')
    if (reclaim.partition.toLowerCase() !== identity.partition.toLowerCase() || reclaim.holdId !== holdId ||
        reclaim.amount !== amount) throw new Error('ATS reclaim event does not match ATS_HOLD_FILE')
    const artifact = {
      ...baseArtifact,
      resumed: true,
      amountBefore: '0',
      amountAfter: '0',
      observedClearedState: {
        expirationTimestamp: before.expirationTimestamp,
        escrow: before.escrow,
        destination: before.destination,
      },
      reclaimEvent: reclaim,
      transactionId: previousEvidence?.transactionId || reclaim.transactionHash,
      recoveredAt: new Date().toISOString(),
    }
    atomicWrite(evidenceFile, artifact)
    return output({ mode: 'execute', resumed: true, evidenceFile, holdId,
      transactionId: artifact.transactionId, amountAfter: artifact.amountAfter })
  }
  if (before.amount !== amount) throw new Error('On-chain ATS hold amount does not match ATS_HOLD_FILE')
  if (before.expirationTimestamp !== holdExpiry) throw new Error('On-chain ATS hold expiry does not match ATS_HOLD_FILE')
  sameAddress(before.escrow, identity.escrow, 'On-chain ATS hold escrow')
  sameAddress(before.destination, identity.buyer, 'On-chain ATS hold buyer')
  if (BigInt(before.expirationTimestamp) > BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error(`On-chain ATS hold has not expired; reclaim is available after ${before.expirationTimestamp}`)
  }

  const result = await createHoldAdapter(ats, identity.securityId).reclaim({
    partition: identity.partition, sellerId, holdId,
  })
  const transactionId = txId(result)
  if (!transactionId) throw new Error('ATS reclaimHoldByPartition returned no transaction ID')
  if (transactionId.startsWith('0x')) await wallet.provider.waitForTransaction(transactionId)
  const after = await reader.get({ partition: identity.partition, seller: identity.seller, holdId })
  if (after.amount !== '0') throw new Error('ATS hold amount is not zero after reclaim')

  const artifact = {
    ...baseArtifact,
    resumed: false,
    amountBefore: before.amount,
    amountAfter: after.amount,
    transactionId,
    reclaimedAt: new Date().toISOString(),
  }
  atomicWrite(evidenceFile, artifact)
  output({ mode: 'execute', evidenceFile, holdId, transactionId, amountAfter: after.amount })
})
