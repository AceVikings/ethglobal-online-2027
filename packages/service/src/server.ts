import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Wallet } from 'ethers'
import { signVerdict, type SignedVerdict, type VerdictPayload } from '@desk/signal'
import { parseVerdictRequest } from './policy.ts'
import type { PaymentGate, VerdictEvaluator, VerdictRequest } from './types.ts'

const MAX_BODY_BYTES = 16 * 1024

export interface ServiceOptions {
  evaluator: VerdictEvaluator
  paymentGate: PaymentGate
  signingKey: string
  now?: () => Date
  requestId?: () => string
}

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

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { ok: true, service: 'conformance-desk', version: 1 })
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
      const authorization = await options.paymentGate.authorize(request, input)
      if (!authorization.ok) {
        send(
          response,
          authorization.status ?? 402,
          { error: 'payment_required', message: authorization.publicMessage ?? 'x402 payment required' },
          authorization.headers,
        )
        return
      }

      const evaluation = await options.evaluator(input)
      const payload: VerdictPayload = {
        v: 1,
        requestId: requestId(),
        issuedAt: now().toISOString(),
        standard: input.standard,
        subject: input.subject,
        policy: input.policy,
        checks: evaluation.checks,
        verdict: evaluation.verdict,
        evidence: evaluation.evidence,
        signer: wallet.address,
      }
      const signed: SignedVerdict = signVerdict(payload, options.signingKey)
      const settlement = authorization.settle ? await authorization.settle() : undefined
      send(response, 200, signed, {
        ...(authorization.responseHeaders ?? {}),
        ...(settlement?.responseHeaders ?? {}),
        ...((settlement?.paymentRef ?? authorization.paymentRef)
          ? { 'x-payment-ref': settlement?.paymentRef ?? authorization.paymentRef! }
          : {}),
      })
    } catch (error) {
      // Do not leak provider responses, credentials, stack traces, or raw Graph rows.
      console.error('verdict request failed:', safeError(error))
      send(response, 502, { error: 'verdict_unavailable' })
    }
  })
}
