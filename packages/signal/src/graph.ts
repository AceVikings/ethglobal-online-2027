import { keccak256, toUtf8Bytes } from 'ethers'

export const DEFAULT_GATEWAY_URL = 'https://gateway.thegraph.com/api/deployments/id'

export interface GraphMeta {
  deployment: string
  hasIndexingErrors: boolean
  block: { number: number; timestamp?: number | null }
}

export interface GraphResponse<T> {
  data: T
  errors?: Array<{ message: string; path?: Array<string | number> }>
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
        throw new GraphGatewayError(body.errors.map((error) => error.message).join('; '), response.status, body.errors)
      }
      if (body.data === undefined || body.data === null) {
        throw new GraphGatewayError('Graph Gateway response did not contain data', response.status)
      }
      return body.data
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
}

export const META_QUERY = `query ConformanceMeta {
  _meta {
    deployment
    hasIndexingErrors
    block { number timestamp }
  }
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
