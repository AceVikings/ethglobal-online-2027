import { randomUUID } from 'node:crypto'
import { canonicalRunFingerprint, type ClearanceRun, type CreateRun, type CreateVault, type RunEvent, type Vault, type VaultMandateV2, type VaultStatus } from '@desk/signal'
import { IdempotencyConflictError, type VaultRepository } from './types.ts'

// Kept structural so emulator tests can inject the SDK and domain tests need no network.
type Doc = { id: string; exists: boolean; data(): Record<string, any> | undefined; ref: any }
type FirestoreLike = {
  collection(path: string): { doc(id?: string): any; where(field: string, op: string, value: unknown): { get(): Promise<{ docs: Doc[] }> } }
  runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
}

export function createFirestoreVaultRepository(db: FirestoreLike, options: { id?: () => string; now?: () => Date } = {}): VaultRepository {
  const id = options.id ?? randomUUID
  const now = options.now ?? (() => new Date())
  const vaultsFor = (ownerId: string) => db.collection(`users/${ownerId}/vaults`)
  const vaultRef = (ownerId: string, vaultId: string) => vaultsFor(ownerId).doc(vaultId)
  const runRef = (runId: string) => db.collection('runs').doc(runId)
  const owned = <T extends { ownerId: string }>(snapshot: Doc, ownerId: string): T | null => snapshot.exists && snapshot.data()?.ownerId === ownerId ? snapshot.data() as T : null
  return {
    async createVault(ownerId, input: CreateVault) {
      const timestamp = now().toISOString(); const vault: Vault = { ...input, id: id(), ownerId, status: 'draft', activeMandateVersion: null, createdAt: timestamp, updatedAt: timestamp }
      await vaultRef(ownerId, vault.id).create(vault); return vault
    },
    async listVaults(ownerId) { const rows = await vaultsFor(ownerId).where('ownerId', '==', ownerId).get(); return rows.docs.map(doc => doc.data() as Vault) },
    async getVault(ownerId, vaultId) { return owned<Vault>(await vaultRef(ownerId, vaultId).get(), ownerId) },
    async setVaultStatus(ownerId, vaultId, status: VaultStatus) {
      return db.runTransaction(async tx => { const ref = vaultRef(ownerId, vaultId); const current = owned<Vault>(await tx.get(ref), ownerId); if (!current) return null; const updated = { ...current, status, updatedAt: now().toISOString() }; tx.set(ref, updated); return updated })
    },
    async saveMandate(ownerId, vaultId, mandate: VaultMandateV2, signature: string) {
      await db.runTransaction(async tx => { const ref = vaultRef(ownerId, vaultId); const current = owned<Vault>(await tx.get(ref), ownerId); if (!current) throw new Error('vault not found'); tx.create(ref.collection('mandates').doc(String(mandate.mandateVersion)), { mandate, signature }); tx.update(ref, { activeMandateVersion: mandate.mandateVersion, status: 'active', updatedAt: now().toISOString() }) })
    },
    async getMandate(ownerId, vaultId, version) {
      const vault = await this.getVault(ownerId, vaultId)
      if (!vault) return null
      const selected = version ?? vault.activeMandateVersion
      if (!selected) return null
      const row = await vaultRef(ownerId, vaultId).collection('mandates').doc(String(selected)).get()
      return row.exists ? row.data() as { mandate: VaultMandateV2; signature: string } : null
    },
    async createRun(ownerId, input: CreateRun) {
      const fingerprint = canonicalRunFingerprint(input); const key = `${ownerId}:${input.vaultId}:${input.requestId}`; const indexRef = db.collection('runRequests').doc(Buffer.from(key).toString('base64url'))
      return db.runTransaction(async tx => {
        if (!owned<Vault>(await tx.get(vaultRef(ownerId, input.vaultId)), ownerId)) throw new Error('vault not found')
        const index = await tx.get(indexRef)
        if (index.exists) { const data = index.data(); if (data.fingerprint !== fingerprint) throw new IdempotencyConflictError(); return { run: (await tx.get(runRef(data.runId))).data() as ClearanceRun, created: false } }
        const timestamp = now().toISOString(); const run: ClearanceRun = { ...input, id: id(), ownerId, fingerprint, state: 'PENDING_APPROVAL', publicProofDigest: null, createdAt: timestamp, updatedAt: timestamp }
        tx.create(runRef(run.id), run); tx.create(indexRef, { ownerId, vaultId: input.vaultId, requestId: input.requestId, fingerprint, runId: run.id }); tx.create(runRef(run.id).collection('events').doc('000000000001'), { runId: run.id, sequence: 1, type: 'PENDING_APPROVAL', occurredAt: timestamp, visibility: 'private', detail: 'Run draft awaits exact owner approval.' }); return { run, created: true }
      })
    },
    async getRun(ownerId, runId) { return owned<ClearanceRun>(await runRef(runId).get(), ownerId) },
    async listRuns(ownerId, vaultId) { let query: any = db.collection('runs').where('ownerId', '==', ownerId); if (vaultId) query = query.where('vaultId', '==', vaultId); const rows = await query.get(); return rows.docs.map((doc: Doc) => doc.data() as ClearanceRun) },
    async appendEvent(ownerId, runId, input) {
      return db.runTransaction(async tx => { const ref = runRef(runId); const run = owned<ClearanceRun>(await tx.get(ref), ownerId); if (!run) throw new Error('run not found'); const rows = await tx.get(ref.collection('events').orderBy('sequence', 'desc').limit(1)); const sequence = (rows.docs[0]?.data()?.sequence ?? 0) + 1; const event: RunEvent = { ...input, runId, sequence, occurredAt: input.occurredAt ?? now().toISOString() }; tx.create(ref.collection('events').doc(String(sequence).padStart(12, '0')), event); tx.update(ref, { state: event.type, updatedAt: event.occurredAt }); return event })
    },
    async listEvents(ownerId, runId, afterSequence = 0) { if (!await this.getRun(ownerId, runId)) return null; const rows = await runRef(runId).collection('events').where('sequence', '>', afterSequence).orderBy('sequence').get(); return rows.docs.map((doc: Doc) => doc.data() as RunEvent) },
  }
}
