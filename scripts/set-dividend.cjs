#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, connectAts, output, run, required, txId } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const now = Math.floor(Date.now() / 1000)
  const request = { securityId: process.env.ATS_SECURITY_ID || '<ATS_SECURITY_ID>', amountPerUnitOfSecurity: process.env.DIVIDEND_AMOUNT || '0.25', recordTimestamp: String(now + 300), executionTimestamp: String(now + 600) }
  if (!execute) return output({ mode: 'dry-run', action: 'Dividend.setDividend', request })
  request.securityId = required(process.env, 'ATS_SECURITY_ID')
  const { ats } = await connectAts(config)
  const result = await ats.Dividend.setDividend(new ats.SetDividendRequest(request))
  output({ mode: 'execute', transactionId: txId(result), payload: result.payload })
})
