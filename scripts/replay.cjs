#!/usr/bin/env node
'use strict'

const { executeRequested, loadConfig, output, run, required } = require('./lib/common.cjs')

async function messages(baseUrl, topicId) {
  let next = `${baseUrl.replace(/\/$/, '')}/api/v1/topics/${topicId}/messages?limit=100&order=asc`
  const all = []
  while (next) {
    const response = await fetch(next)
    if (!response.ok) throw new Error(`Mirror Node returned ${response.status}`)
    const page = await response.json()
    all.push(...page.messages)
    next = page.links?.next ? new URL(page.links.next, baseUrl).toString() : null
  }
  return all
}

run(async () => {
  const execute = executeRequested()
  const config = loadConfig(process.env, { live: false })
  const topicId = process.env.HCS_TOPIC_ID
  if (!execute) return output({ mode: 'dry-run', action: 'replay HCS DECISION messages', topicId: topicId || '<HCS_TOPIC_ID>', mirrorNodeUrl: config.mirrorNodeUrl })
  required(process.env, 'HCS_TOPIC_ID')
  const { anchorDigest } = await import('../packages/signal/src/sign.ts')
  const rows = []
  for (const envelope of await messages(config.mirrorNodeUrl, topicId)) {
    let message
    try { message = JSON.parse(Buffer.from(envelope.message, 'base64').toString('utf8')) } catch { continue }
    if (message.t !== 'DECISION' || message.v !== 1) continue
    const recomputed = anchorDigest({ paymentTxId: message.paymentTxId, signalHash: message.signalHash, opCalldataHash: message.opCalldataHash, verdict: message.verdict, ts: message.ts })
    rows.push({ sequence: envelope.sequence_number, consensusTimestamp: envelope.consensus_timestamp, verdict: message.verdict, op: message.op, digest: message.digest, recomputed, pass: recomputed === message.digest })
  }
  output({ mode: 'execute', topicId, checked: rows.length, passed: rows.filter((row) => row.pass).length, failed: rows.filter((row) => !row.pass).length, rows })
  if (rows.some((row) => !row.pass)) process.exitCode = 2
})
