import type {
  AppendRunEvent, ClearanceRun, CreateRun, CreateVault, RunEvent, Vault, VaultMandateV2, VaultStatus,
} from '@desk/signal'

export class IdempotencyConflictError extends Error {
  constructor() { super('idempotency conflict'); this.name = 'IdempotencyConflictError' }
}

export interface VaultRepository {
  createVault(ownerId: string, input: CreateVault): Promise<Vault>
  listVaults(ownerId: string): Promise<Vault[]>
  getVault(ownerId: string, vaultId: string): Promise<Vault | null>
  setVaultStatus(ownerId: string, vaultId: string, status: VaultStatus): Promise<Vault | null>
  saveMandate(ownerId: string, vaultId: string, mandate: VaultMandateV2, signature: string): Promise<void>
  createRun(ownerId: string, input: CreateRun): Promise<{ run: ClearanceRun; created: boolean }>
  getRun(ownerId: string, runId: string): Promise<ClearanceRun | null>
  listRuns(ownerId: string, vaultId?: string): Promise<ClearanceRun[]>
  appendEvent(ownerId: string, runId: string, event: AppendRunEvent): Promise<RunEvent>
  listEvents(ownerId: string, runId: string, afterSequence?: number): Promise<RunEvent[] | null>
}
