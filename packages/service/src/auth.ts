import type { IncomingMessage } from 'node:http'

export function bearerToken(request: IncomingMessage): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.authorization ?? '')
  return match?.[1] ?? null
}

export async function authenticatedSubject(request: IncomingMessage, verify?: (token: string) => Promise<{ userId: string }>): Promise<string | null> {
  const token = bearerToken(request)
  if (!token || !verify) return null
  try { const subject = (await verify(token)).userId; return subject || null } catch { return null }
}
