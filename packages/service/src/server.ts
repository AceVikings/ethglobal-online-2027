import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { Wallet, keccak256, toUtf8Bytes } from 'ethers'
import {
  canonicalJSON,
  clearingEvidenceHash,
  clearingPolicyHash,
  signClearingAuthorization,
  signVerdict,
  type ClearingAuthorization,
  type SignedClearingVerdict,
  type VerdictPayload,
} from '@desk/signal'
import { parseVerdictRequest } from './policy.ts'
import type { PaymentGate, VerdictEvaluator, VerdictRequest } from './types.ts'
import type { TradeReadModel } from './trades.ts'

const MAX_BODY_BYTES = 16 * 1024

export interface ServiceOptions {
  evaluator: VerdictEvaluator
  paymentGate: PaymentGate
  signingKey: string
  now?: () => Date
  requestId?: () => string
  nonce?: () => string
  authorizationTtlSeconds?: number
  trades?: TradeReadModel
}

interface CompletedResponse {
  fingerprint: string
  body: SignedClearingVerdict
  headers: Record<string, string>
}
type AttemptResult = CompletedResponse | { payment: Awaited<ReturnType<PaymentGate['authorize']>> }

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (size === 0) throw new Error('request body is required')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

export function createVerdictServer(options: ServiceOptions) {
  const wallet = new Wallet(options.signingKey)
  const now = options.now ?? (() => new Date())
  const requestId = options.requestId ?? randomUUID
  const nonce = options.nonce ?? (() => `0x${randomBytes(32).toString('hex')}`)
  const authorizationTtlSeconds = options.authorizationTtlSeconds ?? 300
  if (!Number.isSafeInteger(authorizationTtlSeconds) || authorizationTtlSeconds < 1) {
    throw new Error('authorizationTtlSeconds must be a positive integer')
  }
  const completed = new Map<string, CompletedResponse>()
  const inFlight = new Map<string, Promise<AttemptResult>>()

  async function produce(request: IncomingMessage, input: VerdictRequest, fingerprint: string): Promise<AttemptResult> {
    const expectedPolicyHash = clearingPolicyHash(input.standard, input.policy)
    if (input.trade.policyHash.toLowerCase() !== expectedPolicyHash.toLowerCase()) {
      throw new Error('trade.policyHash does not commit to the requested policy')
    }
    const issuedAt = Math.floor(now().getTime() / 1000)
    const holdExpiry = Number(input.trade.holdExpiry)
    if (!Number.isSafeInteger(holdExpiry) || holdExpiry <= issuedAt + 1) {
      throw new Error('trade hold expires before an authorization can be issued')
    }

    const payment = await options.paymentGate.authorize(request, input)
    if (!payment.ok) return { payment }

    const evaluation = await options.evaluator(input)
    const settlement = payment.settle ? await payment.settle() : undefined
    const paymentTxId = settlement?.paymentRef ?? payment.paymentRef
    if (!paymentTxId) throw new Error('x402 settlement returned no payment reference')
    const payload: VerdictPayload = {
      v: 1,
      requestId: requestId(),
      issuedAt: new Date(issuedAt * 1000).toISOString(),
      standard: input.standard,
      subject: input.subject,
      policy: input.policy,
      checks: evaluation.checks,
      verdict: evaluation.verdict,
      evidence: evaluation.evidence,
      signer: wallet.address,
    }
    const signed = signVerdict(payload, options.signingKey)
    const authorization: ClearingAuthorization = {
      ...input.trade,
      action: evaluation.verdict === 'CONFORMANT' ? 1 : 2,
      evidenceHash: clearingEvidenceHash({
        standard: payload.standard,
        subject: payload.subject,
        policy: payload.policy,
        checks: payload.checks,
        verdict: payload.verdict,
        evidence: payload.evidence,
      }),
      paymentRef: keccak256(toUtf8Bytes(paymentTxId)),
      issuedAt: String(issuedAt),
      authorizationExpiry: String(Math.min(issuedAt + authorizationTtlSeconds, holdExpiry - 1)),
      nonce: nonce(),
    }
    const body: SignedClearingVerdict = {
      ...signed,
      authorization,
      authorizationSignature: signClearingAuthorization(authorization, options.signingKey),
    }
    const headers = {
      ...(payment.responseHeaders ?? {}),
      ...(settlement?.responseHeaders ?? {}),
      'x-payment-ref': paymentTxId,
    }
    const result = { fingerprint, body, headers }
    completed.set(input.clientRequestId, result)
    return result
  }

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { ok: true, service: 'conformance-desk', version: 1 })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/trades') {
      send(response, 200, options.trades ? await options.trades.list() : { trades: [], nextCursor: null })
      return
    }
    const tradePath = url.pathname.match(/^\/api\/v1\/trades\/([^/]+)(\/events)?$/)
    if (request.method === 'GET' && tradePath) {
      const digest = decodeURIComponent(tradePath[1])
      const body = tradePath[2] ? await options.trades?.events(digest) : await options.trades?.get(digest)
      if (body) send(response, 200, body)
      else send(response, 404, { error: 'trade_not_found' })
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/verdict') {
      send(response, 404, { error: 'not_found' })
      return
    }

    let input: VerdictRequest
    try {
      input = parseVerdictRequest(await readJson(request))
    } catch (error) {
      send(response, 400, { error: 'invalid_request', message: safeError(error) })
      return
    }

    try {
      const fingerprint = canonicalJSON(input)
      const cached = completed.get(input.clientRequestId)
      if (cached) {
        if (cached.fingerprint !== fingerprint) {
          send(response, 409, { error: 'idempotency_conflict' })
          return
        }
        send(response, 200, cached.body, cached.headers)
        return
      }
      const existing = inFlight.get(input.clientRequestId)
      if (existing) {
        const result = await existing
        if ('fingerprint' in result && result.fingerprint !== fingerprint) {
          send(response, 409, { error: 'idempotency_conflict' })
          return
        }
        if ('body' in result) send(response, 200, result.body, result.headers)
        else send(response, result.payment.status ?? 402, {
          error: 'payment_required', message: result.payment.publicMessage ?? 'x402 payment required',
        }, result.payment.headers)
        return
      }

      const operation = produce(request, input, fingerprint)
      inFlight.set(input.clientRequestId, operation)
      let result: AttemptResult
      try {
        result = await operation
      } finally {
        inFlight.delete(input.clientRequestId)
      }
      if ('payment' in result) {
        const payment = result.payment
        send(
          response,
          payment.status ?? 402,
          { error: 'payment_required', message: payment.publicMessage ?? 'x402 payment required' },
          payment.headers,
        )
        return
      }
      send(response, 200, result.body, result.headers)
    } catch (error) {
      // Do not leak provider responses, credentials, stack traces, or raw Graph rows.
      console.error('verdict request failed:', safeError(error))
      send(response, 502, { error: 'verdict_unavailable' })
    }
  })
}
