import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const MCP_SCOPES = [
  'offerings:read', 'vaults:read', 'vaults:write', 'runs:request', 'runs:read', 'proof:read',
] as const
export type McpScope = typeof MCP_SCOPES[number]

export interface ServiceTokenClaims {
  iss: string; aud: string; sub: string; client_id: string; scope: string; scopes: string[]
  iat: number; exp: number; jti: string
}
interface TokenConfig { secret: string; issuer: string; audience: string; now?: () => number }

function sign(input: string, secret: string): string { return createHmac('sha256', secret).update(input).digest('base64url') }
function assertConfig(config: TokenConfig): void {
  if (Buffer.byteLength(config.secret) < 32) throw new Error('token secret must contain at least 32 bytes')
  if (!config.issuer || !config.audience) throw new Error('token issuer and audience are required')
}

export function createServiceToken(input: { subject: string; clientId: string; scopes: string[]; tokenId?: string }, config: TokenConfig & { ttlSeconds: number }): string {
  assertConfig(config)
  if (!input.subject || !input.clientId) throw new Error('token subject and client id are required')
  if (!Number.isSafeInteger(config.ttlSeconds) || config.ttlSeconds < 1 || config.ttlSeconds > 3600) throw new Error('token TTL must be between 1 and 3600 seconds')
  const scopes = [...new Set(input.scopes)]
  if (scopes.some(scope => !MCP_SCOPES.includes(scope as McpScope))) throw new Error('token contains an unsupported scope')
  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))()
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims: ServiceTokenClaims = {
    iss: config.issuer, aud: config.audience, sub: input.subject, client_id: input.clientId,
    scope: scopes.join(' '), scopes, iat: now, exp: now + config.ttlSeconds, jti: input.tokenId ?? randomUUID(),
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${sign(unsigned, config.secret)}`
}

export function verifyServiceToken(token: string, config: TokenConfig): ServiceTokenClaims {
  assertConfig(config)
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('invalid service token')
  const [header, payload, signature] = parts
  let parsedHeader: unknown
  let claims: Partial<ServiceTokenClaims>
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch { throw new Error('invalid service token encoding') }
  if (!parsedHeader || typeof parsedHeader !== 'object' || (parsedHeader as any).alg !== 'HS256') throw new Error('invalid service token algorithm')
  const expected = Buffer.from(sign(`${header}.${payload}`, config.secret))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('invalid service token signature')
  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))()
  if (claims.iss !== config.issuer) throw new Error('invalid service token issuer')
  if (claims.aud !== config.audience) throw new Error('invalid service token audience')
  if (!claims.sub || typeof claims.sub !== 'string') throw new Error('invalid service token subject')
  if (!claims.client_id || typeof claims.client_id !== 'string') throw new Error('invalid service token client')
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) throw new Error('invalid service token lifetime')
  if ((claims.iat as number) > now + 60) throw new Error('service token is not yet valid')
  if ((claims.exp as number) <= now) throw new Error('service token expired')
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : []
  if (scopes.some(scope => !MCP_SCOPES.includes(scope as McpScope))) throw new Error('service token contains an unsupported scope')
  return { ...(claims as ServiceTokenClaims), scopes }
}

export function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+([^\s]+)$/i.exec(header ?? '')
  if (!match) throw new Error('bearer token required')
  return match[1]
}
