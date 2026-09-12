#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, hederaClient, output, run, required } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: execute })
  const validForSeconds = Number(process.env.SCHEDULE_VALID_FOR_SECONDS || 3600)
  if (!Number.isInteger(validForSeconds) || validForSeconds < 60) throw new Error('SCHEDULE_VALID_FOR_SECONDS must be an integer >= 60')
  const plan = { action: 'HIP-423 scheduled HCS wake marker', topicId: process.env.HCS_TOPIC_ID || '<HCS_TOPIC_ID>', validForSeconds, recurring: false }
  if (!execute) return output({ mode: 'dry-run', ...plan, note: 'HIP-423 schedules a ledger transaction once; an external scheduler must create each recurring agent wake.' })
  const topicId = required(process.env, 'HCS_TOPIC_ID')
  const { TopicMessageSubmitTransaction, Timestamp } = require('@hashgraph/sdk')
  const client = hederaClient(config)
  try {
    const scheduled = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify({ t: 'WAKE', v: 1, createdAt: new Date().toISOString() })).schedule()
      .setScheduleMemo('conformance-desk-agent-wake').setExpirationTime(Timestamp.generate().plusNanos(validForSeconds * 1e9)).setWaitForExpiry(true)
    const response = await scheduled.execute(client)
    const receipt = await response.getReceipt(client)
    output({ mode: 'execute', scheduleId: receipt.scheduleId.toString(), transactionId: response.transactionId.toString(), recurring: false })
  } finally { client.close() }
})
