import { getVerdict, paymentFetchFromEnv } from '@desk/cli/client'
import type { ClearingTrade } from '@desk/signal'

type JsonRpcId = string | number | null
interface JsonRpcRequest { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: unknown }

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId', 'protocol', 'network', 'deploymentId', 'trade'],
  properties: {
    clientRequestId: { type: 'string', description: 'Stable idempotency key for this paid trade decision' },
    protocol: { type: 'string', description: 'Protocol slug, for example aave-v3' },
    network: { type: 'string', description: 'Network slug, for example base' },
    deploymentId: { type: 'string', description: 'Pinned Graph deployment ID' },
    pinnedCid: { type: ['string', 'null'], description: 'Caller policy CID; null accepts the served CID' },
    lagBoundBlocks: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 50 },
    trade: {
      type: 'object',
      additionalProperties: false,
      required: ['chainId', 'verifyingContract', 'security', 'partition', 'seller', 'buyer', 'amount', 'holdId', 'holdExpiry', 'policyHash'],
      properties: {
        chainId: { type: 'string' },
        verifyingContract: { type: 'string' },
        security: { type: 'string' },
        partition: { type: 'string' },
        seller: { type: 'string' },
        buyer: { type: 'string' },
        amount: { type: 'string' },
        holdId: { type: 'string' },
        holdExpiry: { type: 'string' },
        policyHash: { type: 'string' },
      },
    },
  },
} as const

function rpc(id: JsonRpcId, result: unknown) { return { jsonrpc: '2.0', id, result } }
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export interface McpConfig {
  serviceUrl: string
  expectedSigner: string
  paymentFetch?: typeof fetch
}

export function createMcpHandler(config: McpConfig) {
  return async function handle(message: JsonRpcRequest) {
    const id = message.id ?? null
    if (message.method === 'initialize') {
      return rpc(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'conformance-desk', version: '0.1.0' },
      })
    }
    if (message.method === 'notifications/initialized') return null
    if (message.method === 'ping') return rpc(id, {})
    if (message.method === 'tools/list') {
      return rpc(id, { tools: [{
        name: 'get_conformance_verdict',
        description: 'Buy and verify a signed, derived Messari Lending v3.1 conformance verdict. Returns no raw Graph rows.',
        inputSchema,
      }] })
    }
    if (message.method !== 'tools/call') return rpcError(id, -32601, 'Method not found')

    const params = record(message.params) ? message.params : {}
    if (params.name !== 'get_conformance_verdict' || !record(params.arguments)) {
      return rpcError(id, -32602, 'Invalid tool call')
    }
    const args = params.arguments
    if (
      typeof args.clientRequestId !== 'string' || typeof args.protocol !== 'string' ||
      typeof args.network !== 'string' || typeof args.deploymentId !== 'string' || !record(args.trade)
    ) {
      return rpcError(id, -32602, 'clientRequestId, protocol, network, deploymentId, and trade are required')
    }
    const lag = args.lagBoundBlocks ?? 50
    if (!Number.isSafeInteger(lag) || Number(lag) < 0 || Number(lag) > 1_000_000) {
      return rpcError(id, -32602, 'lagBoundBlocks must be an integer from 0 to 1000000')
    }
    if (args.pinnedCid !== undefined && args.pinnedCid !== null && typeof args.pinnedCid !== 'string') {
      return rpcError(id, -32602, 'pinnedCid must be a string or null')
    }

    try {
      const result = await getVerdict({
        serviceUrl: config.serviceUrl,
        expectedSigner: config.expectedSigner,
        paymentFetch: config.paymentFetch,
        input: {
          clientRequestId: args.clientRequestId,
          standard: 'messari/lending-v3.1',
          subject: { protocol: args.protocol, network: args.network, deploymentId: args.deploymentId },
          policy: { pinnedCid: (args.pinnedCid as string | null | undefined) ?? null, lagBoundBlocks: Number(lag) },
          trade: args.trade as unknown as ClearingTrade,
        },
      })
      const output = { ...result.verdict, paymentRef: result.paymentRef }
      return rpc(id, {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'verdict unavailable'
      return rpc(id, { isError: true, content: [{ type: 'text', text: message }] })
    }
  }
}

export async function configFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<McpConfig> {
  if (!env.CONFORMANCE_EXPECTED_SIGNER) throw new Error('CONFORMANCE_EXPECTED_SIGNER is required')
  return {
    serviceUrl: env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020',
    expectedSigner: env.CONFORMANCE_EXPECTED_SIGNER,
    paymentFetch: await paymentFetchFromEnv(env) as typeof fetch,
  }
}
