#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { executeRequested, loadConfig, loadJson, createPaidFetch, buyVerdict, output, run } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const deployments = loadJson(path.join(__dirname, 'config/deployments.json'))
  const policy = { pinnedCid: process.env.PINNED_CID || null, lagBoundBlocks: Number(process.env.LAG_BOUND_BLOCKS || 50) }
  if (!Number.isInteger(policy.lagBoundBlocks) || policy.lagBoundBlocks < 0) throw new Error('LAG_BOUND_BLOCKS must be a non-negative integer')
  if (!execute) return output({ mode: 'dry-run', serviceUrl: config.serviceUrl, policy, deployments })
  const paidFetch = await createPaidFetch({ accountId: config.operatorId, privateKey: config.operatorKey })
  const rows = []
  for (const subject of deployments) {
    try {
      const result = await buyVerdict({ url: config.serviceUrl, body: { subject, policy }, paidFetch })
      rows.push({ ...subject, verdict: result.verdict.verdict, paymentTxId: result.paymentTxId })
    } catch (error) { rows.push({ ...subject, verdict: 'ERROR', error: error.message }) }
  }
  output({ mode: 'execute', checked: rows.length, nonConforming: rows.filter((row) => !['CONFORMANT', 'ERROR'].includes(row.verdict)).length, rows })
})
