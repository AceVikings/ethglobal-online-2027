#!/usr/bin/env node
'use strict'

const { ATS_ROLES, BYTES32, assertMatch, executeRequested, loadConfig, connectAts, output, run, txId } = require('./lib/common.cjs')

const CONFIG_ID = `0x${'0'.repeat(63)}2`

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const now = Math.floor(Date.now() / 1000)
  const request = {
    name: process.env.BOND_NAME || 'Conformance Desk Bond', symbol: process.env.BOND_SYMBOL || 'CDBD',
    isin: process.env.BOND_ISIN || 'US4592001014', decimals: 6, isWhiteList: false,
    erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false,
    clearingActive: false, internalKycActivated: false, isMultiPartition: false,
    diamondOwnerAccount: config.operatorId || '<HEDERA_OPERATOR_ID>', currency: '0x555344',
    numberOfUnits: process.env.BOND_UNITS || '10000', nominalValue: process.env.BOND_NOMINAL_VALUE || '1000',
    nominalValueDecimals: 2, startingDate: String(now + 300), maturityDate: String(now + 31_536_000),
    regulationType: 0, regulationSubType: 0, isCountryControlListWhiteList: false,
    countries: '', info: 'Graph-signal-gated testnet bond', configId: process.env.ATS_BOND_CONFIG_ID || CONFIG_ID,
    configVersion: Number(process.env.ATS_CONFIG_VERSION || 1),
  }
  assertMatch(request.configId, BYTES32, 'ATS_BOND_CONFIG_ID')
  if (!execute) return output({ mode: 'dry-run', action: 'Bond.create', request })
  const { ats } = await connectAts(config)
  const result = await ats.Bond.create(new ats.CreateBondRequest(request))
  const securityId = result.security?.diamondAddress || result.security?.id
  if (!securityId) throw new Error('ATS Bond.create returned no security id')
  const roles = [ATS_ROLES.BOND_MANAGER, ATS_ROLES.CORPORATE_ACTIONS, ATS_ROLES.CONTROL_LIST]
  const roleResult = await ats.Role.applyRoles(new ats.ApplyRolesRequest({ securityId, targetId: config.operatorId, roles, actives: roles.map(() => true) }))
  output({ mode: 'execute', securityId, createTxId: txId(result), rolesTxId: txId(roleResult) })
})
