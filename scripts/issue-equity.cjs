#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { ATS_ROLES, BYTES32, assertMatch, executeRequested, loadConfig, connectAts, output, run, txId } = require('./lib/common.cjs')

const ZERO32 = `0x${'0'.repeat(63)}1`

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const request = {
    name: process.env.EQUITY_NAME || 'Spokane Private Credit Fund', symbol: process.env.EQUITY_SYMBOL || 'SPCF',
    isin: process.env.EQUITY_ISIN || 'US0378331005', decimals: 6, isWhiteList: false,
    erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false,
    // The qualification fixture keeps ATS internal KYC disabled until an SSI
    // issuer and seller/buyer grants are provisioned. Enabling it without those
    // grants would make hold execution revert on a fresh security.
    clearingActive: false, internalKycActivated: false, isMultiPartition: false,
    diamondOwnerAccount: config.operatorId || '<HEDERA_OPERATOR_ID>', votingRight: true,
    informationRight: true, liquidationRight: false, subscriptionRight: false,
    conversionRight: false, redemptionRight: true, putRight: false, dividendRight: 1,
    currency: '0x555344', numberOfShares: process.env.EQUITY_SHARES || '1000000',
    nominalValue: process.env.EQUITY_NOMINAL_VALUE || '100', nominalValueDecimals: 2,
    regulationType: 2, regulationSubType: 2, isCountryControlListWhiteList: false,
    countries: '', info: 'Testnet fund units settled through ATS holds and the AI Clearing Desk', configId: process.env.ATS_EQUITY_CONFIG_ID || ZERO32,
    configVersion: Number(process.env.ATS_CONFIG_VERSION || 1),
  }
  assertMatch(request.configId, BYTES32, 'ATS_EQUITY_CONFIG_ID')
  if (request.isWhiteList !== false) throw new Error('Equity must use block-list mode (isWhiteList=false)')
  const stateFile = path.resolve(process.cwd(), process.env.ATS_EQUITY_STATE_FILE || '.context/ats-equity.json')
  if (!execute) return output({ mode: 'dry-run', action: 'Equity.create', request, stateFile })
  const { ats } = await connectAts(config)
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const save = (state) => fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null
  if (state?.rolesTxId) return output({ mode: 'execute', resumed: true, ...state })
  if (!state?.securityId) {
    const result = await ats.Equity.create(new ats.CreateEquityRequest(request))
    const rawSecurityId = result.security?.diamondAddress || result.security?.id
    if (!rawSecurityId) throw new Error('ATS Equity.create returned no security id')
    state = { securityId: rawSecurityId.toString(), createTxId: txId(result) }
    save(state)
  }
  const securityId = state.securityId
  // Issuer roles stay with the issuer fixture. The buyer agent receives no ATS
  // role; its only mutation is relaying a one-use authorization to the escrow.
  const roles = [ATS_ROLES.ISSUER, ATS_ROLES.CORPORATE_ACTIONS, ATS_ROLES.CONTROL_LIST]
  const roleResult = await ats.Role.applyRoles(new ats.ApplyRolesRequest({ securityId, targetId: config.operatorId, roles, actives: roles.map(() => true) }))
  state = { ...state, rolesTxId: txId(roleResult) }
  save(state)
  output({ mode: 'execute', ...state })
})
