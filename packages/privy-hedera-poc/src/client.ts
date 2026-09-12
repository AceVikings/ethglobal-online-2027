export interface PrivyWallet {
  id: string
  address: string
  chain_type: 'ethereum'
  external_id?: string
  display_name?: string
}

export interface PrivyClientConfig {
  appId: string
  appSecret: string
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export class PrivyApiError extends Error {
  readonly status: number

  constructor(status: number, statusText: string) {
    super(`Privy request failed (${status}${statusText ? ` ${statusText}` : ''})`)
    this.name = 'PrivyApiError'
    this.status = status
  }
}

function assertCredential(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`)
}

function assertPathIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must contain only URL-safe letters, numbers, underscores, or hyphens`)
  }
}

function parseWallet(value: unknown): PrivyWallet {
  if (!value || typeof value !== 'object') throw new Error('Privy returned an invalid wallet')
  const wallet = value as Record<string, unknown>
  if (
    typeof wallet.id !== 'string' ||
    typeof wallet.address !== 'string' ||
    wallet.chain_type !== 'ethereum'
  ) {
    throw new Error('Privy returned an invalid Ethereum wallet')
  }
  return wallet as unknown as PrivyWallet
}

/** Minimal server-side client for the generally available Privy wallet REST API. */
export class PrivyClient {
  readonly #appId: string
  readonly #authorization: string
  readonly #baseUrl: string
  readonly #fetch: typeof globalThis.fetch

  constructor(config: PrivyClientConfig) {
    assertCredential(config.appId, 'Privy app ID')
    assertCredential(config.appSecret, 'Privy app secret')
    this.#appId = config.appId
    this.#authorization = `Basic ${Buffer.from(`${config.appId}:${config.appSecret}`).toString('base64')}`
    this.#baseUrl = (config.baseUrl ?? 'https://api.privy.io').replace(/\/$/, '')
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: this.#authorization,
        'privy-app-id': this.#appId,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    })
    if (!response.ok) {
      // Provider bodies can contain request context. Keep them behind this boundary.
      throw new PrivyApiError(response.status, response.statusText)
    }
    try {
      return await response.json()
    } catch {
      throw new Error('Privy returned a non-JSON response')
    }
  }

  async getWallet(walletId: string): Promise<PrivyWallet> {
    assertPathIdentifier(walletId, 'wallet ID')
    return parseWallet(await this.#request(`/v1/wallets/${walletId}`))
  }

  async getWalletByExternalId(externalId: string): Promise<PrivyWallet> {
    assertPathIdentifier(externalId, 'external ID')
    return parseWallet(await this.#request(`/v1/wallets/ext_wal_${externalId}`))
  }

  async createWalletByExternalId(externalId: string, displayName?: string): Promise<PrivyWallet> {
    assertPathIdentifier(externalId, 'external ID')
    if (displayName !== undefined && (displayName.length === 0 || displayName.length > 100)) {
      throw new Error('display name must contain 1 to 100 characters')
    }
    return parseWallet(
      await this.#request('/v1/wallets', {
        method: 'POST',
        body: JSON.stringify({
          chain_type: 'ethereum',
          external_id: externalId,
          ...(displayName === undefined ? {} : { display_name: displayName }),
        }),
      }),
    )
  }

  async getOrCreateWalletByExternalId(externalId: string, displayName?: string): Promise<PrivyWallet> {
    try {
      return await this.getWalletByExternalId(externalId)
    } catch (error) {
      if (!(error instanceof PrivyApiError) || error.status !== 404) throw error
    }
    try {
      return await this.createWalletByExternalId(externalId, displayName)
    } catch (error) {
      // A concurrent creator may win the unique external-ID race.
      if (!(error instanceof PrivyApiError) || error.status !== 409) throw error
      return this.getWalletByExternalId(externalId)
    }
  }

  async signHash(walletId: string, hash: `0x${string}`): Promise<`0x${string}`> {
    assertPathIdentifier(walletId, 'wallet ID')
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('hash must be a 32-byte 0x-prefixed hex string')
    const value = (await this.#request(`/v1/wallets/${walletId}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ method: 'secp256k1_sign', params: { hash } }),
    })) as Record<string, unknown>
    const data = value?.data as Record<string, unknown> | undefined
    if (
      value?.method !== 'secp256k1_sign' ||
      data?.encoding !== 'hex' ||
      typeof data.signature !== 'string' ||
      !/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(data.signature)
    ) {
      throw new Error('Privy returned an invalid secp256k1_sign response')
    }
    return data.signature as `0x${string}`
  }
}
