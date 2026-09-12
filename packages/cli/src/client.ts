import {
  clearingEvidenceHash,
  verifyClearingAuthorization,
  verifyVerdict,
  type ClearingTrade,
  type SignedClearingVerdict,
} from '@desk/signal'
import { keccak256, toUtf8Bytes } from 'ethers'

export interface CheckInput {
  clientRequestId: string
  standard: 'messari/lending-v3.1'
  subject: { protocol: string; network: string; deploymentId: string }
  policy: { pinnedCid: string | null; lagBoundBlocks: number }
  trade: ClearingTrade
}

export type PaymentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface PaymentClientModule {
  createPaymentFetch(config: { baseFetch: typeof fetch; env?: NodeJS.ProcessEnv }): PaymentFetch | Promise<PaymentFetch>
}

export async function paymentFetchFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PaymentFetch> {
  const module = (env.CONFORMANCE_PAYMENT_CLIENT_MODULE
    ? await import(env.CONFORMANCE_PAYMENT_CLIENT_MODULE)
    : await import('./adapters/x402-hedera.ts')) as PaymentClientModule
  if (typeof module.createPaymentFetch !== 'function') {
    throw new Error('payment client module must export createPaymentFetch(config)')
  }
  return module.createPaymentFetch({ baseFetch: fetch, env })
}

function looksSigned(value: unknown): value is SignedClearingVerdict {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.v === 1 && typeof item.signature === 'string' && typeof item.signer === 'string' &&
    typeof item.verdict === 'string' && typeof item.requestId === 'string' &&
    typeof item.authorizationSignature === 'string' && !!item.authorization &&
    typeof item.authorization === 'object' && !Array.isArray(item.authorization)
}

const TRADE_FIELDS: readonly (keyof ClearingTrade)[] = [
  'chainId', 'verifyingContract', 'security', 'partition', 'seller', 'buyer',
  'amount', 'holdId', 'holdExpiry', 'policyHash',
]

function comparable(value: string): string {
  return value.startsWith('0x') ? value.toLowerCase() : BigInt(value).toString()
}

function verifyBoundResponse(
  value: SignedClearingVerdict,
  input: CheckInput,
  paymentRef: string,
  expectedSigner: string,
): void {
  const verdictSignature = verifyVerdict(value)
  if (!verdictSignature.ok || verdictSignature.recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
    throw new Error(`unexpected verdict signer ${verdictSignature.recovered}`)
  }
  const authorizationSignature = verifyClearingAuthorization(
    value.authorization,
    value.authorizationSignature,
    expectedSigner,
  )
  if (!authorizationSignature.ok) {
    throw new Error(`unexpected clearing authorization signer ${authorizationSignature.recovered}`)
  }
  for (const field of TRADE_FIELDS) {
    if (comparable(value.authorization[field]) !== comparable(input.trade[field])) {
      throw new Error(`clearing authorization ${field} does not match requested trade`)
    }
  }
  const expectedAction = value.verdict === 'CONFORMANT' ? 1 : 2
  if (value.authorization.action !== expectedAction) {
    throw new Error('clearing authorization action does not match deterministic verdict')
  }
  const evidenceHash = clearingEvidenceHash({
    standard: value.standard,
    subject: value.subject,
    policy: value.policy,
    checks: value.checks,
    verdict: value.verdict,
    evidence: value.evidence,
  })
  if (value.authorization.evidenceHash.toLowerCase() !== evidenceHash.toLowerCase()) {
    throw new Error('clearing authorization evidence does not match signed verdict')
  }
  if (value.authorization.paymentRef.toLowerCase() !== keccak256(toUtf8Bytes(paymentRef)).toLowerCase()) {
    throw new Error('clearing authorization paymentRef does not match settled x402 payment')
  }
}

export async function getVerdict(args: {
  serviceUrl: string
  input: CheckInput
  paymentFetch?: PaymentFetch
  expectedSigner: string
}): Promise<{ verdict: SignedClearingVerdict; paymentRef: string }> {
  const request = args.paymentFetch ?? fetch
  const response = await request(new URL('/verdict', args.serviceUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(args.input),
  })

  if (response.status === 402) throw new Error('payment required; configure CONFORMANCE_PAYMENT_CLIENT_MODULE')
  if (!response.ok) throw new Error(`verdict service returned HTTP ${response.status}`)

  const value: unknown = await response.json()
  if (!looksSigned(value)) throw new Error('verdict service returned an invalid payload')
  const paymentRef = response.headers.get('x-payment-ref')
  if (!paymentRef) throw new Error('verdict response omitted x402 payment reference')
  verifyBoundResponse(value, args.input, paymentRef, args.expectedSigner)
  return { verdict: value, paymentRef }
}
