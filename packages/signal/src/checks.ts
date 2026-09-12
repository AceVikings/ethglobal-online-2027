import type {
  Checks,
  CidMatchCheck,
  FreshnessCheck,
  IndexingErrorsCheck,
  InvariantsCheck,
  Policy,
  ShapeAgreementCheck,
  Verdict,
  VerdictPayload,
  Subject,
} from './types.ts'

export interface SchemaShape {
  deploymentId: string
  fields: readonly string[]
}

export interface LendingMarketSnapshot {
  id: string
  totalValueLockedUSD?: string | number | null
  totalBorrowBalanceUSD?: string | number | null
  totalDepositBalanceUSD?: string | number | null
  inputTokenBalance?: string | number | null
}

export interface CheckConformanceInput {
  policy: Policy
  servedCid: string
  hasIndexingErrors: boolean
  indexedBlock: number
  headBlock: number
  schemas: readonly SchemaShape[]
  /** Common standardized fields; protocol-specific extension fields are allowed. */
  requiredSchemaFields?: readonly string[]
  markets: readonly LendingMarketSnapshot[]
  indexedTimestamp?: number | null
  previousIndexedTimestamp?: number | null
}

export interface BuildVerdictPayloadInput extends CheckConformanceInput {
  requestId: string
  issuedAt: string
  standard: string
  subject: Subject
  evidence: VerdictPayload['evidence']
  signer: string
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`)
}

export function checkCidMatch(served: string, pinned: string | null): CidMatchCheck {
  return { pass: pinned === null || served === pinned, served, pinned }
}

export function checkIndexingErrors(value: boolean): IndexingErrorsCheck {
  return { pass: !value, value }
}

export function checkFreshness(indexedBlock: number, headBlock: number, bound: number): FreshnessCheck {
  requireNonNegativeInteger('indexedBlock', indexedBlock)
  requireNonNegativeInteger('headBlock', headBlock)
  requireNonNegativeInteger('lagBoundBlocks', bound)
  const lagBlocks = Math.max(0, headBlock - indexedBlock)
  return { pass: lagBlocks <= bound, lagBlocks, bound, block: indexedBlock, headBlock }
}

function normalizedFields(fields: readonly string[]): string[] {
  return [...new Set(fields)].sort()
}

function difference(left: readonly string[], right: ReadonlySet<string>): string[] {
  return left.filter((field) => !right.has(field))
}

/** Compare every peer to the first schema, which is the conformance subject. */
export function checkShapeAgreement(
  schemas: readonly SchemaShape[],
  requiredFields?: readonly string[],
): ShapeAgreementCheck {
  if (schemas.length === 0) {
    return {
      pass: false,
      peers: 0,
      fieldsCompared: 0,
      mismatches: 1,
      missingByDeployment: { '<subject>': ['schema'] },
      extraByDeployment: {},
    }
  }

  const reference = normalizedFields(requiredFields ?? schemas[0].fields)
  const referenceSet = new Set(reference)
  const missingByDeployment: Record<string, string[]> = {}
  const extraByDeployment: Record<string, string[]> = {}
  let mismatches = 0

  for (const schema of schemas.slice(1)) {
    const fields = normalizedFields(schema.fields)
    const fieldsSet = new Set(fields)
    const missing = difference(reference, fieldsSet)
    const extra = requiredFields ? [] : difference(fields, referenceSet)
    if (missing.length) missingByDeployment[schema.deploymentId] = missing
    if (extra.length) extraByDeployment[schema.deploymentId] = extra
    mismatches += missing.length + extra.length
  }

  return {
    pass: mismatches === 0,
    peers: Math.max(0, schemas.length - 1),
    fieldsCompared: reference.length,
    mismatches,
    missingByDeployment,
    extraByDeployment,
  }
}

function decimal(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function checkInvariants(
  markets: readonly LendingMarketSnapshot[],
  indexedTimestamp?: number | null,
  previousIndexedTimestamp?: number | null,
): InvariantsCheck {
  const violations: string[] = []
  let checked = 0

  for (const market of markets) {
    const tvl = decimal(market.totalValueLockedUSD)
    checked += 1
    if (tvl === null || tvl < 0) violations.push(`${market.id}: totalValueLockedUSD must be non-negative`)

    const borrowed = decimal(market.totalBorrowBalanceUSD)
    const deposited = decimal(market.totalDepositBalanceUSD)
    checked += 1
    if (borrowed === null || deposited === null || borrowed > deposited) {
      violations.push(`${market.id}: totalBorrowBalanceUSD must not exceed totalDepositBalanceUSD`)
    }

    const inputBalance = decimal(market.inputTokenBalance)
    checked += 1
    if (inputBalance === null || inputBalance < 0) {
      violations.push(`${market.id}: inputTokenBalance must be non-negative`)
    }
  }

  if (previousIndexedTimestamp !== null && previousIndexedTimestamp !== undefined) {
    checked += 1
    if (indexedTimestamp === null || indexedTimestamp === undefined || indexedTimestamp < previousIndexedTimestamp) {
      violations.push('_meta.block.timestamp must be monotonic')
    }
  }

  return { pass: violations.length === 0, checked, violations }
}

export function verdictForChecks(checks: Checks): Verdict {
  if (!checks.cidMatch.pass || !checks.indexingErrors.pass || !checks.invariants.pass) return 'NON_CONFORMANT'
  if (!checks.shapeAgreement.pass) return 'DISAGREEMENT'
  if (!checks.freshness.pass) return 'STALE'
  return 'CONFORMANT'
}

export function checkConformance(input: CheckConformanceInput): { checks: Checks; verdict: Verdict } {
  const checks: Checks = {
    cidMatch: checkCidMatch(input.servedCid, input.policy.pinnedCid),
    indexingErrors: checkIndexingErrors(input.hasIndexingErrors),
    freshness: checkFreshness(input.indexedBlock, input.headBlock, input.policy.lagBoundBlocks),
    shapeAgreement: checkShapeAgreement(input.schemas, input.requiredSchemaFields),
    invariants: checkInvariants(input.markets, input.indexedTimestamp, input.previousIndexedTimestamp),
  }
  return { checks, verdict: verdictForChecks(checks) }
}

/** Build the complete unsigned product payload from normalized live evidence. */
export function buildVerdictPayload(input: BuildVerdictPayloadInput): VerdictPayload {
  const { checks, verdict } = checkConformance(input)
  return {
    v: 1,
    requestId: input.requestId,
    issuedAt: input.issuedAt,
    standard: input.standard,
    subject: input.subject,
    policy: input.policy,
    checks,
    verdict,
    evidence: input.evidence,
    signer: input.signer,
  }
}
