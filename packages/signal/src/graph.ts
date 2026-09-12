import { keccak256, toUtf8Bytes } from 'ethers'

export const DEFAULT_GATEWAY_URL = 'https://gateway.thegraph.com/api/deployments/id'

export interface GraphMeta {
  deployment: string
  hasIndexingErrors: boolean
  block: { number: number; timestamp?: number | null }
}

export interface GraphResponse<T> {
  data?: T
  errors?: Array<{ message: string; path?: Array<string | number> }>
}

export type GraphEvidenceErrorCode =
  | 'INVALID_DEPLOYMENT'
  | 'DEPLOYMENT_MISMATCH'
  | 'INDEXING_ERROR'
  | 'STALE'
  | 'SCHEMA_DRIFT'
  | 'INVARIANT_FAILURE'
  | 'MALFORMED_RESPONSE'

export interface DeploymentInspectionTarget {
  deploymentId: string
  requiredMarketFields: readonly string[]
}

export interface DeploymentHealthResult {
  deploymentId: string
  status: 'healthy'
  block: number
  timestamp: number
  ageSeconds: number
  schemaFieldsChecked: number
}

export interface GraphClientOptions {
  apiKey: string
  gatewayUrl?: string
  timeoutMs?: number
  retries?: number
  fetch?: typeof globalThis.fetch
}

export class GraphGatewayError extends Error {
  readonly status?: number
  readonly errors?: GraphResponse<unknown>['errors']

  constructor(message: string, status?: number, errors?: GraphResponse<unknown>['errors']) {
    super(message)
    this.name = 'GraphGatewayError'
    this.status = status
    this.errors = errors
  }
}

export class GraphEvidenceError extends GraphGatewayError {
  readonly code: GraphEvidenceErrorCode

  constructor(code: GraphEvidenceErrorCode, message: string, status?: number, errors?: GraphResponse<unknown>['errors']) {
    super(message, status, errors)
    this.name = 'GraphEvidenceError'
    this.code = code
  }
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof GraphGatewayError && (error.status === 429 || (error.status ?? 0) >= 500))
  )
}

export class GraphGatewayClient {
  readonly #apiKey: string
  readonly #gatewayUrl: string
  readonly #timeoutMs: number
  readonly #retries: number
  readonly #fetch: typeof globalThis.fetch

  constructor(options: GraphClientOptions) {
    if (!options.apiKey) throw new Error('A Graph Gateway API key is required')
    this.#apiKey = options.apiKey
    this.#gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '')
    this.#timeoutMs = options.timeoutMs ?? 10_000
    this.#retries = options.retries ?? 1
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async query<T>(deploymentId: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!deploymentId) throw new Error('deploymentId is required')

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#queryOnce<T>(deploymentId, query, variables)
      } catch (error) {
        if (attempt >= this.#retries || !isRetryable(error)) throw error
      }
    }
  }

  async #queryOnce<T>(deploymentId: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      const response = await this.#fetch(`${this.#gatewayUrl}/${encodeURIComponent(deploymentId)}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })

      let body: GraphResponse<T>
      try {
        body = (await response.json()) as GraphResponse<T>
      } catch {
        throw new GraphGatewayError(`Graph Gateway returned non-JSON HTTP ${response.status}`, response.status)
      }
      if (!response.ok) {
        throw new GraphGatewayError(`Graph Gateway returned HTTP ${response.status}`, response.status, body.errors)
      }
      if (body.errors?.length) {
        const message = body.errors.map((error) => error.message).join('; ')
        if (/invalid deployment ID|subgraph not found/i.test(message)) {
          throw new GraphEvidenceError('INVALID_DEPLOYMENT', message, response.status, body.errors)
        }
        if (/has no field|unknown field/i.test(message)) {
          throw new GraphEvidenceError('SCHEMA_DRIFT', message, response.status, body.errors)
        }
        throw new GraphGatewayError(message, response.status, body.errors)
      }
      return assertGraphDeployment(body.data, deploymentId, response.status)
    } finally {
      clearTimeout(timeout)
    }
  }

  meta(deploymentId: string): Promise<{ _meta: GraphMeta }> {
    return this.query(deploymentId, META_QUERY)
  }

  readEntities<T>(deploymentId: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.query<T>(deploymentId, query, variables)
  }

  async inspectDeployment(
    target: DeploymentInspectionTarget,
    options: { nowUnix?: number; maxAgeSeconds?: number } = {},
  ): Promise<DeploymentHealthResult> {
    const data = await this.query<{
      _meta: GraphMeta
      __type: { fields: Array<{ name: string }> } | null
      markets: Array<{ id: string }>
    }>(target.deploymentId, CATALOG_HEALTH_QUERY)
    if (data._meta.hasIndexingErrors) {
      throw new GraphEvidenceError(
        'INDEXING_ERROR',
        `Graph deployment has indexing errors: ${target.deploymentId}`,
      )
    }
    const timestamp = data._meta.block.timestamp
    if (!Number.isSafeInteger(timestamp) || Number(timestamp) < 0) {
      throw new GraphEvidenceError('MALFORMED_RESPONSE', `Graph timestamp was invalid for ${target.deploymentId}`)
    }
    const fields = data.__type?.fields?.map(({ name }) => name)
    if (!fields || fields.some((field) => typeof field !== 'string')) {
      throw new GraphEvidenceError('SCHEMA_DRIFT', `Market schema was unavailable for ${target.deploymentId}`)
    }
    const missing = target.requiredMarketFields.filter((field) => !fields.includes(field))
    if (missing.length) {
      throw new GraphEvidenceError(
        'SCHEMA_DRIFT',
        `Market schema drift for ${target.deploymentId}; missing ${missing.join(', ')}`,
      )
    }
    if (!Array.isArray(data.markets) || data.markets.length === 0 || typeof data.markets[0]?.id !== 'string') {
      throw new GraphEvidenceError('INVARIANT_FAILURE', `Graph deployment has no lending markets: ${target.deploymentId}`)
    }
    const nowUnix = options.nowUnix ?? Math.floor(Date.now() / 1_000)
    const maxAgeSeconds = options.maxAgeSeconds ?? 300
    if (!Number.isSafeInteger(nowUnix) || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
      throw new Error('Health inspection time values must be non-negative safe integers')
    }
    const ageSeconds = Math.max(0, nowUnix - Number(timestamp))
    if (ageSeconds > maxAgeSeconds) {
      throw new GraphEvidenceError(
        'STALE',
        `Graph evidence for ${target.deploymentId} is ${ageSeconds}s old; limit is ${maxAgeSeconds}s`,
      )
    }
    return {
      deploymentId: target.deploymentId,
      status: 'healthy',
      block: data._meta.block.number,
      timestamp: Number(timestamp),
      ageSeconds,
      schemaFieldsChecked: target.requiredMarketFields.length,
    }
  }
}

function assertGraphDeployment<T>(data: T | undefined, expectedDeploymentId: string, status?: number): T {
  if (!data || typeof data !== 'object') {
    throw new GraphEvidenceError('MALFORMED_RESPONSE', 'Graph Gateway response did not contain data', status)
  }
  const meta = (data as { _meta?: unknown })._meta
  if (!meta || typeof meta !== 'object') {
    throw new GraphEvidenceError(
      'MALFORMED_RESPONSE',
      `Graph response omitted _meta for ${expectedDeploymentId}`,
      status,
    )
  }
  const typedMeta = meta as Partial<GraphMeta>
  if (typedMeta.deployment !== expectedDeploymentId) {
    throw new GraphEvidenceError(
      'DEPLOYMENT_MISMATCH',
      `Graph response deployment mismatch; expected ${expectedDeploymentId}`,
      status,
    )
  }
  if (typeof typedMeta.hasIndexingErrors !== 'boolean') {
    throw new GraphEvidenceError('MALFORMED_RESPONSE', `Graph response indexing status was invalid for ${expectedDeploymentId}`, status)
  }
  if (!Number.isSafeInteger(typedMeta.block?.number) || Number(typedMeta.block?.number) < 0) {
    throw new GraphEvidenceError('MALFORMED_RESPONSE', `Graph response block was invalid for ${expectedDeploymentId}`, status)
  }
  return data
}

export const META_QUERY = `query ConformanceMeta {
  _meta {
    deployment
    hasIndexingErrors
    block { number timestamp }
  }
}`

export const CATALOG_HEALTH_QUERY = `query CatalogHealth {
  _meta {
    deployment
    hasIndexingErrors
    block { number timestamp }
  }
  __type(name: "Market") {
    fields { name }
  }
  markets(first: 1) { id }
}`

export const LENDING_MARKETS_QUERY = `query ConformanceMarkets($first: Int!) {
  _meta {
    deployment
    hasIndexingErrors
    block { number timestamp }
  }
  markets(first: $first, orderBy: id) {
    id
    totalValueLockedUSD
    totalBorrowBalanceUSD
    totalDepositBalanceUSD
    inputTokenBalance
  }
}`

export function graphQueryHash(query: string): string {
  return keccak256(toUtf8Bytes(query))
}
