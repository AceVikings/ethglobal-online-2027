#!/usr/bin/env node
'use strict'

const { ENTITY_ID, assertMatch, required, executeRequested, loadConfig, createPaidFetch, buyVerdict, output, run } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const { LENDING_DEPLOYMENTS } = await import('../packages/signal/src/deployments.ts')
  const deployments = LENDING_DEPLOYMENTS.map(({ protocol, network, deploymentId }) => ({ protocol, network, deploymentId }))
  const policy = { pinnedCid: process.env.PINNED_CID || null, lagBoundBlocks: Number(process.env.LAG_BOUND_BLOCKS || 50) }
  if (!Number.isInteger(policy.lagBoundBlocks) || policy.lagBoundBlocks < 0) throw new Error('LAG_BOUND_BLOCKS must be a non-negative integer')
  if (!execute) return output({ mode: 'dry-run', serviceUrl: config.serviceUrl, policy, deployments })
  const expectedPayTo = assertMatch(required(process.env, 'X402_PAY_TO'), ENTITY_ID, 'X402_PAY_TO')
  const paidFetch = await createPaidFetch({
    accountId: config.operatorId, privateKey: config.operatorKey, network: config.x402Network,
    expectedPayTo, expectedAsset: config.usdcTokenId, expectedFeePayer: config.x402FeePayer,
    maxAmountPerPayment: `$${config.x402PriceUsd}`,
  })
  const rows = []
  for (const subject of deployments) {
    try {
      const result = await buyVerdict({ url: config.serviceUrl, body: { standard: 'messari/lending-v3.1', subject, policy }, paidFetch })
      rows.push({ ...subject, verdict: result.verdict.verdict, paymentTxId: result.paymentTxId })
    } catch (error) { rows.push({ ...subject, verdict: 'ERROR', error: error.message }) }
  }
  output({ mode: 'execute', checked: rows.length, nonConforming: rows.filter((row) => !['CONFORMANT', 'ERROR'].includes(row.verdict)).length, rows })
})
