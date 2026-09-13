export type VaultStatus = 'draft' | 'active' | 'paused' | 'expired' | 'revoked' | 'archived'
export type TriggerMode = 'confirm_each_run' | 'standing'

export interface CuratedOffering {
  id: string
  name: string
  symbol: string
  securityId: string
  security: string
  partition: string
  seller: string
  decimals: number
  quoteCurrency: 'USDC'
}

export interface OfferingQuote {
  id: string
  offeringId: string
  version: number
  unitPriceMinor: string
  unitsBase: string
  principalMinor: string
  expiresAt: string
}

export interface VaultPolicy {
  maxUtilizationBps: number
  maxLagBlocks: number
  minTvlUsdMinor: string
  requireSchemaAgreement: boolean
  requireInvariantPass: boolean
}

export interface Vault {
  id: string
  ownerId: string
  name: string
  offeringId: string
  receiver: string
  executorRef: string
  policy: VaultPolicy
  status: VaultStatus
  activeMandateVersion: number | null
  createdAt: string
  updatedAt: string
}

export type CreateVault = Pick<Vault, 'name' | 'offeringId' | 'receiver' | 'executorRef' | 'policy'>
