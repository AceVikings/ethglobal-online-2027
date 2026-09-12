import { verifyVerdict, type SignedVerdict } from '@desk/signal'

export interface CheckInput {
  standard: 'messari/lending-v3.1'
  subject: { protocol: string; network: string; deploymentId: string }
  policy: { pinnedCid: string | null; lagBoundBlocks: number }
}

export type PaymentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface PaymentClientModule {
  createPaymentFetch(config: { baseFetch: typeof fetch }): PaymentFetch | Promise<PaymentFetch>
}

export async function paymentFetchFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PaymentFetch> {
  if (!env.CONFORMANCE_PAYMENT_CLIENT_MODULE) return fetch
  const module = (await import(env.CONFORMANCE_PAYMENT_CLIENT_MODULE)) as PaymentClientModule
  if (typeof module.createPaymentFetch !== 'function') {
    throw new Error('payment client module must export createPaymentFetch(config)')
  }
  return module.createPaymentFetch({ baseFetch: fetch })
}

function looksSigned(value: unknown): value is SignedVerdict {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item.v === 1 && typeof item.signature === 'string' && typeof item.signer === 'string' &&
    typeof item.verdict === 'string' && typeof item.requestId === 'string'
}

export async function getVerdict(args: {
  serviceUrl: string
  input: CheckInput
  paymentFetch?: PaymentFetch
  expectedSigner?: string
}): Promise<{ verdict: SignedVerdict; paymentRef: string | null }> {
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
  const verified = verifyVerdict(value)
  if (!verified.ok) throw new Error('verdict signature is invalid')
  if (args.expectedSigner && verified.recovered.toLowerCase() !== args.expectedSigner.toLowerCase()) {
    throw new Error(`unexpected verdict signer ${verified.recovered}`)
  }
  return { verdict: value, paymentRef: response.headers.get('x-payment-ref') }
}
