#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, hederaClient, output, run, required } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const plan = {
    name: 'Conformance USD', symbol: 'cUSD', decimals: 6, initialSupply: '1000000000000',
    fixedFee: { amountTinybar: process.env.FIXED_FEE_TINYBAR || '1000000', collector: process.env.FEE_COLLECTOR_ID || '<FEE_COLLECTOR_ID>' },
    fractionalFee: { numerator: 1, denominator: 100, minimum: 1, maximum: 1000000, collector: process.env.REVENUE_COLLECTOR_ID || '<REVENUE_COLLECTOR_ID>' },
    note: 'Circle testnet USDC fee schedule is immutable to us; this creates a demo settlement HTS token whose treasury can set custom fees.',
  }
  if (!execute) return output({ mode: 'dry-run', action: 'TokenCreateTransaction', plan })
  const feeCollector = required(process.env, 'FEE_COLLECTOR_ID')
  const revenueCollector = required(process.env, 'REVENUE_COLLECTOR_ID')
  const sdk = require('@hashgraph/sdk')
  const client = hederaClient(config)
  try {
    const operatorKey = sdk.PrivateKey.fromStringECDSA(config.operatorKey)
    const customFees = [
      new sdk.CustomFixedFee().setHbarAmount(sdk.Hbar.fromTinybars(plan.fixedFee.amountTinybar)).setFeeCollectorAccountId(feeCollector),
      new sdk.CustomFractionalFee().setNumerator(1).setDenominator(100).setMin(1).setMax(1_000_000).setAssessmentMethod(sdk.FeeAssessmentMethod.Inclusive).setFeeCollectorAccountId(revenueCollector),
    ]
    const response = await new sdk.TokenCreateTransaction().setTokenName(plan.name).setTokenSymbol(plan.symbol)
      .setDecimals(plan.decimals).setInitialSupply(BigInt(plan.initialSupply)).setTreasuryAccountId(config.operatorId)
      .setAdminKey(operatorKey.publicKey).setFeeScheduleKey(operatorKey.publicKey).setCustomFees(customFees).execute(client)
    const receipt = await response.getReceipt(client)
    output({ mode: 'execute', tokenId: receipt.tokenId.toString(), transactionId: response.transactionId.toString(), warning: plan.note })
  } finally { client.close() }
})
