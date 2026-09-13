import type { CreateRun } from '@desk/signal'

export function parseCreateRun(input: unknown): CreateRun {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('run must be an object')
  const value = input as Record<string, unknown>
  for (const key of Object.keys(value)) if (!['vaultId', 'requestId', 'mandateHash', 'actor', 'snapshot'].includes(key)) throw new Error(`unknown field ${key}`)
  if (typeof value.vaultId !== 'string' || !value.vaultId) throw new Error('vaultId is required')
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.requestId)) throw new Error('requestId is invalid')
  if (typeof value.mandateHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.mandateHash)) throw new Error('mandateHash is invalid')
  if (!value.actor || typeof value.actor !== 'object' || Array.isArray(value.actor)) throw new Error('actor is required')
  const actor = value.actor as Record<string, unknown>
  for (const key of Object.keys(actor)) if (!['kind', 'clientId', 'requestId', 'grantId'].includes(key)) throw new Error(`unknown actor field ${key}`)
  if (!['web', 'mcp', 'cli', 'scheduler'].includes(String(actor.kind)) || typeof actor.clientId !== 'string' || !actor.clientId || actor.requestId !== value.requestId) throw new Error('actor provenance is invalid')
  if (!value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot)) throw new Error('snapshot is required')
  return value as unknown as CreateRun
}
