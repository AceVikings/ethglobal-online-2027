import type { IncomingMessage } from 'node:http'
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from '@x402/core/server'
import type { HTTPAdapter, HTTPRequestContext } from '@x402/core/server'
import type { Network } from '@x402/core/types'
import { HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS, isValidHederaEntityId } from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import type { PaymentGate, PaymentGateModule, VerdictRequest } from '../types.ts'

const SUPPORTED_NETWORK = 'hedera:testnet'

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function requestAdapter(request: IncomingMessage, body: VerdictRequest): HTTPAdapter {
  return {
    getHeader: (name) => header(request, name),
    getMethod: () => request.method ?? 'POST',
    getPath: () => '/verdict',
    // A fixed identifier prevents an attacker-controlled Host header entering signed requirements.
    getUrl: () => 'urn:conformance-desk:verdict',
    getAcceptHeader: () => header(request, 'accept') ?? 'application/json',
    getUserAgent: () => header(request, 'user-agent') ?? '',
    getBody: () => body,
  }
}

export const createPaymentGate: PaymentGateModule['createPaymentGate'] = function createPaymentGate(config): PaymentGate {
  if (config.network !== SUPPORTED_NETWORK) {
    throw new Error(`only ${SUPPORTED_NETWORK} is supported by this Blocky402 adapter`)
  }
  if (!isValidHederaEntityId(config.payTo)) throw new Error('x402 payTo must be a Hedera account ID')
  if (!/^https:\/\//.test(config.facilitatorUrl)) throw new Error('x402 facilitator URL must use HTTPS')
  if (!config.price.trim()) throw new Error('x402 price is required')

  const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl, timeoutMs: 15_000 })
  const resource = new x402ResourceServer(facilitator).register(
    SUPPORTED_NETWORK as Network,
    new ExactHederaScheme({
      defaultAssets: {
        [SUPPORTED_NETWORK]: { asset: HEDERA_TESTNET_USDC, decimals: HEDERA_USDC_DECIMALS },
      },
    }),
  )
  const http = new x402HTTPResourceServer(resource, {
    'POST /verdict': {
      accepts: {
        scheme: 'exact',
        network: SUPPORTED_NETWORK as Network,
        payTo: config.payTo,
        price: config.price,
      },
      resource: 'urn:conformance-desk:verdict',
      description: 'Signed Messari Lending v3.1 conformance verdict',
      mimeType: 'application/json',
    },
  })

  let initialized: Promise<void> | undefined
  const ensureInitialized = async () => {
    initialized ??= http.initialize().catch((error) => {
      initialized = undefined
      throw error
    })
    await initialized
  }

  return {
    async authorize(request, body) {
      await ensureInitialized()
      const adapter = requestAdapter(request, body)
      const context: HTTPRequestContext = {
        adapter,
        path: '/verdict',
        method: 'POST',
        paymentHeader: header(request, 'payment-signature') ?? header(request, 'x-payment'),
      }
      const result = await http.processHTTPRequest(context)
      if (result.type === 'payment-error') {
        return {
          ok: false,
          status: result.response.status,
          headers: result.response.headers,
          publicMessage: 'x402 payment required or invalid',
        }
      }
      // A protected route returning this state is a configuration failure, never free access.
      if (result.type !== 'payment-verified') throw new Error('x402 route was not payment protected')

      let settled = false
      return {
        ok: true,
        async settle() {
          if (settled) throw new Error('x402 payment settlement already attempted')
          settled = true
          const outcome = await http.processSettlement(
            result.paymentPayload,
            result.paymentRequirements,
            result.declaredExtensions,
            { request: context },
            undefined,
            result.beforeHandlerSettlement,
          )
          if (!outcome.success) throw new Error('x402 payment settlement failed')
          if (!outcome.transaction) throw new Error('x402 facilitator returned no settlement transaction')
          return { paymentRef: outcome.transaction, responseHeaders: outcome.headers }
        },
      }
    },
  }
}
