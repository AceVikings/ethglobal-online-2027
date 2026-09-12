import type { IncomingMessage } from 'node:http'
import type { Checks, ClearingTrade, Policy, Subject } from '@desk/signal'

export interface VerdictRequest {
  clientRequestId: string
  standard: 'messari/lending-v3.1'
  subject: Subject
  policy: Policy
  trade: ClearingTrade
}

export interface Evaluation {
  checks: Checks
  verdict: 'CONFORMANT' | 'NON_CONFORMANT' | 'STALE' | 'DISAGREEMENT'
  evidence: { queryHash: string; queryText: string; block: number }
}

/**
 * Implementations run inside the seller process. They may use Graph credentials,
 * but must return only the derived verdict material described here, never rows.
 */
export type VerdictEvaluator = (request: VerdictRequest) => Promise<Evaluation>

export interface PaymentAuthorization {
  ok: boolean
  paymentRef?: string
  status?: number
  headers?: Record<string, string>
  responseHeaders?: Record<string, string>
  publicMessage?: string
  /** Settle only after the protected handler has produced a successful result. */
  settle?: () => Promise<{ paymentRef: string; responseHeaders: Record<string, string> }>
}

/** Adapter boundary for @x402/core + ExactHederaScheme or another facilitator. */
export interface PaymentGate {
  authorize(request: IncomingMessage, body: VerdictRequest): Promise<PaymentAuthorization>
}

export interface PaymentGateModule {
  createPaymentGate(config: {
    facilitatorUrl: string
    network: string
    payTo: string
    price: string
  }): PaymentGate | Promise<PaymentGate>
}

export interface EvaluatorModule {
  createVerdictEvaluator(config: {
    graphApiKey: string
    graphGatewayUrl: string
    graphMcpUrl: string
  }): VerdictEvaluator | Promise<VerdictEvaluator>
}
