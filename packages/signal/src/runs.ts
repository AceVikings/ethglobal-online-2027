import { keccak256, toUtf8Bytes } from 'ethers'
import { canonicalJSON } from './sign.ts'

export type RunState = 'PENDING_APPROVAL' | 'QUEUED' | 'PRECHECK' | 'BLOCKED' | 'HOLD_INTENT' |
  'HOLD_CONFIRMED' | 'PAYMENT_INTENT' | 'PAID' | 'AUTHORIZED' | 'EXECUTE_INTENT' |
  'RELEASE_INTENT' | 'RECOVERY_REQUIRED' | 'EXECUTED' | 'RELEASED' | 'AUDITED' | 'CANCELLED'

export interface ActorProvenance {
  kind: 'web' | 'mcp' | 'cli' | 'scheduler'
  clientId: string
  requestId: string
  grantId?: string
}

export interface ClearanceRun {
  id: string
  ownerId: string
  vaultId: string
  requestId: string
  fingerprint: string
  mandateHash: string
  actor: ActorProvenance
  snapshot: Readonly<Record<string, unknown>>
  state: RunState
  publicProofDigest: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateRun {
  vaultId: string
  requestId: string
  mandateHash: string
  actor: ActorProvenance
  snapshot: Readonly<Record<string, unknown>>
}

export interface RunApproval {
  version: 1
  owner: string
  vaultId: string
  runId: string
  mandateHash: string
  requestFingerprint: string
  validFrom: string
  expiresAt: string
  nonce: string
}

export interface SignedRunApproval {
  approval: RunApproval
  signature: string
}

export interface RunEvent {
  runId: string
  sequence: number
  type: string
  occurredAt: string
  visibility: 'private' | 'public'
  detail: string
  previousEventHash?: string
  eventHash?: string
  proof?: Readonly<Record<string, unknown>>
}

export type AppendRunEvent = Omit<RunEvent, 'runId' | 'sequence' | 'occurredAt'> & { occurredAt?: string }

export function canonicalRunFingerprint(input: CreateRun | Record<string, unknown>): string {
  return keccak256(toUtf8Bytes(canonicalJSON(input)))
}

export function validateRunEvent(input: unknown): RunEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('run event must be an object')
  const event = input as Record<string, unknown>
  if (typeof event.runId !== 'string' || !event.runId) throw new Error('runId is required')
  if (!Number.isSafeInteger(event.sequence) || Number(event.sequence) < 1) throw new Error('sequence must be positive')
  if (typeof event.type !== 'string' || !event.type) throw new Error('type is required')
  if (typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) throw new Error('occurredAt is invalid')
  if (event.visibility !== 'private' && event.visibility !== 'public') throw new Error('visibility is invalid')
  if (typeof event.detail !== 'string') throw new Error('detail is required')
  return input as RunEvent
}
