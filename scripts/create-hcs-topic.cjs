#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, hederaClient, output, run } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  if (!execute) return output({ mode: 'dry-run', action: 'TopicCreateTransaction', memo: 'conformance-desk-decisions-v1' })
  const { TopicCreateTransaction } = require('@hiero-ledger/sdk')
  const client = hederaClient(config)
  try {
    const response = await new TopicCreateTransaction().setTopicMemo('conformance-desk-decisions-v1').execute(client)
    const receipt = await response.getReceipt(client)
    output({ mode: 'execute', topicId: receipt.topicId.toString(), transactionId: response.transactionId.toString() })
  } finally { client.close() }
})
