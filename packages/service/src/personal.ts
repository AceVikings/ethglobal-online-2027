import { randomBytes } from 'node:crypto'
import { formatUnits, getAddress, keccak256, parseUnits, toUtf8Bytes } from 'ethers'
import {
  VAULT_MANDATE_TYPES,
  canonicalJSON,
  type CuratedOffering,
  type VaultMandateV2,
} from '@desk/signal'
import { parseCreateVault } from './vaults.ts'
import type { VaultRepository } from './repositories/types.ts'

export type WebOffering = CuratedOffering & { description: string; unitPrice: string; currency: 'USDC' }

export type VaultDraftInput = {
  offeringId: string
  receiver: string
  name: string
  units: string
  maxPrice: string
  maxEvidenceFee: string
  maxUtilization: number
  maxEvidenceAgeMinutes: number
  expiresAt: string
}

type Draft = { ownerId: string; vaultId: string; mandate: VaultMandateV2; message: string; principal: string }

function requiredEnv(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = env[name] ?? fallback
  if (!value) throw new Error(`${name} is required for personalized vaults`)
  return value
}

function positiveDecimal(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value) || Number(value) <= 0) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

export function offeringCatalogFromEnv(env: NodeJS.ProcessEnv = process.env): WebOffering[] {
  const securityId = requiredEnv(env, 'ATS_SECURITY_ID', '0.0.10516330')
  const security = requiredEnv(env, 'ATS_SECURITY_EVM_ADDRESS', '0xa1c86fde69f571993000cb10ee6a4622f1d4810c')
  return [{
    id: 'spokane-private-credit',
    name: env.EQUITY_NAME ?? 'Spokane Private Credit Fund',
    symbol: env.EQUITY_SYMBOL ?? 'SPCF',
    description: 'A compliance-controlled private-credit fund unit issued with Hedera ATS.',
    securityId,
    security: getAddress(security),
    partition: requiredEnv(env, 'ATS_PARTITION', `0x${'0'.repeat(63)}1`),
    seller: getAddress(requiredEnv(env, 'SELLER_EVM_ADDRESS')),
    decimals: 6,
    quoteCurrency: 'USDC',
    unitPrice: env.OFFERING_UNIT_PRICE_USDC ?? '12.50',
    currency: 'USDC',
  }]
}

export function createPersonalVaultService(repository: VaultRepository, env: NodeJS.ProcessEnv = process.env) {
  const offerings = offeringCatalogFromEnv(env)
  const drafts = new Map<string, Draft>()
  const executor = getAddress(requiredEnv(env, 'BUYER_EVM_ADDRESS'))
  const verifyingContract = getAddress(requiredEnv(env, 'CLEARING_ESCROW_ADDRESS'))

  const offering = (id: string) => {
    const result = offerings.find(item => item.id === id)
    if (!result) throw new Error('offeringId is invalid')
    return result
  }

  return {
    offerings,
    executor,
    async preview(ownerId: string, raw: unknown) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('vault draft is invalid')
      const input = raw as Record<string, unknown>
      const selected = offering(String(input.offeringId ?? ''))
      const units = positiveDecimal(input.units, 'units')
      const maxPrice = positiveDecimal(input.maxPrice, 'maxPrice')
      const maxEvidenceFee = positiveDecimal(input.maxEvidenceFee, 'maxEvidenceFee')
      if (Number(maxEvidenceFee) > Number(env.X402_PRICE_USDC ?? '0.01')) throw new Error('maxEvidenceFee exceeds the live quote')
      const expires = Date.parse(String(input.expiresAt ?? ''))
      if (!Number.isFinite(expires) || expires <= Date.now() + 60_000 || expires > Date.now() + 7 * 86_400_000) throw new Error('expiresAt is invalid')
      const receiver = getAddress(String(input.receiver ?? ''))
      const maxUtilization = Number(input.maxUtilization)
      const maxAge = Number(input.maxEvidenceAgeMinutes)
      const vault = await repository.createVault(ownerId, parseCreateVault({
        name: input.name,
        offeringId: selected.id,
        receiver,
        executorRef: executor,
        policy: {
          maxUtilizationBps: Math.round(maxUtilization * 100),
          maxLagBlocks: Math.max(1, Math.round(maxAge * 4)),
          minTvlUsdMinor: '1',
          requireSchemaAgreement: true,
          requireInvariantPass: true,
        },
      }))
      const unitsBase = parseUnits(units, selected.decimals)
      const quoteMinor = parseUnits(selected.unitPrice, 6)
      const maxPriceMinor = parseUnits(maxPrice, 6)
      if (maxPriceMinor < quoteMinor) throw new Error('maxPrice is below the current quote')
      const principalMinor = unitsBase * quoteMinor / (10n ** BigInt(selected.decimals))
      const maxPrincipal = unitsBase * maxPriceMinor / (10n ** BigInt(selected.decimals))
      const policyHash = keccak256(toUtf8Bytes(canonicalJSON(vault.policy)))
      const mandate: VaultMandateV2 = {
        version: 2,
        owner: ownerId,
        receiver,
        vaultId: vault.id,
        mandateVersion: 1,
        executor,
        network: 'hedera:testnet',
        chainId: '296',
        verifyingContract,
        offeringId: selected.id,
        security: selected.security,
        partition: selected.partition,
        unitsBase: unitsBase.toString(),
        maxUnitPriceMinor: maxPriceMinor.toString(),
        maxPrincipalPerRunMinor: maxPrincipal.toString(),
        maxEvidenceFeePerRunMinor: parseUnits(maxEvidenceFee, 6).toString(),
        aggregatePrincipalCapMinor: maxPrincipal.toString(),
        aggregateEvidenceFeeCapMinor: parseUnits(maxEvidenceFee, 6).toString(),
        aggregateUnitCapBase: unitsBase.toString(),
        maxRunCount: 1,
        policyHash,
        triggerMode: 'confirm_each_run',
        validFrom: String(Math.floor(Date.now() / 1000)),
        expiresAt: String(Math.floor(expires / 1000)),
        nonce: `0x${randomBytes(32).toString('hex')}`,
      }
      const principal = `${formatUnits(principalMinor, 6)} USDC`
      const message = [
        `Activate ${vault.name}`,
        `${units} ${selected.symbol} at no more than ${maxPrice} USDC per unit`,
        `Principal cap: ${formatUnits(maxPrincipal, 6)} USDC`,
        `Evidence fee cap: ${maxEvidenceFee} USDC`,
        `Receiver: ${receiver}`,
        `Executor: ${executor}`,
        `Vault: ${vault.id}`,
        `Expires: ${new Date(expires).toISOString()}`,
      ].join('\n')
      drafts.set(vault.id, { ownerId, vaultId: vault.id, mandate, message, principal })
      return {
        draftId: vault.id,
        mandateMessage: message,
        mandate,
        typedData: {
          domain: { name: 'AI Clearing Desk Vault', version: '2', chainId: 296, verifyingContract },
          types: VAULT_MANDATE_TYPES,
          primaryType: 'VaultMandate',
          message: mandate,
        },
        preview: { policyHash, principal },
      }
    },
    draft(ownerId: string, draftId: string) {
      const draft = drafts.get(draftId)
      return draft?.ownerId === ownerId ? draft : null
    },
    consume(ownerId: string, draftId: string) {
      const draft = this.draft(ownerId, draftId)
      if (draft) drafts.delete(draftId)
      return draft
    },
  }
}

export type PersonalVaultService = ReturnType<typeof createPersonalVaultService>
