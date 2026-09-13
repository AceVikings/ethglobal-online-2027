export interface AgentClientConfig { baseUrl: string; token: string; fetch?: typeof fetch }

export class AgentClient {
  readonly #baseUrl: string
  readonly #token: string
  readonly #fetch: typeof fetch

  constructor(config: AgentClientConfig) {
    if (!config.token) throw new Error('access token is required')
    this.#baseUrl = config.baseUrl
    this.#token = config.token
    this.#fetch = config.fetch ?? fetch
  }

  async #request(path: string, init: RequestInit = {}): Promise<any> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${this.#token}`, accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers,
      },
    })
    if (!response.ok) throw new Error(`API request failed with HTTP ${response.status}`)
    return response.json()
  }

  whoami() { return this.#request('/api/v1/me') }
  offerings() { return this.#request('/api/v1/offerings') }
  listVaults() { return this.#request('/api/v1/vaults') }
  createVault(draft: unknown) { return this.#request('/api/v1/vaults', { method: 'POST', body: JSON.stringify(draft) }) }
  requestRun(vaultId: string, request: unknown) {
    return this.#request(`/api/v1/vaults/${encodeURIComponent(vaultId)}/run-requests`, { method: 'POST', body: JSON.stringify(request) })
  }
  runStatus(runId: string) { return this.#request(`/api/v1/runs/${encodeURIComponent(runId)}`) }
  history(vaultId?: string) {
    return this.#request(vaultId ? `/api/v1/vaults/${encodeURIComponent(vaultId)}/runs` : '/api/v1/runs')
  }
  verify(runId: string) { return this.#request(`/api/v1/runs/${encodeURIComponent(runId)}/proof`) }

  async *watch(runId: string, lastEventId?: string): AsyncGenerator<unknown> {
    const response = await this.#fetch(new URL(`/api/v1/runs/${encodeURIComponent(runId)}/events`, this.#baseUrl), {
      headers: { authorization: `Bearer ${this.#token}`, accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
    })
    if (!response.ok) throw new Error(`API request failed with HTTP ${response.status}`)
    if (!response.body) throw new Error('event stream response has no body')
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let match: RegExpExecArray | null
      while ((match = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const frame = buffer.slice(0, match.index).replace(/\r/g, '')
        buffer = buffer.slice(match.index + match[0].length)
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (data) yield JSON.parse(data)
      }
    }
  }
}
