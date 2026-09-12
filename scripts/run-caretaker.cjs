#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, connectAts, createControlListAdapter, encodeTransfer, createPaidFetch, buyVerdict, submitHcsMessage, recordGate, decideAndAct, output, run, required } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const request = {
    subject: { protocol: process.env.PROTOCOL || 'aave-v3', network: process.env.SUBJECT_NETWORK || 'ethereum', deploymentId: process.env.DEPLOYMENT_ID || '<DEPLOYMENT_ID>' },
    policy: { pinnedCid: process.env.PINNED_CID || null, lagBoundBlocks: Number(process.env.LAG_BOUND_BLOCKS || 50) },
  }
  const operation = { to: process.env.RECIPIENT_EVM_ADDRESS || `0x${'0'.repeat(40)}`, amount: BigInt(process.env.TRANSFER_AMOUNT || 1) }
  const preview = { request, recipientId: process.env.RECIPIENT_ID || '<RECIPIENT_ID>', operation: { ...operation, amount: operation.amount.toString(), calldata: encodeTransfer(operation) } }
  if (!execute) return output({ mode: 'dry-run', flow: ['buy x402 verdict', 'verify signature', 'CONFORMANT: remove recipient from ATS block list', 'execute ATS transfer', 'anchor HCS', 'record gate'], preview })
  const securityId = required(process.env, 'ATS_SECURITY_ID')
  const recipientId = required(process.env, 'RECIPIENT_ID')
  const topicId = required(process.env, 'HCS_TOPIC_ID')
  config.gateAddress = required(process.env, 'CONFORMANCE_GATE_ADDRESS')
  const { ats } = await connectAts(config)
  const paidFetch = await createPaidFetch({ accountId: config.operatorId, privateKey: config.operatorKey })
  const signal = await import('../packages/signal/src/sign.ts')
  const result = await decideAndAct({ request, recipientId, operation: { ...operation, calldata: preview.operation.calldata } }, {
    buyVerdict: (body) => buyVerdict({ url: config.serviceUrl, body, paidFetch }),
    verifyVerdict: signal.verifyVerdict, signalHash: signal.signalHash, buildAnchor: signal.anchorDigest,
    controlList: createControlListAdapter(ats, securityId),
    executeTransfer: (op) => ats.Security.transfer(new ats.TransferRequest({ securityId, targetId: recipientId, amount: op.amount.toString() })),
    anchorHcs: (message) => submitHcsMessage(config, topicId, message),
    recordGate: (args) => recordGate(config, args), now: () => new Date(),
  })
  output({ mode: 'execute', result })
})
