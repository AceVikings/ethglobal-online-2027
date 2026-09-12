import { x402Client } from '@x402/core/client'
import type { Network, PaymentRequirements } from '@x402/core/types'
import { wrapFetchWithPayment } from '@x402/fetch'
import {
  createClientHederaSigner,
  HEDERA_TESTNET_USDC,
  isValidHederaEntityId,
  PrivateKey,
} from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import type { PaymentFetch } from '../client.ts'

const NETWORK = 'hedera:testnet'
const BLOCKY_FEE_PAYER = '0.0.7162784'

interface AdapterConfig {
  baseFetch: typeof fetch
  env?: NodeJS.ProcessEnv
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value) throw new Error(`${key} is required for Hedera x402 payments`)
  return value
}

function trustedRequirement(expectedPayTo: string, requirement: PaymentRequirements): boolean {
  return requirement.scheme === 'exact' &&
    requirement.network === NETWORK &&
    requirement.payTo === expectedPayTo &&
    requirement.asset === HEDERA_TESTNET_USDC &&
    requirement.extra?.feePayer === BLOCKY_FEE_PAYER
}

/** Concrete x402 v2 buyer. Credentials remain in the consumer process only. */
export function createPaymentFetch(config: AdapterConfig): PaymentFetch {
  const env = config.env ?? process.env
  const accountId = required(env, 'HEDERA_OPERATOR_ID')
  const privateKeyText = required(env, 'HEDERA_OPERATOR_KEY')
  const expectedPayTo = required(env, 'X402_PAY_TO')
  if (!isValidHederaEntityId(accountId)) throw new Error('HEDERA_OPERATOR_ID must be a Hedera account ID')
  if (!isValidHederaEntityId(expectedPayTo)) throw new Error('X402_PAY_TO must be a Hedera account ID')
  if (env.X402_NETWORK && env.X402_NETWORK !== NETWORK) throw new Error(`only ${NETWORK} is supported`)

  // Requiring ECDSA prevents constructing a payer with an incompatible ED25519 key.
  const privateKey = PrivateKey.fromStringECDSA(privateKeyText)
  const signer = createClientHederaSigner(accountId, privateKey, { network: NETWORK })
  const client = x402Client.fromConfig({
    schemes: [{ network: NETWORK as Network, client: new ExactHederaScheme(signer) }],
    spendControls: { maxAmountPerPayment: env.X402_MAX_PRICE ?? '$1' },
    policies: [(_version, requirements) =>
      requirements.filter((requirement) => trustedRequirement(expectedPayTo, requirement))],
  })
  return wrapFetchWithPayment(config.baseFetch, client)
}
