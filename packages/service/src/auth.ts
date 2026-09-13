import type { IncomingMessage } from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export type AuthSubject = { userId: string; scopes?: string[]; clientId?: string }

export function bearerToken(request: IncomingMessage): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.authorization ?? '')
  return match?.[1] ?? null
}

export async function authenticatedSubject(request: IncomingMessage, verify?: (token: string) => Promise<AuthSubject>): Promise<string | null> {
  const token = bearerToken(request)
  if (!token || !verify) return null
  try { const subject = (await verify(token)).userId; return subject || null } catch { return null }
}

export function verifyMcpServiceToken(token: string, config: { secret: string; issuer: string; audience: string; now?: () => number }): AuthSubject {
  const parts = token.split('.')
  if (parts.length !== 3 || Buffer.byteLength(config.secret) < 32) throw new Error('invalid service token')
  const [header, payload, signature] = parts
  const expected = Buffer.from(createHmac('sha256', config.secret).update(`${header}.${payload}`).digest('base64url'))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('invalid service token')
  const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  const timestamp = (config.now ?? (() => Math.floor(Date.now() / 1000)))()
  if (parsedHeader.alg !== 'HS256' || claims.iss !== config.issuer || claims.aud !== config.audience ||
      typeof claims.sub !== 'string' || typeof claims.client_id !== 'string' || typeof claims.exp !== 'number' || claims.exp <= timestamp) {
    throw new Error('invalid service token')
  }
  return { userId: claims.sub, clientId: claims.client_id, scopes: typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean) : [] }
}

export function createMcpServiceToken(input: { userId: string; clientId: string; scopes: string[] }, config: { secret: string; issuer: string; audience: string; ttlSeconds?: number; now?: () => number }): string {
  if (Buffer.byteLength(config.secret) < 32) throw new Error('invalid service token configuration')
  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))()
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: config.issuer, aud: config.audience, sub: input.userId, client_id: input.clientId,
    scope: [...new Set(input.scopes)].join(' '), iat: now, exp: now + (config.ttlSeconds ?? 3600), jti: randomUUID(),
  })).toString('base64url')
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${createHmac('sha256', config.secret).update(unsigned).digest('base64url')}`
}
