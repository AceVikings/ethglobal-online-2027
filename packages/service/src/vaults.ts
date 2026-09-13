import { getAddress } from 'ethers'
import type { CreateVault, VaultPolicy, VaultStatus } from '@desk/signal'

function object(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${name} must be an object`)
  return input as Record<string, unknown>
}

export function parseCreateVault(input: unknown): CreateVault {
  const value = object(input, 'vault')
  const allowed = ['name', 'offeringId', 'receiver', 'executorRef', 'policy']
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`unknown field ${key}`)
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new Error('name must contain 1 to 80 characters')
  if (typeof value.offeringId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.offeringId)) throw new Error('offeringId is invalid')
  if (typeof value.executorRef !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.executorRef)) throw new Error('executorRef is invalid')
  if (typeof value.receiver !== 'string') throw new Error('receiver is required')
  const policy = object(value.policy, 'policy')
  const parsedPolicy: VaultPolicy = {
    maxUtilizationBps: Number(policy.maxUtilizationBps), maxLagBlocks: Number(policy.maxLagBlocks),
    minTvlUsdMinor: String(policy.minTvlUsdMinor), requireSchemaAgreement: policy.requireSchemaAgreement === true,
    requireInvariantPass: policy.requireInvariantPass === true,
  }
  if (!Number.isSafeInteger(parsedPolicy.maxUtilizationBps) || parsedPolicy.maxUtilizationBps < 1 || parsedPolicy.maxUtilizationBps > 10000) throw new Error('maxUtilizationBps is invalid')
  if (!Number.isSafeInteger(parsedPolicy.maxLagBlocks) || parsedPolicy.maxLagBlocks < 0) throw new Error('maxLagBlocks is invalid')
  if (!/^[1-9]\d*$/.test(parsedPolicy.minTvlUsdMinor)) throw new Error('minTvlUsdMinor is invalid')
  return { name: value.name.trim(), offeringId: value.offeringId, receiver: getAddress(value.receiver), executorRef: value.executorRef, policy: parsedPolicy }
}

export function parseVaultStatus(input: unknown): VaultStatus {
  const value = object(input, 'status update').status
  if (!['active', 'paused', 'revoked', 'archived'].includes(String(value))) throw new Error('status is invalid')
  return value as VaultStatus
}
