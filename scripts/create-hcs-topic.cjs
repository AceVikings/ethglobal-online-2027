#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, hederaClient, output, run } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  if (!execute) return output({
    mode: 'dry-run', action: 'TopicCreateTransaction', memo: 'ai-clearing-desk-v2',
    submitPolicy: 'operator-key-restricted',
  })
  const { TopicCreateTransaction, PrivateKey } = require('@hiero-ledger/sdk')
  const client = hederaClient(config)
  try {
    const submitKey = PrivateKey.fromStringECDSA(config.operatorKey).publicKey
    const response = await new TopicCreateTransaction()
      .setTopicMemo('ai-clearing-desk-v2')
      .setSubmitKey(submitKey)
      .execute(client)
    const receipt = await response.getReceipt(client)
    output({ mode: 'execute', topicId: receipt.topicId.toString(), transactionId: response.transactionId.toString() })
  } finally { client.close() }
})
