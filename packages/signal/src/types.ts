export type Verdict = 'CONFORMANT' | 'NON_CONFORMANT' | 'STALE' | 'DISAGREEMENT'

/**
 * Precedence when several checks fail at once, hardest failure first.
 * A wrong deployment is a worse answer than a slow one, so CID/indexing
 * failures outrank disagreement, which outranks staleness.
 */
export const VERDICT_PRECEDENCE: Verdict[] = [
  'NON_CONFORMANT',
  'DISAGREEMENT',
  'STALE',
  'CONFORMANT',
]

export interface Subject {
  protocol: string
  network: string
  deploymentId: string
}

/** Caller-supplied policy. The pin and the bound are the CALLER's, not ours. */
export interface Policy {
  pinnedCid: string | null
  lagBoundBlocks: number
}

export interface CheckResult {
  pass: boolean
  [k: string]: unknown
}

export interface CidMatchCheck extends CheckResult {
  served: string
  pinned: string | null
}

export interface IndexingErrorsCheck extends CheckResult {
  value: boolean
}

export interface FreshnessCheck extends CheckResult {
  lagBlocks: number
  bound: number
  block: number
  headBlock: number
}

export interface ShapeAgreementCheck extends CheckResult {
  peers: number
  fieldsCompared: number
  mismatches: number
  missingByDeployment: Record<string, string[]>
  extraByDeployment: Record<string, string[]>
}

export interface InvariantsCheck extends CheckResult {
  checked: number
  violations: string[]
}

export interface Checks {
  cidMatch: CidMatchCheck
  indexingErrors: IndexingErrorsCheck
  freshness: FreshnessCheck
  shapeAgreement: ShapeAgreementCheck
  invariants: InvariantsCheck
}

export interface VerdictPayload {
  v: 1
  requestId: string
  issuedAt: string
  standard: string
  subject: Subject
  policy: Policy
  checks: Checks
  verdict: Verdict
  evidence: { queryHash: string; queryText: string; block: number }
  signer: string
}

export interface SignedVerdict extends VerdictPayload {
  signature: string
}

/** Exact ATS hold that a paid clearing decision is allowed to settle. */
export interface ClearingTrade {
  chainId: string
  verifyingContract: string
  security: string
  partition: string
  seller: string
  buyer: string
  amount: string
  holdId: string
  holdExpiry: string
  policyHash: string
}

export interface ClearingAuthorization extends ClearingTrade {
  action: 1 | 2
  evidenceHash: string
  paymentRef: string
  issuedAt: string
  authorizationExpiry: string
  nonce: string
}

/**
 * The legacy derived verdict remains attached for CLI/MCP consumers, while the
 * independently signed EIP-712 authorization is the only object ClearingEscrow
 * will accept for settlement.
 */
export interface SignedClearingVerdict extends SignedVerdict {
  authorization: ClearingAuthorization
  authorizationSignature: string
}
