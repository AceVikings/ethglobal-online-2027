import { keccak256, toUtf8Bytes, SigningKey, computeAddress, TypedDataEncoder } from 'ethers'
import type {
  ClearingAuthorization, Policy, SignedVerdict, VerdictPayload,
} from './types.ts'
import type { VaultMandateV2 } from './mandate.ts'

/**
 * Canonical JSON: recursively sorted keys, no whitespace, UTF-8.
 *
 * This is the single most load-bearing function in the repo. The service signs
 * over its output, and the agent, the CLI and scripts/replay.ts all re-derive
 * the hash from it. Any divergence between producer and verifier silently
 * invalidates every signature, so there is exactly ONE implementation and
 * everything imports it from here.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null'
    return JSON.stringify(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'bigint') throw new TypeError('BigInt is not valid JSON')
  if (typeof value !== 'object') throw new TypeError(`${typeof value} is not valid canonical JSON`)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined ? 'null' : canonicalJSON(item))).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const body = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]))
    .join(',')
  return '{' + body + '}'
}

/** keccak256 over the canonical payload, excluding any signature field. */
export function signalHash(payload: VerdictPayload): string {
  // Whitelist the v1 envelope so independently signed clearing fields may be
  // attached without changing the legacy CLI/MCP verification digest.
  const value = {
    v: payload.v,
    requestId: payload.requestId,
    issuedAt: payload.issuedAt,
    standard: payload.standard,
    subject: payload.subject,
    policy: payload.policy,
    checks: payload.checks,
    verdict: payload.verdict,
    evidence: payload.evidence,
    signer: payload.signer,
  }
  return keccak256(toUtf8Bytes(canonicalJSON(value)))
}

/**
 * Raw secp256k1 signature retained for legacy CLI/MCP verification of the
 * derived verdict envelope. ClearingEscrow uses the EIP-712 signature below.
 */
export function signVerdict(payload: VerdictPayload, privateKey: string): SignedVerdict {
  const key = new SigningKey(privateKey)
  const derivedSigner = computeAddress(key.publicKey)
  if (derivedSigner.toLowerCase() !== payload.signer.toLowerCase()) {
    throw new Error(`Payload signer ${payload.signer} does not match private key ${derivedSigner}`)
  }
  const sig = key.sign(signalHash(payload))
  return { ...payload, signature: sig.serialized }
}

export function verifyVerdict(signed: SignedVerdict): { ok: boolean; recovered: string } {
  const { signature, ...payload } = signed
  const digest = signalHash(payload as VerdictPayload)
  const recovered = computeAddress(SigningKey.recoverPublicKey(digest, signature))
  return { ok: recovered.toLowerCase() === signed.signer.toLowerCase(), recovered }
}

export const CLEARING_AUTHORIZATION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Verdict: [
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
    { name: 'security', type: 'address' },
    { name: 'partition', type: 'bytes32' },
    { name: 'seller', type: 'address' },
    { name: 'buyer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'holdId', type: 'uint256' },
    { name: 'holdExpiry', type: 'uint256' },
    { name: 'action', type: 'uint8' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'paymentRef', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'authorizationExpiry', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

function clearingDomain(authorization: ClearingAuthorization) {
  return {
    name: 'AI Clearing Desk',
    version: '1',
    chainId: authorization.chainId,
    verifyingContract: authorization.verifyingContract,
  }
}

/** Exact digest consumed by ClearingEscrow.hashAuthorization. */
export function clearingAuthorizationHash(authorization: ClearingAuthorization): string {
  return TypedDataEncoder.hash(clearingDomain(authorization), CLEARING_AUTHORIZATION_TYPES, authorization)
}

export function signClearingAuthorization(authorization: ClearingAuthorization, privateKey: string): string {
  return new SigningKey(privateKey).sign(clearingAuthorizationHash(authorization)).serialized
}

export function verifyClearingAuthorization(
  authorization: ClearingAuthorization,
  signature: string,
  expectedSigner: string,
): { ok: boolean; recovered: string } {
  const recovered = computeAddress(SigningKey.recoverPublicKey(clearingAuthorizationHash(authorization), signature))
  return { ok: recovered.toLowerCase() === expectedSigner.toLowerCase(), recovered }
}

/** Canonical policy commitment deployed into ClearingEscrow. */
export function clearingPolicyHash(standard: string, policy: Policy): string {
  return keccak256(toUtf8Bytes(canonicalJSON({ standard, policy })))
}

/** Derived evidence commitment; raw Graph rows remain seller-private. */
export function clearingEvidenceHash(payload: Omit<VerdictPayload, 'v' | 'requestId' | 'issuedAt' | 'signer'>): string {
  return keccak256(toUtf8Bytes(canonicalJSON(payload)))
}

export const VAULT_MANDATE_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  VaultMandate: [
    ['owner', 'string'], ['receiver', 'address'], ['vaultId', 'string'], ['mandateVersion', 'uint256'],
    ['executor', 'address'], ['network', 'string'], ['offeringId', 'string'], ['security', 'address'],
    ['partition', 'bytes32'], ['unitsBase', 'uint256'], ['maxUnitPriceMinor', 'uint256'],
    ['maxPrincipalPerRunMinor', 'uint256'], ['maxEvidenceFeePerRunMinor', 'uint256'],
    ['aggregatePrincipalCapMinor', 'uint256'], ['aggregateEvidenceFeeCapMinor', 'uint256'],
    ['aggregateUnitCapBase', 'uint256'], ['maxRunCount', 'uint256'], ['policyHash', 'bytes32'],
    ['triggerMode', 'string'], ['validFrom', 'uint256'], ['expiresAt', 'uint256'], ['nonce', 'bytes32'],
  ].map(([name, type]) => ({ name, type })),
}

function vaultMandateDomain(mandate: VaultMandateV2) {
  return { name: 'AI Clearing Desk Vault', version: '2', chainId: mandate.chainId, verifyingContract: mandate.verifyingContract }
}

export function hashVaultMandate(mandate: VaultMandateV2): string {
  return TypedDataEncoder.hash(vaultMandateDomain(mandate), VAULT_MANDATE_TYPES, mandate)
}

export function verifyVaultMandateSignature(mandate: VaultMandateV2, signature: string): string {
  return computeAddress(SigningKey.recoverPublicKey(hashVaultMandate(mandate), signature))
}
