export const SUBGRAPH_MCP_URL = 'https://subgraphs.mcp.thegraph.com/sse'

export const SUBGRAPH_MCP_TOOLS = {
  search: 'search_subgraphs_by_keyword',
  topDeployments: 'get_top_subgraph_deployments',
  queryCounts: 'get_deployment_30day_query_counts',
  executeQuery: 'execute_query_by_deployment_id',
  schema: 'get_schema_by_deployment_id',
  executeQueryByIpfsHash: 'execute_query_by_ipfs_hash',
  schemaByIpfsHash: 'get_schema_by_ipfs_hash',
} as const

export interface McpClientOptions {
  apiKey: string
  endpoint?: string
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface PendingCall {
  resolve(value: unknown): void
  reject(reason: unknown): void
  timer: ReturnType<typeof setTimeout>
}

/** Minimal MCP SSE transport, avoiding a runtime dependency for five fixed tools. */
export class SubgraphMcpClient {
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #timeoutMs: number
  readonly #fetch: typeof globalThis.fetch
  readonly #pending = new Map<number, PendingCall>()
  #nextId = 1
  #postUrl?: string
  #connectPromise?: Promise<void>
  #abort?: AbortController

  constructor(options: McpClientOptions) {
    if (!options.apiKey) throw new Error('A Subgraph MCP API key is required')
    this.#apiKey = options.apiKey
    this.#endpoint = options.endpoint ?? SUBGRAPH_MCP_URL
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async connect(): Promise<void> {
    this.#connectPromise ??= this.#openStream()
    return this.#connectPromise
  }

  close(): void {
    this.#abort?.abort()
    this.#rejectAll(new Error('Subgraph MCP client closed'))
    this.#connectPromise = undefined
    this.#postUrl = undefined
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.connect()
    const response = (await this.#request('tools/call', { name, arguments: args })) as {
      isError?: boolean
      structuredContent?: T
      content?: Array<{ type: string; text?: string }>
    }
    if (response.isError) throw new Error(this.#textContent(response.content) || `MCP tool ${name} failed`)
    if (response.structuredContent !== undefined) return response.structuredContent
    const text = this.#textContent(response.content)
    if (!text) return response as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  searchSubgraphsByKeyword<T = unknown>(keyword: string): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.search, { keyword })
  }

  getTopSubgraphDeployments<T = unknown>(contractAddress: string, chain: string): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.topDeployments, {
      contract_address: contractAddress,
      chain,
    })
  }

  getDeployment30DayQueryCounts<T = unknown>(ipfsHashes: readonly string[]): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.queryCounts, { ipfs_hashes: [...ipfsHashes] })
  }

  executeQueryByDeploymentId<T = unknown>(
    deploymentId: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.executeQuery, {
      deployment_id: deploymentId,
      query,
      ...(variables ? { variables } : {}),
    })
  }

  getSchemaByDeploymentId<T = unknown>(deploymentId: string): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.schema, { deployment_id: deploymentId })
  }

  executeQueryByIpfsHash<T = unknown>(
    ipfsHash: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.executeQueryByIpfsHash, {
      ipfs_hash: ipfsHash,
      query,
      ...(variables ? { variables } : {}),
    })
  }

  getSchemaByIpfsHash<T = unknown>(ipfsHash: string): Promise<T> {
    return this.callTool(SUBGRAPH_MCP_TOOLS.schemaByIpfsHash, { ipfs_hash: ipfsHash })
  }

  async #openStream(): Promise<void> {
    this.#abort = new AbortController()
    const response = await this.#fetch(this.#endpoint, {
      headers: { accept: 'text/event-stream', authorization: `Bearer ${this.#apiKey}` },
      signal: this.#abort.signal,
    })
    if (!response.ok || !response.body) throw new Error(`Subgraph MCP SSE returned HTTP ${response.status}`)

    let endpointResolve!: () => void
    let endpointReject!: (error: unknown) => void
    const endpointReady = new Promise<void>((resolve, reject) => {
      endpointResolve = resolve
      endpointReject = reject
    })
    void this.#consume(response.body, endpointResolve).catch((error) => {
      endpointReject(error)
      this.#rejectAll(error)
    })
    let endpointTimer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        endpointReady,
        new Promise<never>((_, reject) => {
          endpointTimer = setTimeout(
            () => reject(new Error('Timed out waiting for Subgraph MCP endpoint')),
            this.#timeoutMs,
          )
        }),
      ])
    } finally {
      if (endpointTimer) clearTimeout(endpointTimer)
    }

    await this.#request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'conformance-desk', version: '0.1.0' },
    })
    await this.#notify('notifications/initialized', {})
  }

  async #consume(stream: ReadableStream<Uint8Array>, endpointResolve: () => void): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        let eventName = 'message'
        const data: string[] = []
        for (const line of event.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        this.#onEvent(eventName, data.join('\n'), endpointResolve)
      }
    }
    throw new Error('Subgraph MCP SSE stream ended')
  }

  #onEvent(event: string, data: string, endpointResolve: () => void): void {
    if (event === 'endpoint') {
      this.#postUrl = new URL(data, this.#endpoint).toString()
      endpointResolve()
      return
    }
    if (event !== 'message' || !data) return
    const message = JSON.parse(data) as JsonRpcResponse
    if (message.id === undefined) return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(`MCP ${message.error.code}: ${message.error.message}`))
    else pending.resolve(message.result)
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Subgraph MCP ${method} timed out`))
      }, this.#timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
    })
    try {
      await this.#post({ jsonrpc: '2.0', id, method, params })
    } catch (error) {
      const pending = this.#pending.get(id)
      if (pending) clearTimeout(pending.timer)
      this.#pending.delete(id)
      throw error
    }
    return response
  }

  async #notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.#post({ jsonrpc: '2.0', method, params })
  }

  async #post(message: Record<string, unknown>): Promise<void> {
    if (!this.#postUrl) throw new Error('Subgraph MCP session endpoint is unavailable')
    const response = await this.#fetch(this.#postUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(message),
      signal: this.#abort?.signal,
    })
    if (!response.ok && response.status !== 202) throw new Error(`Subgraph MCP POST returned HTTP ${response.status}`)
  }

  #textContent(content?: Array<{ type: string; text?: string }>): string {
    return content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n') ?? ''
  }

  #rejectAll(error: unknown): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
