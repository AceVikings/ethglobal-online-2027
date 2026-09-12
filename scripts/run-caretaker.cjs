#!/usr/bin/env node
'use strict'

const { ENTITY_ID, EVM_ADDRESS, assertMatch, executeRequested, loadConfig, connectAts, createControlListAdapter, encodeTransfer, createPaidFetch, buyVerdict, submitHcsMessage, recordGate, createAnthropicReasoner, decideAndAct, output, run, required } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const request = {
    standard: 'messari/lending-v3.1',
    subject: { protocol: process.env.PROTOCOL || 'aave-v3', network: process.env.SUBJECT_NETWORK || 'ethereum', deploymentId: process.env.DEPLOYMENT_ID || '<DEPLOYMENT_ID>' },
    policy: { pinnedCid: process.env.PINNED_CID || null, lagBoundBlocks: Number(process.env.LAG_BOUND_BLOCKS || 50) },
  }
  const operation = { to: process.env.RECIPIENT_EVM_ADDRESS || `0x${'0'.repeat(40)}`, amount: BigInt(process.env.TRANSFER_AMOUNT || 1) }
  if (operation.amount <= 0n) throw new Error('TRANSFER_AMOUNT must be positive')
  let securityId, recipientId, topicId
  if (execute) {
    securityId = assertMatch(required(process.env, 'ATS_SECURITY_ID'), ENTITY_ID, 'ATS_SECURITY_ID')
    recipientId = assertMatch(required(process.env, 'RECIPIENT_ID'), ENTITY_ID, 'RECIPIENT_ID')
    topicId = assertMatch(required(process.env, 'HCS_TOPIC_ID'), ENTITY_ID, 'HCS_TOPIC_ID')
    operation.to = assertMatch(required(process.env, 'RECIPIENT_EVM_ADDRESS'), EVM_ADDRESS, 'RECIPIENT_EVM_ADDRESS')
    request.subject.deploymentId = required(process.env, 'DEPLOYMENT_ID')
    config.gateAddress = assertMatch(required(process.env, 'CONFORMANCE_GATE_ADDRESS'), EVM_ADDRESS, 'CONFORMANCE_GATE_ADDRESS')
  }
  const preview = { request, expectedSigner: process.env.CONFORMANCE_EXPECTED_SIGNER || '<CONFORMANCE_EXPECTED_SIGNER>', recipientId: process.env.RECIPIENT_ID || '<RECIPIENT_ID>', operation: { ...operation, amount: operation.amount.toString(), calldata: encodeTransfer(operation) } }
  if (!execute) return output({ mode: 'dry-run', serviceUrl: config.serviceUrl, x402Network: config.x402Network, flow: ['buy x402 verdict', 'verify signature', 'CONFORMANT: remove recipient from ATS block list', 'execute ATS transfer', 'attempt HCS and gate anchors independently'], preview })
  const { ats } = await connectAts(config)
  const expectedPayTo = assertMatch(required(process.env, 'X402_PAY_TO'), ENTITY_ID, 'X402_PAY_TO')
  const paidFetch = await createPaidFetch({
    accountId: config.operatorId, privateKey: config.operatorKey, network: config.x402Network,
    expectedPayTo, expectedAsset: config.usdcTokenId, expectedFeePayer: config.x402FeePayer,
    maxAmountPerPayment: `$${config.x402PriceUsd}`,
  })
  const signal = await import('../packages/signal/src/sign.ts')
  const reasonVerdict = createAnthropicReasoner({
    apiKey: required(process.env, 'ANTHROPIC_API_KEY'),
    model: required(process.env, 'ANTHROPIC_MODEL'),
  })
  const result = await decideAndAct({ request, expectedSigner: config.expectedSigner, recipientId, operation: { ...operation, calldata: preview.operation.calldata } }, {
    buyVerdict: (body) => buyVerdict({ url: config.serviceUrl, body, paidFetch }),
    verifyVerdict: signal.verifyVerdict, signalHash: signal.signalHash, buildAnchor: signal.anchorDigest,
    reasonVerdict,
    controlList: createControlListAdapter(ats, securityId),
    executeTransfer: (op) => ats.Security.transfer(new ats.TransferRequest({ securityId, targetId: recipientId, amount: op.amount.toString() })),
    anchorHcs: (message) => submitHcsMessage(config, topicId, message),
    recordGate: (args) => recordGate(config, args), now: () => new Date(),
  })
  output({ mode: 'execute', result })
})
