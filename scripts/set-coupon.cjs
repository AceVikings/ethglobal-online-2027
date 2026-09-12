#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, connectAts, output, run, required, txId } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const now = Math.floor(Date.now() / 1000)
  const request = {
    securityId: process.env.ATS_SECURITY_ID || '<ATS_SECURITY_ID>', rate: process.env.COUPON_RATE || '5.00',
    recordTimestamp: String(now + 300), executionTimestamp: String(now + 600), startTimestamp: String(now),
    endTimestamp: String(now + 31_536_000), fixingTimestamp: String(now + 240), rateStatus: Number(process.env.COUPON_RATE_STATUS || 0),
  }
  if (!execute) return output({ mode: 'dry-run', action: 'Coupon.setCoupon', selector: '0xb16fd0cc', accountingOnly: true, request })
  request.securityId = required(process.env, 'ATS_SECURITY_ID')
  const { ats } = await connectAts(config)
  const result = await ats.Coupon.setCoupon(new ats.SetCouponRequest(request))
  output({ mode: 'execute', transactionId: txId(result), payload: result.payload })
})
