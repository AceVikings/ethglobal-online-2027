import { randomUUID } from 'node:crypto'
import { canonicalRunFingerprint, type ClearanceRun, type CreateRun, type CreateVault, type RunEvent, type Vault, type VaultMandateV2, type VaultStatus } from '@desk/signal'
import { IdempotencyConflictError, type VaultRepository } from './types.ts'

type Options = { id?: () => string; now?: () => Date }

export function createMemoryVaultRepository(options: Options = {}): VaultRepository {
  const id = options.id ?? randomUUID
  const now = options.now ?? (() => new Date())
  const vaults = new Map<string, Vault>()
  const mandates = new Map<string, { mandate: VaultMandateV2; signature: string }>()
  const runs = new Map<string, ClearanceRun>()
  const events = new Map<string, RunEvent[]>()
  const requestIndex = new Map<string, string>()

  const ownedVault = (ownerId: string, vaultId: string) => {
    const value = vaults.get(vaultId)
    return value?.ownerId === ownerId ? value : null
  }
  const ownedRun = (ownerId: string, runId: string) => {
    const value = runs.get(runId)
    return value?.ownerId === ownerId ? value : null
  }

  return {
    async createVault(ownerId, input: CreateVault) {
      const timestamp = now().toISOString()
      const vault: Vault = { ...structuredClone(input), id: id(), ownerId, status: 'draft', activeMandateVersion: null, createdAt: timestamp, updatedAt: timestamp }
      vaults.set(vault.id, vault)
      return structuredClone(vault)
    },
    async listVaults(ownerId) { return [...vaults.values()].filter(v => v.ownerId === ownerId).map(value => structuredClone(value)) },
    async getVault(ownerId, vaultId) { const value = ownedVault(ownerId, vaultId); return value ? structuredClone(value) : null },
    async setVaultStatus(ownerId, vaultId, status: VaultStatus) {
      const value = ownedVault(ownerId, vaultId)
      if (!value) return null
      const updated = { ...value, status, updatedAt: now().toISOString() }
      vaults.set(vaultId, updated)
      return structuredClone(updated)
    },
    async saveMandate(ownerId, vaultId, mandate, signature) {
      const vault = ownedVault(ownerId, vaultId)
      if (!vault) throw new Error('vault not found')
      mandates.set(`${vaultId}:${mandate.mandateVersion}`, { mandate: structuredClone(mandate), signature })
      vaults.set(vaultId, { ...vault, activeMandateVersion: mandate.mandateVersion, status: 'active', updatedAt: now().toISOString() })
    },
    async createRun(ownerId, input: CreateRun) {
      if (!ownedVault(ownerId, input.vaultId)) throw new Error('vault not found')
      const fingerprint = canonicalRunFingerprint(input)
      const requestKey = `${ownerId}:${input.vaultId}:${input.requestId}`
      const existingId = requestIndex.get(requestKey)
      if (existingId) {
        const existing = runs.get(existingId)!
        if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError()
        return { run: structuredClone(existing), created: false }
      }
      const timestamp = now().toISOString()
      const run: ClearanceRun = { ...structuredClone(input), id: id(), ownerId, fingerprint, state: 'PENDING_APPROVAL', publicProofDigest: null, createdAt: timestamp, updatedAt: timestamp }
      runs.set(run.id, run)
      requestIndex.set(requestKey, run.id)
      events.set(run.id, [{ runId: run.id, sequence: 1, type: 'PENDING_APPROVAL', occurredAt: timestamp, visibility: 'private', detail: 'Run draft awaits exact owner approval.' }])
      return { run: structuredClone(run), created: true }
    },
    async getRun(ownerId, runId) { const value = ownedRun(ownerId, runId); return value ? structuredClone(value) : null },
    async listRuns(ownerId, vaultId) { return [...runs.values()].filter(run => run.ownerId === ownerId && (!vaultId || run.vaultId === vaultId)).map(value => structuredClone(value)) },
    async appendEvent(ownerId, runId, input) {
      const run = ownedRun(ownerId, runId)
      if (!run) throw new Error('run not found')
      const rows = events.get(runId) ?? []
      const event: RunEvent = { ...structuredClone(input), runId, sequence: rows.length + 1, occurredAt: input.occurredAt ?? now().toISOString() }
      rows.push(event); events.set(runId, rows)
      runs.set(runId, { ...run, state: event.type as ClearanceRun['state'], updatedAt: event.occurredAt })
      return structuredClone(event)
    },
    async listEvents(ownerId, runId, afterSequence = 0) {
      if (!ownedRun(ownerId, runId)) return null
      return (events.get(runId) ?? []).filter(event => event.sequence > afterSequence).map(value => structuredClone(value))
    },
  }
}
