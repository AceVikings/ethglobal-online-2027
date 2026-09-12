import {
  GraphGatewayClient,
  LENDING_DEPLOYMENTS,
  LENDING_MARKETS_QUERY,
  REQUIRED_MARKET_FIELDS,
  SubgraphMcpClient,
  checkConformance,
  graphQueryHash,
  requireDeployment,
  type Checks,
  type LendingMarketSnapshot,
  type Policy,
  type SchemaShape,
  type Subject,
  type Verdict,
} from '@desk/signal'

export interface VerdictRequest {
  standard: 'messari/lending-v3.1'
  subject: Subject
  policy: Policy
}

/** Structurally compatible with packages/service/src/types.ts. */
export interface Evaluation {
  checks: Checks
  verdict: Verdict
  evidence: { queryHash: string; queryText: string; block: number }
}

interface GraphSnapshot {
  _meta: {
    deployment: string
    hasIndexingErrors: boolean
    block: { number: number; timestamp?: number | null }
  }
  markets: LendingMarketSnapshot[]
}

export interface GatewayReader {
  readEntities(
    deploymentId: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphSnapshot>
}

export interface McpReader {
  searchSubgraphsByKeyword(keyword: string): Promise<unknown>
  getDeployment30DayQueryCounts(ipfsHashes: readonly string[]): Promise<unknown>
  getSchemaByIpfsHash(ipfsHash: string): Promise<unknown>
}

export interface VerdictEvaluatorConfig {
  graphApiKey: string
  graphGatewayUrl: string
  graphMcpUrl: string
  /** Test seams; production callers leave these unset. */
  gatewayClient?: GatewayReader
  mcpClient?: McpReader
  headBlockProvider?: (network: string) => Promise<number>
}

export type VerdictEvaluator = (request: VerdictRequest) => Promise<Evaluation>

const RPC_URLS: Readonly<Record<string, string>> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
}

function normalizeGatewayUrl(url: string): string {
  return url.replace(/\/subgraphs\/id\/?$/, '/deployments/id')
}

async function rpcHeadBlock(network: string): Promise<number> {
  const url = RPC_URLS[network]
  if (!url) throw new Error(`No head-block RPC configured for ${network}`)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  })
  if (!response.ok) throw new Error(`Head-block RPC returned HTTP ${response.status} for ${network}`)
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
  if (typeof body.result !== 'string' || !/^0x[0-9a-f]+$/i.test(body.result)) {
    throw new Error(body.error?.message ?? `Head-block RPC returned an invalid result for ${network}`)
  }
  const block = Number.parseInt(body.result, 16)
  if (!Number.isSafeInteger(block)) throw new Error(`Head block is outside the safe integer range for ${network}`)
  return block
}

function schemaText(value: unknown): string {
  if (typeof value === 'string' && /\btype\s+Market\b/.test(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = schemaText(item)
      if (found) return found
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = schemaText(item)
      if (found) return found
    }
  }
  return ''
}

/** Extract the Market entity field set from MCP's GraphQL SDL response. */
export function marketFieldsFromSchema(value: unknown): string[] {
  const text = schemaText(value)
  const body = /\btype\s+Market\b[^\{]*\{([\s\S]*?)\}/m.exec(text)?.[1]
  if (!body) throw new Error('Subgraph MCP response did not contain a Market schema')
  const fields = body
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .map((line) => /^([_A-Za-z][_0-9A-Za-z]*)\s*(?:\([^)]*\))?\s*:/.exec(line)?.[1])
    .filter((field): field is string => Boolean(field))
  if (fields.length === 0) throw new Error('Market schema did not contain fields')
  return [...new Set(fields)].sort()
}

function validateSnapshot(value: GraphSnapshot, expectedDeploymentId: string): GraphSnapshot {
  const meta = value?._meta
  if (!meta || typeof meta.deployment !== 'string' || !Array.isArray(value.markets)) {
    throw new Error(`Graph response was malformed for ${expectedDeploymentId}`)
  }
  if (!Number.isSafeInteger(meta.block?.number) || meta.block.number < 0) {
    throw new Error(`Graph block was invalid for ${expectedDeploymentId}`)
  }
  if (meta.deployment !== expectedDeploymentId) {
    throw new Error(`Graph served deployment ${meta.deployment} instead of ${expectedDeploymentId}`)
  }
  return value
}

function assertRequest(request: VerdictRequest): void {
  if (request.standard !== 'messari/lending-v3.1') throw new Error(`Unsupported standard: ${request.standard}`)
  const catalog = requireDeployment(request.subject.protocol, request.subject.network)
  if (request.subject.deploymentId !== catalog.deploymentId) {
    throw new Error(
      `Subject deployment does not match catalog entry for ${request.subject.protocol} on ${request.subject.network}`,
    )
  }
}

/**
 * Creates the credential-holding seller evaluator. Raw Graph rows never cross
 * this boundary: only five derived checks and reproducibility metadata return.
 */
export function createVerdictEvaluator(config: VerdictEvaluatorConfig): VerdictEvaluator {
  if (!config.graphApiKey) throw new Error('graphApiKey is required')
  const gateway = config.gatewayClient ?? (new GraphGatewayClient({
    apiKey: config.graphApiKey,
    gatewayUrl: normalizeGatewayUrl(config.graphGatewayUrl),
  }) as unknown as GatewayReader)
  const mcp = config.mcpClient ?? (new SubgraphMcpClient({
    apiKey: config.graphApiKey,
    endpoint: config.graphMcpUrl,
  }) as unknown as McpReader)
  const headBlock = config.headBlockProvider ?? rpcHeadBlock
  const previousTimestamps = new Map<string, number>()

  return async (request) => {
    assertRequest(request)
    const ids = LENDING_DEPLOYMENTS.map((deployment) => deployment.deploymentId)

    const [snapshots, schemas, currentHead] = await Promise.all([
      Promise.all(
        LENDING_DEPLOYMENTS.map(async (deployment) => {
          const snapshot = await gateway.readEntities(
            deployment.deploymentId,
            LENDING_MARKETS_QUERY,
            { first: 5 },
          )
          return [deployment.deploymentId, validateSnapshot(snapshot, deployment.deploymentId)] as const
        }),
      ),
      Promise.all(
        LENDING_DEPLOYMENTS.map(async (deployment): Promise<SchemaShape> => ({
          deploymentId: deployment.deploymentId,
          fields: marketFieldsFromSchema(await mcp.getSchemaByIpfsHash(deployment.deploymentId)),
        })),
      ),
      headBlock(request.subject.network),
      // Discovery and volume provenance are deliberately exercised but never
      // exposed: the seller returns assertions, not Gateway/MCP response data.
      mcp.searchSubgraphsByKeyword(request.subject.protocol),
      mcp.getDeployment30DayQueryCounts(ids),
    ])

    const byId = new Map(snapshots)
    const target = byId.get(request.subject.deploymentId)
    if (!target) throw new Error(`No Graph snapshot for ${request.subject.deploymentId}`)
    const targetSchema = schemas.find((schema) => schema.deploymentId === request.subject.deploymentId)
    if (!targetSchema) throw new Error(`No schema for ${request.subject.deploymentId}`)
    const orderedSchemas = [targetSchema, ...schemas.filter((schema) => schema !== targetSchema)]
    const timestamp = target._meta.block.timestamp
    const previousTimestamp = previousTimestamps.get(request.subject.deploymentId)

    const result = checkConformance({
      policy: request.policy,
      servedCid: target._meta.deployment,
      hasIndexingErrors: target._meta.hasIndexingErrors,
      indexedBlock: target._meta.block.number,
      headBlock: currentHead,
      schemas: orderedSchemas,
      requiredSchemaFields: REQUIRED_MARKET_FIELDS,
      markets: target.markets,
      indexedTimestamp: timestamp,
      previousIndexedTimestamp: previousTimestamp,
    })
    if (typeof timestamp === 'number' && (previousTimestamp === undefined || timestamp >= previousTimestamp)) {
      previousTimestamps.set(request.subject.deploymentId, timestamp)
    }

    return {
      checks: result.checks,
      verdict: result.verdict,
      evidence: {
        queryHash: graphQueryHash(LENDING_MARKETS_QUERY),
        queryText: LENDING_MARKETS_QUERY,
        block: target._meta.block.number,
      },
    }
  }
}
