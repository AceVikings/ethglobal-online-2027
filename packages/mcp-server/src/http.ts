import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { bearerToken, MCP_SCOPES, verifyServiceToken } from './auth.ts'
import { createMcpHandler, type JsonRpcRequest } from './server.ts'

export interface McpHttpConfig {
  backendUrl: string
  secret: string
  issuer: string
  audience: string
  backendFetch?: typeof fetch
  now?: () => number
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<JsonRpcRequest> {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > 1_048_576) throw new Error('request body too large')
  }
  return JSON.parse(body) as JsonRpcRequest
}

export function createMcpHttpServer(config: McpHttpConfig) {
  const handle = createMcpHandler(config)
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      json(response, 200, {
        resource: config.audience,
        authorization_servers: [config.issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: MCP_SCOPES,
      })
      return
    }
    if (url.pathname !== '/mcp' || request.method !== 'POST') {
      json(response, 404, { error: 'not_found' })
      return
    }
    let rawToken: string
    try {
      rawToken = bearerToken(request.headers.authorization)
    } catch {
      response.setHeader('www-authenticate', `Bearer resource_metadata="${config.audience.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource/mcp"`)
      json(response, 401, { error: 'invalid_token' })
      return
    }
    try {
      const claims = verifyServiceToken(rawToken, config)
      const message = await readJson(request)
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        json(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
        return
      }
      const result = await handle(message, { ...claims, rawToken })
      if (result === null) {
        response.writeHead(202)
        response.end()
      } else {
        json(response, 200, result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('token')) {
        response.setHeader('www-authenticate', 'Bearer error="invalid_token"')
        json(response, 401, { error: 'invalid_token' })
      } else if (message === 'request body too large') {
        json(response, 413, { error: 'request_too_large' })
      } else {
        json(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
    }
  })
}

export function httpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpHttpConfig {
  const secret = env.CONFORMANCE_MCP_TOKEN_SECRET
  if (!secret) throw new Error('CONFORMANCE_MCP_TOKEN_SECRET is required for HTTP mode')
  return {
    backendUrl: env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020', secret,
    issuer: env.CONFORMANCE_MCP_ISSUER ?? 'https://conformance-desk.invalid',
    audience: env.CONFORMANCE_MCP_AUDIENCE ?? 'http://127.0.0.1:4030/mcp',
  }
}
