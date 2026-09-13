import type { McpScope, ServiceTokenClaims } from './auth.ts'

type JsonRpcId = string | number | null
export interface JsonRpcRequest { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: unknown }
export type McpPrincipal = ServiceTokenClaims & { rawToken: string }
interface ToolDefinition {
  name: string; description: string; scope: McpScope; inputSchema: Record<string, unknown>
  request(args: Record<string, unknown>): { path: string; method?: string; body?: unknown }
}

const emptySchema = { type: 'object', additionalProperties: false, properties: {} }
const idProperty = { type: 'string', minLength: 1, maxLength: 160 }
const toolDefinitions: ToolDefinition[] = [
  { name: 'list_offerings', description: 'List the server-curated Hedera ATS offerings.', scope: 'offerings:read', inputSchema: emptySchema, request: () => ({ path: '/api/v1/offerings' }) },
  { name: 'list_vaults', description: "List only the authenticated owner's vaults.", scope: 'vaults:read', inputSchema: emptySchema, request: () => ({ path: '/api/v1/vaults' }) },
  {
    name: 'get_vault', description: 'Read one vault owned by the authenticated owner.', scope: 'vaults:read',
    inputSchema: { type: 'object', additionalProperties: false, required: ['vaultId'], properties: { vaultId: idProperty } },
    request: args => ({ path: `/api/v1/vaults/${encodeURIComponent(String(args.vaultId))}` }),
  },
  {
    name: 'create_vault_draft', description: 'Create a bounded vault draft; this does not sign or execute it.', scope: 'vaults:write',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['offeringId', 'units'],
      properties: {
        offeringId: idProperty, units: idProperty, name: { type: 'string', maxLength: 120 }, maxUnitPrice: idProperty,
        maxEvidenceFee: idProperty, maximumRuns: { type: 'integer', minimum: 1 },
        triggerMode: { type: 'string', enum: ['confirm_each_run', 'standing'] }, validFrom: { type: 'string' }, expiresAt: { type: 'string' },
        risk: { type: 'object', additionalProperties: false, properties: {
          maxUtilizationBps: { type: 'integer', minimum: 0, maximum: 10_000 }, maxLagBlocks: { type: 'integer', minimum: 0 }, minimumTvl: idProperty,
        } },
      },
    },
    request: args => ({ path: '/api/v1/vaults', method: 'POST', body: args }),
  },
  {
    name: 'request_run', description: 'Request a run. The backend returns approval_required unless exact approval already exists.', scope: 'runs:request',
    inputSchema: { type: 'object', additionalProperties: false, required: ['vaultId', 'requestId'], properties: { vaultId: idProperty, requestId: idProperty } },
    request: args => ({ path: `/api/v1/vaults/${encodeURIComponent(String(args.vaultId))}/run-requests`, method: 'POST', body: { requestId: args.requestId } }),
  },
  {
    name: 'get_run_status', description: 'Read a run owned by the authenticated owner.', scope: 'runs:read',
    inputSchema: { type: 'object', additionalProperties: false, required: ['runId'], properties: { runId: idProperty } },
    request: args => ({ path: `/api/v1/runs/${encodeURIComponent(String(args.runId))}` }),
  },
  {
    name: 'list_vault_history', description: 'List run history for one vault owned by the authenticated owner.', scope: 'runs:read',
    inputSchema: { type: 'object', additionalProperties: false, required: ['vaultId'], properties: { vaultId: idProperty } },
    request: args => ({ path: `/api/v1/vaults/${encodeURIComponent(String(args.vaultId))}/runs` }),
  },
  {
    name: 'verify_run_proof', description: 'Read the allowlisted proof projection for one run.', scope: 'proof:read',
    inputSchema: { type: 'object', additionalProperties: false, required: ['runId'], properties: { runId: idProperty } },
    request: args => ({ path: `/api/v1/runs/${encodeURIComponent(String(args.runId))}/proof` }),
  },
]

function rpc(id: JsonRpcId, result: unknown) { return { jsonrpc: '2.0', id, result } }
function rpcError(id: JsonRpcId, code: number, message: string) { return { jsonrpc: '2.0', id, error: { code, message } } }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }

function validateValue(schema: any, value: unknown, path: string): string | null {
  if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0)) return `${path} must be a non-empty string`
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is too long`
    if (schema.enum && !schema.enum.includes(value)) return `${path} is not allowed`
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) return `${path} must be an integer`
    if (schema.minimum !== undefined && Number(value) < schema.minimum) return `${path} is below its minimum`
    if (schema.maximum !== undefined && Number(value) > schema.maximum) return `${path} exceeds its maximum`
  }
  if (schema.type === 'object') {
    if (!record(value)) return `${path} must be an object`
    const allowed = new Set(Object.keys(schema.properties ?? {}))
    if (schema.additionalProperties === false && Object.keys(value).some(key => !allowed.has(key))) return `${path} contains an unknown field`
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} is required`
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        const invalid = validateValue(schema.properties[key], child, `${path}.${key}`)
        if (invalid) return invalid
      }
    }
  }
  return null
}

function validateArgs(schema: any, args: Record<string, unknown>): string | null { return validateValue(schema, args, 'arguments') }

export interface McpConfig { backendUrl: string; backendFetch?: typeof fetch }
export function createMcpHandler(config: McpConfig) {
  const request = config.backendFetch ?? fetch
  return async function handle(message: JsonRpcRequest, principal: McpPrincipal) {
    const id = message.id ?? null
    if (message.method === 'initialize') return rpc(id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'conformance-desk', version: '0.2.0' } })
    if (message.method === 'notifications/initialized') return null
    if (message.method === 'ping') return rpc(id, {})
    if (message.method === 'tools/list') return rpc(id, { tools: toolDefinitions.filter(tool => principal.scopes.includes(tool.scope)).map(({ scope: _scope, request: _request, ...tool }) => tool) })
    if (message.method !== 'tools/call') return rpcError(id, -32601, 'Method not found')
    const params = record(message.params) ? message.params : {}
    const tool = toolDefinitions.find(candidate => candidate.name === params.name)
    if (!tool || !record(params.arguments)) return rpcError(id, -32602, 'Invalid tool call')
    if (!principal.scopes.includes(tool.scope)) return rpcError(id, -32003, `Missing required scope: ${tool.scope}`)
    const invalid = validateArgs(tool.inputSchema, params.arguments)
    if (invalid) return rpcError(id, -32602, invalid)
    const target = tool.request(params.arguments)
    try {
      const response = await request(new URL(target.path, config.backendUrl), {
        method: target.method ?? 'GET',
        headers: { authorization: `Bearer ${principal.rawToken}`, accept: 'application/json', ...(target.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: target.body === undefined ? undefined : JSON.stringify(target.body),
      })
      if (!response.ok) throw new Error(`Backend request failed with HTTP ${response.status}`)
      const output: unknown = await response.json()
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }], structuredContent: output })
    } catch (error) {
      const detail = error instanceof Error ? error.message : ''
      const message = /^Backend request failed with HTTP \d{3}$/.test(detail) ? detail : 'Backend request failed'
      return rpc(id, { isError: true, content: [{ type: 'text', text: message }] })
    }
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig { return { backendUrl: env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020' } }
