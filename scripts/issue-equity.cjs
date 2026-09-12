#!/usr/bin/env node
'use strict'

const { ATS_ROLES, BYTES32, assertMatch, executeRequested, loadConfig, connectAts, output, run, txId } = require('./lib/common.cjs')

const ZERO32 = `0x${'0'.repeat(63)}1`

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const request = {
    name: process.env.EQUITY_NAME || 'Conformance Desk Equity', symbol: process.env.EQUITY_SYMBOL || 'CDEQ',
    isin: process.env.EQUITY_ISIN || 'US0378331005', decimals: 6, isWhiteList: false,
    erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false,
    clearingActive: false, internalKycActivated: false, isMultiPartition: false,
    diamondOwnerAccount: config.operatorId || '<HEDERA_OPERATOR_ID>', votingRight: true,
    informationRight: true, liquidationRight: false, subscriptionRight: false,
    conversionRight: false, redemptionRight: true, putRight: false, dividendRight: 1,
    currency: '0x555344', numberOfShares: process.env.EQUITY_SHARES || '1000000',
    nominalValue: process.env.EQUITY_NOMINAL_VALUE || '100', nominalValueDecimals: 2,
    regulationType: 0, regulationSubType: 0, isCountryControlListWhiteList: false,
    countries: '', info: 'Graph-signal-gated testnet equity', configId: process.env.ATS_EQUITY_CONFIG_ID || ZERO32,
    configVersion: Number(process.env.ATS_CONFIG_VERSION || 1),
  }
  assertMatch(request.configId, BYTES32, 'ATS_EQUITY_CONFIG_ID')
  if (request.isWhiteList !== false) throw new Error('Equity must use block-list mode (isWhiteList=false)')
  if (!execute) return output({ mode: 'dry-run', action: 'Equity.create', request })
  const { ats } = await connectAts(config)
  const result = await ats.Equity.create(new ats.CreateEquityRequest(request))
  const securityId = result.security?.diamondAddress || result.security?.id
  if (!securityId) throw new Error('ATS Equity.create returned no security id')
  const roles = [ATS_ROLES.ISSUER, ATS_ROLES.CORPORATE_ACTIONS, ATS_ROLES.CONTROL_LIST]
  const roleResult = await ats.Role.applyRoles(new ats.ApplyRolesRequest({ securityId, targetId: config.operatorId, roles, actives: roles.map(() => true) }))
  const recipient = process.env.ATS_BLOCKED_RECIPIENT_ID
  const blocked = recipient ? await ats.Security.addToControlList(new ats.ControlListRequest({ securityId, targetId: recipient })) : null
  output({ mode: 'execute', securityId, createTxId: txId(result), rolesTxId: txId(roleResult), blockTxId: txId(blocked) })
})
