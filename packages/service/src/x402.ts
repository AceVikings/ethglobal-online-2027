import type { PaymentGate, PaymentGateModule } from './types.ts'

const REQUIRED = ['X402_PAYMENT_ADAPTER', 'X402_FACILITATOR_URL', 'X402_PAY_TO', 'X402_PRICE'] as const

/**
 * Loads a real payment adapter. There is intentionally no production bypass:
 * an absent or broken adapter makes /verdict unavailable, never free.
 */
export async function paymentGateFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PaymentGate> {
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length) throw new Error(`missing payment configuration: ${missing.join(', ')}`)

  const module = (await import(env.X402_PAYMENT_ADAPTER!)) as PaymentGateModule
  if (typeof module.createPaymentGate !== 'function') {
    throw new Error('x402 adapter must export createPaymentGate(config)')
  }

  return module.createPaymentGate({
    facilitatorUrl: env.X402_FACILITATOR_URL!,
    network: env.X402_NETWORK ?? 'hedera:testnet',
    payTo: env.X402_PAY_TO!,
    price: env.X402_PRICE!,
  })
}
