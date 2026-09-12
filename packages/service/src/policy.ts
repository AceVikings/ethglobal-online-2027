import type { VerdictRequest } from './types.ts'

const STANDARD = 'messari/lending-v3.1' as const
const MAX_LAG_BOUND = 1_000_000
const ID = /^[A-Za-z0-9_-]{8,128}$/
const NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseVerdictRequest(value: unknown): VerdictRequest {
  if (!record(value) || !record(value.subject) || !record(value.policy)) {
    throw new Error('body must contain subject and policy objects')
  }

  if (value.standard !== STANDARD) throw new Error(`standard must be ${STANDARD}`)
  const { protocol, network, deploymentId } = value.subject
  if (typeof protocol !== 'string' || !NAME.test(protocol)) throw new Error('invalid subject.protocol')
  if (typeof network !== 'string' || !NAME.test(network)) throw new Error('invalid subject.network')
  if (typeof deploymentId !== 'string' || !ID.test(deploymentId)) {
    throw new Error('invalid subject.deploymentId')
  }

  const { pinnedCid, lagBoundBlocks } = value.policy
  if (pinnedCid !== null && (typeof pinnedCid !== 'string' || !ID.test(pinnedCid))) {
    throw new Error('policy.pinnedCid must be null or a deployment CID')
  }
  if (!Number.isSafeInteger(lagBoundBlocks) || Number(lagBoundBlocks) < 0 || Number(lagBoundBlocks) > MAX_LAG_BOUND) {
    throw new Error(`policy.lagBoundBlocks must be an integer from 0 to ${MAX_LAG_BOUND}`)
  }

  return {
    standard: STANDARD,
    subject: { protocol, network, deploymentId },
    policy: { pinnedCid, lagBoundBlocks: Number(lagBoundBlocks) },
  }
}
