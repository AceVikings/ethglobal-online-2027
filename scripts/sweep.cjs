#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { required, executeRequested, output, run } = require('./lib/common.cjs')

run(async () => {
  const execute = executeRequested()
  const { GraphGatewayClient, LENDING_DEPLOYMENTS } = await import('../packages/signal/src/index.ts')
  const deployments = LENDING_DEPLOYMENTS.map(({ protocol, network, deploymentId }) => ({ protocol, network, deploymentId }))
  const policy = { pinnedCid: process.env.PINNED_CID || null, lagBoundBlocks: Number(process.env.LAG_BOUND_BLOCKS || 50) }
  const maxEvidenceAgeSeconds = Number(process.env.GRAPH_MAX_AGE_SECONDS || 300)
  if (!Number.isInteger(policy.lagBoundBlocks) || policy.lagBoundBlocks < 0) throw new Error('LAG_BOUND_BLOCKS must be a non-negative integer')
  if (!Number.isInteger(maxEvidenceAgeSeconds) || maxEvidenceAgeSeconds < 0) {
    throw new Error('GRAPH_MAX_AGE_SECONDS must be a non-negative integer')
  }
  if (!execute) return output({
    mode: 'dry-run', action: 'read-only Graph deployment health sweep',
    policy, maxEvidenceAgeSeconds, deployments,
  })
  const graph = new GraphGatewayClient({
    apiKey: required(process.env, 'GRAPH_STUDIO_KEY'),
    gatewayUrl: process.env.GRAPH_GATEWAY_BASE,
  })
  const graphHealth = await Promise.all(LENDING_DEPLOYMENTS.map((deployment) => graph.inspectDeployment(
    deployment,
    { maxAgeSeconds: maxEvidenceAgeSeconds },
  )))
  const runId = process.env.E2E_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-')
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(runId)) throw new Error('E2E_RUN_ID contains unsafe characters')
  const evidenceDirectory = path.resolve('.context', 'e2e', runId)
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  const graphEvidencePath = path.join(evidenceDirectory, 'graph.json')
  fs.writeFileSync(graphEvidencePath, `${JSON.stringify({
    checkedAt: new Date().toISOString(),
    maxEvidenceAgeSeconds,
    deployments: graphHealth,
  }, null, 2)}\n`, { mode: 0o600 })
  output({
    mode: 'execute',
    graphEvidencePath: path.relative(process.cwd(), graphEvidencePath),
    checked: graphHealth.length,
    healthy: graphHealth.filter((row) => row.status === 'healthy').length,
    deployments: graphHealth,
  })
})
