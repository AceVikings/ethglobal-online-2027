import type { VerdictRequest } from './types.ts'

const STANDARD = 'messari/lending-v3.1' as const
const MAX_LAG_BOUND = 1_000_000
const ID = /^[A-Za-z0-9_-]{8,128}$/
const NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const UINT = /^(0|[1-9]\d*)$/

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseVerdictRequest(value: unknown): VerdictRequest {
  if (!record(value) || !record(value.subject) || !record(value.policy) || !record(value.trade)) {
    throw new Error('body must contain subject, policy, and trade objects')
  }

  if (value.standard !== STANDARD) throw new Error(`standard must be ${STANDARD}`)
  if (typeof value.clientRequestId !== 'string' || !ID.test(value.clientRequestId)) {
    throw new Error('invalid clientRequestId')
  }
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

  const trade = value.trade
  for (const field of ['verifyingContract', 'security', 'seller', 'buyer'] as const) {
    if (typeof trade[field] !== 'string' || !ADDRESS.test(trade[field])) throw new Error(`invalid trade.${field}`)
  }
  for (const field of ['partition', 'policyHash'] as const) {
    if (typeof trade[field] !== 'string' || !BYTES32.test(trade[field])) throw new Error(`invalid trade.${field}`)
  }
  const uints: Record<string, string> = {}
  for (const field of ['chainId', 'amount', 'holdId', 'holdExpiry'] as const) {
    const normalized = typeof trade[field] === 'number' && Number.isSafeInteger(trade[field])
      ? String(trade[field])
      : trade[field]
    if (typeof normalized !== 'string' || !UINT.test(normalized) || BigInt(normalized) <= 0n) {
      throw new Error(`invalid trade.${field}`)
    }
    uints[field] = normalized
  }

  return {
    clientRequestId: value.clientRequestId,
    standard: STANDARD,
    subject: { protocol, network, deploymentId },
    policy: { pinnedCid, lagBoundBlocks: Number(lagBoundBlocks) },
    trade: {
      chainId: uints.chainId,
      verifyingContract: trade.verifyingContract as string,
      security: trade.security as string,
      partition: trade.partition as string,
      seller: trade.seller as string,
      buyer: trade.buyer as string,
      amount: uints.amount,
      holdId: uints.holdId,
      holdExpiry: uints.holdExpiry,
      policyHash: trade.policyHash as string,
    },
  }
}
