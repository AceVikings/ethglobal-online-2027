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
import type { PublicTradeVerifier } from './verification.ts'
import type { LiveClearanceRunner, SignedLiveMandate } from './live-clearance.ts'
import { authenticatedSubject, bearerToken } from './auth.ts'
import { IdempotencyConflictError, type VaultRepository } from './repositories/types.ts'
import { parseCreateVault, parseVaultStatus } from './vaults.ts'
import { parseCreateRun } from './runs.ts'
import { hashVaultMandate, validateVaultMandate, verifyVaultMandateSignature } from '@desk/signal'

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
  tradeVerifier?: PublicTradeVerifier
  liveClearance?: LiveClearanceRunner
  verifyAccessToken?: (token: string) => Promise<{ userId: string }>
  corsAllowedOrigin?: string
  vaultRepository?: VaultRepository
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
  const allowedOrigins = new Set<string>()
  if (options.corsAllowedOrigin) {
    for (const configuredOrigin of options.corsAllowedOrigin.split(',').map((origin) => origin.trim())) {
      const parsed = new URL(configuredOrigin)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== configuredOrigin) {
        throw new Error('corsAllowedOrigin must contain exact HTTP(S) origins')
      }
      allowedOrigins.add(parsed.origin)
    }
  }

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
    const requestOrigin = request.headers.origin
    const allowedOrigin = requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : null
    if (allowedOrigin) {
      response.setHeader('access-control-allow-origin', allowedOrigin)
      response.setHeader('vary', 'Origin')
    }
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/') && allowedOrigin) {
      response.writeHead(204, {
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'Accept, Authorization, Content-Type',
        'access-control-max-age': '86400',
        vary: 'Origin',
      })
      response.end()
      return
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { ok: true, service: 'conformance-desk', version: 1 })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/trades') {
      send(response, 200, options.trades ? await options.trades.list() : { trades: [], nextCursor: null })
      return
    }
    if (url.pathname.startsWith('/api/v1/vaults') || url.pathname.startsWith('/api/v1/runs')) {
      const ownerId = await authenticatedSubject(request, options.verifyAccessToken)
      if (!ownerId) { send(response, 401, { error: 'authentication_required' }); return }
      if (!options.vaultRepository) { send(response, 503, { error: 'vaults_unavailable' }); return }
      const repository = options.vaultRepository
      try {
        if (request.method === 'GET' && url.pathname === '/api/v1/vaults') {
          send(response, 200, { vaults: await repository.listVaults(ownerId) }); return
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/vaults') {
          send(response, 201, await repository.createVault(ownerId, parseCreateVault(await readJson(request)))); return
        }
        const mandatePath = url.pathname.match(/^\/api\/v1\/vaults\/([^/]+)\/mandates$/)
        if (request.method === 'POST' && mandatePath) {
          const body = await readJson(request) as Record<string, unknown>
          const mandate = validateVaultMandate(body.mandate)
          if (mandate.vaultId !== decodeURIComponent(mandatePath[1])) throw new Error('mandate vaultId does not match route')
          const vault = await repository.getVault(ownerId, mandate.vaultId)
          if (!vault) { send(response, 404, { error: 'not_found' }); return }
          if (mandate.owner !== ownerId) throw new Error('mandate owner does not match session')
          if (mandate.receiver.toLowerCase() !== vault.receiver.toLowerCase()) throw new Error('mandate receiver does not match vault')
          const signature = String(body.signature ?? '')
          if (verifyVaultMandateSignature(mandate, signature).toLowerCase() !== mandate.receiver.toLowerCase()) throw new Error('mandate signature does not match receiver')
          await repository.saveMandate(ownerId, mandate.vaultId, mandate, signature)
          send(response, 201, { mandateHash: hashVaultMandate(mandate), version: mandate.mandateVersion }); return
        }
        const vaultRunsPath = url.pathname.match(/^\/api\/v1\/vaults\/([^/]+)\/runs$/)
        if (request.method === 'GET' && vaultRunsPath) {
          const vaultId = decodeURIComponent(vaultRunsPath[1]); if (!await repository.getVault(ownerId, vaultId)) { send(response, 404, { error: 'not_found' }); return }
          send(response, 200, { runs: await repository.listRuns(ownerId, vaultId) }); return
        }
        const vaultPath = url.pathname.match(/^\/api\/v1\/vaults\/([^/]+)$/)
        if (vaultPath && request.method === 'GET') {
          const vault = await repository.getVault(ownerId, decodeURIComponent(vaultPath[1])); send(response, vault ? 200 : 404, vault ?? { error: 'not_found' }); return
        }
        if (vaultPath && request.method === 'PATCH') {
          const vault = await repository.setVaultStatus(ownerId, decodeURIComponent(vaultPath[1]), parseVaultStatus(await readJson(request))); send(response, vault ? 200 : 404, vault ?? { error: 'not_found' }); return
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/runs') {
          const result = await repository.createRun(ownerId, parseCreateRun(await readJson(request)))
          send(response, 202, { runId: result.run.id, created: result.created, state: result.run.state }); return
        }
        const eventsPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/events$/)
        if (request.method === 'GET' && eventsPath) {
          const after = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
          const events = await repository.listEvents(ownerId, decodeURIComponent(eventsPath[1]), Number.isSafeInteger(after) ? after : 0)
          if (!events) { send(response, 404, { error: 'not_found' }); return }
          if ((request.headers.accept ?? '').includes('text/event-stream')) {
            response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
            for (const event of events) response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            response.end(); return
          }
          send(response, 200, { events }); return
        }
        const runPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)$/)
        if (request.method === 'GET' && runPath) {
          const run = await repository.getRun(ownerId, decodeURIComponent(runPath[1])); send(response, run ? 200 : 404, run ?? { error: 'not_found' }); return
        }
        send(response, 404, { error: 'not_found' }); return
      } catch (error) {
        if (error instanceof IdempotencyConflictError) { send(response, 409, { error: 'idempotency_conflict' }); return }
        if (error instanceof SyntaxError || /required|invalid|unknown field|does not match/.test(safeError(error))) { send(response, 400, { error: 'invalid_request', message: safeError(error) }); return }
        if (/not found/.test(safeError(error))) { send(response, 404, { error: 'not_found' }); return }
        console.error('vault API failed:', safeError(error)); send(response, 500, { error: 'internal_error' }); return
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/live-clearances') {
      if (!options.liveClearance || !options.verifyAccessToken) {
        send(response, 503, { error: 'live_clearance_unavailable' })
        return
      }
      const token = bearerToken(request)
      if (!token) {
        send(response, 401, { error: 'authentication_required' })
        return
      }
      let userId: string
      try {
        userId = (await options.verifyAccessToken(token)).userId
        if (!userId) throw new Error('missing Privy user')
      } catch {
        send(response, 401, { error: 'invalid_session' })
        return
      }
      let signed: SignedLiveMandate
      try {
        signed = await readJson(request) as SignedLiveMandate
      } catch (error) {
        send(response, 400, { error: 'invalid_request', message: safeError(error) })
        return
      }
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      try {
        const result = await options.liveClearance.run(userId, signed, async (stage) => {
          response.write(`${JSON.stringify({ type: 'stage', stage })}\n`)
        })
        response.end(`${JSON.stringify({ type: 'complete', result })}\n`)
      } catch {
        response.end(`${JSON.stringify({ type: 'error', message: 'Live clearance stopped. Review the final stage for details.' })}\n`)
      }
      return
    }
    const verificationPath = url.pathname.match(/^\/api\/v1\/trades\/([^/]+)\/verify$/)
    if (request.method === 'POST' && verificationPath) {
      const digest = decodeURIComponent(verificationPath[1])
      const trade = await options.trades?.get(digest)
      if (!trade) {
        send(response, 404, { error: 'trade_not_found' })
        return
      }
      if (!options.tradeVerifier) {
        send(response, 503, { error: 'verification_unavailable' })
        return
      }
      try {
        send(response, 200, await options.tradeVerifier.verify(trade))
      } catch (error) {
        console.error('public verification failed:', safeError(error))
        send(response, 502, { error: 'verification_unavailable' })
      }
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
