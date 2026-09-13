export type LiveMandate = {
  version: 1
  owner: string
  wallet: string
  network: 'hedera:testnet'
  asset: 'SPCF'
  units: '1.0'
  maxDecisionFee: '0.01 USDC'
  policy: 'strict-market-health'
  expiresAt: string
  nonce: string
}

export type SignedLiveMandate = {
  mandate: LiveMandate
  signature: string
}

export function liveMandateMessage(mandate: LiveMandate): string {
  return [
    'Clearing AI mandate',
    `Version: ${mandate.version}`,
    `Owner: ${mandate.owner}`,
    `Wallet: ${mandate.wallet}`,
    `Network: ${mandate.network}`,
    `Asset: ${mandate.asset}`,
    `Units: ${mandate.units}`,
    `Max decision fee: ${mandate.maxDecisionFee}`,
    `Policy: ${mandate.policy}`,
    `Expires: ${mandate.expiresAt}`,
    `Nonce: ${mandate.nonce}`,
  ].join('\n')
}

export type VaultMandateV2 = {
  version: 2
  owner: string
  receiver: string
  vaultId: string
  mandateVersion: number
  executor: string
  network: 'hedera:testnet'
  chainId: string
  verifyingContract: string
  offeringId: string
  security: string
  partition: string
  unitsBase: string
  maxUnitPriceMinor: string
  maxPrincipalPerRunMinor: string
  maxEvidenceFeePerRunMinor: string
  aggregatePrincipalCapMinor: string
  aggregateEvidenceFeeCapMinor: string
  aggregateUnitCapBase: string
  maxRunCount: number
  policyHash: string
  triggerMode: 'confirm_each_run' | 'standing'
  validFrom: string
  expiresAt: string
  nonce: string
}

const MANDATE_FIELDS = [
  'version', 'owner', 'receiver', 'vaultId', 'mandateVersion', 'executor', 'network', 'chainId',
  'verifyingContract', 'offeringId', 'security', 'partition', 'unitsBase', 'maxUnitPriceMinor',
  'maxPrincipalPerRunMinor', 'maxEvidenceFeePerRunMinor', 'aggregatePrincipalCapMinor',
  'aggregateEvidenceFeeCapMinor', 'aggregateUnitCapBase', 'maxRunCount', 'policyHash', 'triggerMode',
  'validFrom', 'expiresAt', 'nonce',
] as const

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const UINT = /^(0|[1-9]\d*)$/

export function validateVaultMandate(input: unknown): VaultMandateV2 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('vault mandate must be an object')
  const value = input as Record<string, unknown>
  for (const key of Object.keys(value)) if (!(MANDATE_FIELDS as readonly string[]).includes(key)) throw new Error(`unknown field ${key}`)
  for (const field of MANDATE_FIELDS) if (!(field in value)) throw new Error(`${field} is required`)
  if (value.version !== 2 || value.network !== 'hedera:testnet') throw new Error('unsupported mandate version or network')
  for (const field of ['owner', 'vaultId', 'offeringId'] as const) if (typeof value[field] !== 'string' || !value[field]) throw new Error(`${field} is required`)
  for (const field of ['receiver', 'executor', 'verifyingContract', 'security'] as const) if (typeof value[field] !== 'string' || !ADDRESS.test(value[field])) throw new Error(`${field} is invalid`)
  for (const field of ['partition', 'policyHash', 'nonce'] as const) if (typeof value[field] !== 'string' || !BYTES32.test(value[field])) throw new Error(`${field} is invalid`)
  for (const field of ['chainId', 'unitsBase', 'maxUnitPriceMinor', 'maxPrincipalPerRunMinor', 'maxEvidenceFeePerRunMinor', 'aggregatePrincipalCapMinor', 'aggregateEvidenceFeeCapMinor', 'aggregateUnitCapBase', 'validFrom', 'expiresAt'] as const) {
    if (typeof value[field] !== 'string' || !UINT.test(value[field]) || BigInt(value[field]) <= 0n) throw new Error(`${field} must be a positive integer string`)
  }
  if (!Number.isSafeInteger(value.mandateVersion) || Number(value.mandateVersion) < 1) throw new Error('mandateVersion must be positive')
  if (!Number.isSafeInteger(value.maxRunCount) || Number(value.maxRunCount) < 1) throw new Error('maxRunCount must be positive')
  if (value.triggerMode !== 'confirm_each_run' && value.triggerMode !== 'standing') throw new Error('triggerMode is invalid')
  if (BigInt(value.expiresAt as string) <= BigInt(value.validFrom as string)) throw new Error('invalid validity window')
  if (BigInt(value.aggregateUnitCapBase as string) < BigInt(value.unitsBase as string)) throw new Error('aggregateUnitCapBase is below per-run units')
  if (BigInt(value.aggregatePrincipalCapMinor as string) < BigInt(value.maxPrincipalPerRunMinor as string)) throw new Error('aggregatePrincipalCapMinor is below per-run cap')
  if (BigInt(value.aggregateEvidenceFeeCapMinor as string) < BigInt(value.maxEvidenceFeePerRunMinor as string)) throw new Error('aggregateEvidenceFeeCapMinor is below per-run cap')
  return input as VaultMandateV2
}
