import { readFile } from 'node:fs/promises'
import { formatUnits } from 'ethers'

type StoredTransition = { phase: string; occurredAt: string }
type StoredState = Record<string, any> & { transitions?: StoredTransition[] }

export interface TradeReadModel {
  list(): Promise<{ trades: unknown[]; nextCursor: null }>
  get(tradeDigest: string): Promise<unknown | null>
  events(tradeDigest: string): Promise<unknown[] | null>
}

type TradeReaderOptions = {
  stateFile: string
  securityId?: string
  topicId?: string
  priceUsd?: string
  instrumentName?: string
  instrumentSymbol?: string
  instrumentDecimals?: number
}

async function readState(filename: string): Promise<StoredState | null> {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as StoredState
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function transactionTime(transactionId: string | undefined, fallback: string): string {
  const consensus = transactionId?.split('@')[1]
  const seconds = consensus?.split('.')[0]
  return seconds && /^\d+$/.test(seconds) ? new Date(Number(seconds) * 1000).toISOString() : fallback
}

function at(state: StoredState, phase: string, fallback: string): string {
  return state.transitions?.find((transition) => transition.phase === phase)?.occurredAt ?? fallback
}

function checkRows(checks: Record<string, any> = {}) {
  const specs = [
    ['cidMatch', 'CID_MATCH', 'Deployment CID', (v: any) => v.pinned ? `${v.served} / ${v.pinned}` : `${v.served} (unpinned)`],
    ['indexingErrors', 'INDEXING_ERRORS', 'Indexing errors', (v: any) => String(v.value)],
    ['freshness', 'FRESHNESS', 'Evidence freshness', (v: any) => `${v.lagBlocks} / ${v.bound} blocks`],
    ['shapeAgreement', 'SHAPE_AGREEMENT', 'Standardized schema', (v: any) => `${v.mismatches} mismatches across ${v.peers} peers`],
    ['invariants', 'INVARIANTS', 'Market invariants', (v: any) => `${v.violations?.length ?? 0} violations across ${v.checked}`],
  ] as const
  return specs.flatMap(([key, code, label, value]) => checks[key]
    ? [{ code, label, result: checks[key].pass ? 'PASS' : 'FAIL', publicValue: value(checks[key]) }]
    : [])
}

function hashscan(kind: 'contract' | 'transaction' | 'topic', id?: string | null): string | null {
  return id ? `https://hashscan.io/testnet/${kind}/${id}` : null
}

function project(state: StoredState, options: TradeReaderOptions) {
  const tradeDigest = state.settlement?.tradeDigest || state.submitted?.tradeDigest
  const authorization = state.authorization
  const verdict = state.purchased?.verdict
  if (!tradeDigest || !authorization || !verdict || !state.settlement) return null

  const transitions = state.transitions ?? []
  const fallback = state.updatedAt ?? verdict.issuedAt
  const action = authorization.action === 1 ? 'EXECUTE' : 'RELEASE'
  const lifecycle = action === 'EXECUTE' ? 'EXECUTED' : 'RELEASED'
  const settlementAt = transactionTime(state.settlement.transactionId, at(state, 'SETTLED', fallback))
  const explanation = state.reasoning?.rationale ?? null
  const instrumentId = options.securityId || authorization.security

  const trade = {
    tradeDigest,
    sequence: `CLR-${String(authorization.holdId).padStart(3, '0')}`,
    state: lifecycle,
    verdict: action === 'EXECUTE' ? 'APPROVE' : 'DENY',
    instrument: {
      name: options.instrumentName || 'Spokane Private Credit Fund',
      symbol: options.instrumentSymbol || 'SPCF', securityAddress: authorization.security,
      partition: authorization.partition, network: 'hedera-testnet',
    },
    hold: {
      holdId: authorization.holdId, seller: authorization.seller, buyer: authorization.buyer,
      escrow: authorization.verifyingContract, units: formatUnits(authorization.amount, options.instrumentDecimals ?? 6),
      createdAt: state.hold?.createdAt ?? at(state, 'HOLD_CONFIRMED', verdict.issuedAt),
      expiresAt: new Date(Number(authorization.holdExpiry) * 1000).toISOString(),
    },
    payment: {
      status: 'SETTLED', asset: 'USDC', amount: options.priceUsd || '0.01', facilitator: 'Blocky402',
      reference: authorization.paymentRef, transactionId: state.purchased.paymentTxId,
    },
    decision: {
      policyHash: authorization.policyHash, evidenceHash: authorization.evidenceHash, signer: verdict.signer,
      issuedAt: new Date(Number(authorization.issuedAt) * 1000).toISOString(),
      expiresAt: new Date(Number(authorization.authorizationExpiry) * 1000).toISOString(),
      nonce: authorization.nonce, nonceConsumed: true, checks: checkRows(verdict.checks), explanation,
      explanationProvider: explanation ? 'deepseek' : null,
    },
    settlement: {
      action, transactionId: state.settlement.transactionId, consensusAt: settlementAt,
      contractEvent: 'HoldSettled',
      hcsTopicId: state.audit?.status === 'ANCHORED' ? options.topicId || null : null,
      hcsSequenceNumber: null,
    },
    links: {
      security: hashscan('contract', instrumentId),
      escrow: hashscan('contract', authorization.verifyingContract),
      payment: hashscan('transaction', state.purchased.paymentTxId),
      settlement: hashscan('transaction', state.settlement.transactionId),
      hcsTopic: state.audit?.status === 'ANCHORED' ? hashscan('topic', options.topicId) : null,
    },
    updatedAt: state.updatedAt ?? settlementAt,
  }

  const phaseEvents: Record<string, [string, string]> = {
    HOLD_CONFIRMED: ['HOLD_CREATED', 'Exact ATS hold confirmed for the named buyer and escrow.'],
    PAID: ['PAYMENT_SETTLED', 'Blocky402 payment settled before the signed verdict was returned.'],
    AUTHORIZED: ['VERDICT_SIGNED', 'Deterministic checks produced an action-bound signed verdict.'],
    SETTLED: [action === 'EXECUTE' ? 'HOLD_EXECUTED' : 'HOLD_RELEASED', action === 'EXECUTE'
      ? 'ClearingEscrow executed the exact held units to the buyer.'
      : 'ClearingEscrow released the exact hold without transferring units to the buyer.'],
    COMPLETE: ['AUDIT_ANCHORED', 'Final clearing evidence was anchored to the restricted HCS topic.'],
  }
  const events = transitions.flatMap((transition, index) => {
    const spec = phaseEvents[transition.phase]
    if (!spec || (transition.phase === 'COMPLETE' && state.audit?.status !== 'ANCHORED')) return []
    const rows = [{ id: `${tradeDigest}:${index}`, tradeDigest, type: spec[0], occurredAt: transition.occurredAt,
      transactionId: transition.phase === 'PAID' ? state.purchased.paymentTxId
        : transition.phase === 'SETTLED' ? state.settlement.transactionId
          : transition.phase === 'COMPLETE' ? state.audit?.transactionId ?? null : null,
      publicDetail: spec[1] }]
    if (transition.phase === 'AUTHORIZED') rows.unshift({
      id: `${tradeDigest}:${index}:evidence`, tradeDigest, type: 'EVIDENCE_EVALUATED',
      occurredAt: transition.occurredAt, transactionId: null,
      publicDetail: 'Live standardized Graph evidence passed through the deterministic policy.',
    })
    return rows
  })
  return { trade, events }
}

export function createFileTradeReadModel(options: TradeReaderOptions): TradeReadModel {
  async function current() {
    const state = await readState(options.stateFile)
    return state ? project(state, options) : null
  }
  return {
    async list() { const value = await current(); return { trades: value ? [value.trade] : [], nextCursor: null } },
    async get(tradeDigest) { const value = await current(); return value?.trade.tradeDigest.toLowerCase() === tradeDigest.toLowerCase() ? value.trade : null },
    async events(tradeDigest) { const value = await current(); return value?.trade.tradeDigest.toLowerCase() === tradeDigest.toLowerCase() ? value.events : null },
  }
}
