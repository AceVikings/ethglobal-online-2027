#!/usr/bin/env node
'use strict'

const {
  ENTITY_ID, assertMatch, connectAts, executeRequested, loadConfig, output, required, run, txId,
} = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const request = {
    securityId: process.env.ATS_SECURITY_ID || '<ATS_SECURITY_ID>',
    sellerId: process.env.HEDERA_SELLER_ID || '<HEDERA_SELLER_ID>',
    amount: process.env.ATS_SEED_AMOUNT || '1',
  }
  if (!/^\d+(?:\.\d+)?$/.test(request.amount) || Number(request.amount) <= 0) {
    throw new Error('ATS_SEED_AMOUNT must be positive')
  }
  if (!execute) return output({ mode: 'dry-run', action: 'ATS Security.issue', request })

  request.securityId = assertMatch(required(process.env, 'ATS_SECURITY_ID'), ENTITY_ID, 'ATS_SECURITY_ID')
  request.sellerId = assertMatch(required(process.env, 'HEDERA_SELLER_ID'), ENTITY_ID, 'HEDERA_SELLER_ID')
  const config = loadConfig(process.env, { live: true })
  const { ats } = await connectAts(config)
  const before = await ats.Security.getBalanceOf(new ats.GetAccountBalanceRequest({
    securityId: request.securityId, targetId: request.sellerId,
  }))
  const current = Number(before.value)
  const desired = Number(request.amount)
  if (current >= desired) return output({
    mode: 'execute', resumed: true, securityId: request.securityId, sellerId: request.sellerId,
    targetBalance: request.amount, observedBalance: before.value,
  })
  const amount = String(desired - current)
  const result = await ats.Security.issue(new ats.IssueRequest({
    securityId: request.securityId,
    targetId: request.sellerId,
    amount,
  }))
  if (result?.payload !== true) throw new Error('ATS Security.issue did not report success')
  const after = await ats.Security.getBalanceOf(new ats.GetAccountBalanceRequest({
    securityId: request.securityId, targetId: request.sellerId,
  }))
  if (Number(after.value) !== desired) throw new Error('ATS seller balance did not reach the requested seed target')
  output({ mode: 'execute', securityId: request.securityId, sellerId: request.sellerId,
    issuedAmount: amount, targetBalance: request.amount, observedBalance: after.value, transactionId: txId(result) })
})
