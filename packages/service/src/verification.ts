const DEFAULT_MIRROR_NODE_URL = 'https://testnet.mirrornode.hedera.com'
const DEFAULT_GRAPH_GATEWAY_URL = 'https://gateway.thegraph.com/api/deployments/id'

export type VerificationStageStatus = 'PASS' | 'FAIL'

export interface VerificationStage {
  id: 'graph_evidence' | 'x402_payment' | 'ats_settlement' | 'hcs_audit'
  label: string
  status: VerificationStageStatus
  detail: string
  sourceUrl: string
}

export interface PublicVerificationReport {
  tradeDigest: string
  verifiedAt: string
  status: 'VERIFIED' | 'FAILED'
  stages: VerificationStage[]
  summary: { passed: number; failed: number; total: number }
}

export interface PublicTradeVerifier {
  verify(trade: unknown): Promise<PublicVerificationReport>
}

interface PublicTrade {
  tradeDigest: string
  state: 'EXECUTED' | 'RELEASED'
  payment: { transactionId: string }
  decision: { evidence: { deploymentId: string; block: number } }
  settlement: {
    transactionId: string
    hcsTopicId: string
    hcsSequenceNumber: number
  }
}

export interface PublicTradeVerifierOptions {
  graphApiKey: string
  graphGatewayUrl?: string
  mirrorNodeUrl?: string
  fetch?: typeof globalThis.fetch
  now?: () => Date
  timeoutMs?: number
}

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireConfirmedTrade(value: unknown): PublicTrade {
  if (!record(value) || typeof value.tradeDigest !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.tradeDigest)) {
    throw new Error('confirmed trade has an invalid digest')
  }
  if (!['EXECUTED', 'RELEASED'].includes(value.state)) throw new Error('trade is not confirmed')
  if (!record(value.payment) || typeof value.payment.transactionId !== 'string') {
    throw new Error('confirmed trade has no x402 transaction')
  }
  if (!record(value.decision) || !record(value.decision.evidence) ||
      typeof value.decision.evidence.deploymentId !== 'string' ||
      !Number.isSafeInteger(value.decision.evidence.block)) {
    throw new Error('confirmed trade has no Graph evidence pin')
  }
  if (!record(value.settlement) || typeof value.settlement.transactionId !== 'string' ||
      typeof value.settlement.hcsTopicId !== 'string' ||
      !Number.isSafeInteger(value.settlement.hcsSequenceNumber)) {
    throw new Error('confirmed trade has no anchored settlement')
  }
  return value as PublicTrade
}

function normalizedTransactionId(value: string): string {
  const at = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(value)
  return at ? `${at[1]}-${at[2]}-${at[3]}` : value
}

function stage(
  id: VerificationStage['id'], label: string, sourceUrl: string,
  outcome: { pass: boolean; detail: string },
): VerificationStage {
  return { id, label, sourceUrl, status: outcome.pass ? 'PASS' : 'FAIL', detail: outcome.detail }
}

export function createPublicTradeVerifier(options: PublicTradeVerifierOptions): PublicTradeVerifier {
  if (!options.graphApiKey) throw new Error('A Graph Gateway API key is required for public verification')
  const graphGatewayUrl = (options.graphGatewayUrl ?? DEFAULT_GRAPH_GATEWAY_URL).replace(/\/$/, '')
  const mirrorNodeUrl = (options.mirrorNodeUrl ?? DEFAULT_MIRROR_NODE_URL).replace(/\/$/, '')
  const request = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? 10_000
  for (const url of [graphGatewayUrl, mirrorNodeUrl]) new URL(url)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('verification timeoutMs must be an integer from 100 to 30000')
  }

  async function json(url: string, init?: RequestInit): Promise<any> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await request(url, { ...init, signal: controller.signal })
      if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`)
      try {
        return await response.json()
      } catch {
        throw new Error('upstream returned invalid JSON')
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async function capture(check: () => Promise<{ pass: boolean; detail: string }>) {
    try {
      return await check()
    } catch (error) {
      const detail = error instanceof DOMException && error.name === 'AbortError'
        ? 'Upstream verification timed out.'
        : error instanceof Error && /^upstream returned HTTP \d+$/.test(error.message)
          ? `${error.message}.`
          : 'Upstream verification was unavailable.'
      return { pass: false, detail }
    }
  }

  return {
    async verify(candidate) {
      const trade = requireConfirmedTrade(candidate)
      const deploymentId = trade.decision.evidence.deploymentId
      const evidenceBlock = trade.decision.evidence.block
      const graphUrl = `${graphGatewayUrl}/${encodeURIComponent(deploymentId)}`
      // Mirror Node's path endpoint accepts the canonical account-seconds-nanos form. x402
      // facilitators may return the equivalent SDK form (account@seconds.nanos), so normalize the
      // path as well as the response comparison.
      const paymentUrl = `${mirrorNodeUrl}/api/v1/transactions/${encodeURIComponent(normalizedTransactionId(trade.payment.transactionId))}`
      const settlementUrl = `${mirrorNodeUrl}/api/v1/contracts/results/${encodeURIComponent(trade.settlement.transactionId)}`
      const auditUrl = `${mirrorNodeUrl}/api/v1/topics/${encodeURIComponent(trade.settlement.hcsTopicId)}/messages/${trade.settlement.hcsSequenceNumber}`

      const graph = await capture(async () => {
        const body = await json(graphUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.graphApiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: 'query PublicVerification($block: Int!) { _meta(block: { number: $block }) { deployment hasIndexingErrors block { number } } }',
            variables: { block: evidenceBlock },
          }),
        })
        const meta = body?.data?._meta
        const pass = !body?.errors?.length && meta?.deployment === deploymentId &&
          meta?.hasIndexingErrors === false && Number(meta?.block?.number) === evidenceBlock
        return {
          pass,
          detail: pass
            ? `Pinned deployment served evidence block ${evidenceBlock} without indexing errors.`
            : 'The Graph did not reproduce the pinned deployment and evidence block.',
        }
      })

      const payment = await capture(async () => {
        const body = await json(paymentUrl)
        const expected = normalizedTransactionId(trade.payment.transactionId)
        const transactions = Array.isArray(body?.transactions) ? body.transactions : []
        const match = transactions.find((item: any) =>
          typeof item?.transaction_id === 'string' && normalizedTransactionId(item.transaction_id) === expected)
        const pass = Boolean(match) && match.result === 'SUCCESS'
        return {
          pass,
          detail: pass ? 'Mirror Node confirms the x402 USDC payment reached consensus.'
            : 'Mirror Node did not confirm a successful x402 payment.',
        }
      })

      const settlement = await capture(async () => {
        const body = await json(settlementUrl)
        const pass = !body?.error_message && (!body?.result || body.result === 'SUCCESS') &&
          (!body?.transaction_id || normalizedTransactionId(body.transaction_id) === normalizedTransactionId(trade.settlement.transactionId))
        return {
          pass,
          detail: pass ? 'Mirror Node confirms the ClearingEscrow settlement result.'
            : 'Mirror Node did not confirm the expected ClearingEscrow settlement.',
        }
      })

      const audit = await capture(async () => {
        const envelope = await json(auditUrl)
        let message: any = null
        try {
          message = JSON.parse(Buffer.from(envelope?.message ?? '', 'base64').toString('utf8'))
        } catch {}
        const pass = String(envelope?.sequence_number) === String(trade.settlement.hcsSequenceNumber) &&
          message?.t === 'CLEARING_DECISION' && message?.tradeDigest?.toLowerCase() === trade.tradeDigest.toLowerCase()
        return {
          pass,
          detail: pass ? `HCS sequence ${trade.settlement.hcsSequenceNumber} commits the same trade digest.`
            : 'The anchored HCS message did not commit the expected trade digest.',
        }
      })

      const stages = [
        stage('graph_evidence', 'The Graph evidence', graphUrl, graph),
        stage('x402_payment', 'x402 payment', paymentUrl, payment),
        stage('ats_settlement', 'ATS settlement', settlementUrl, settlement),
        stage('hcs_audit', 'HCS audit', auditUrl, audit),
      ]
      const passed = stages.filter((item) => item.status === 'PASS').length
      const failed = stages.length - passed
      return {
        tradeDigest: trade.tradeDigest,
        verifiedAt: now().toISOString(),
        status: failed === 0 ? 'VERIFIED' : 'FAILED',
        stages,
        summary: { passed, failed, total: stages.length },
      }
    },
  }
}
