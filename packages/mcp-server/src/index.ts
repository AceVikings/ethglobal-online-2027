#!/usr/bin/env -S node --experimental-strip-types
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { bearerToken, verifyServiceToken } from './auth.ts'
import { createMcpHttpServer, httpConfigFromEnv } from './http.ts'
import { configFromEnv, createMcpHandler } from './server.ts'

if (process.argv.includes('--http')) {
  const config = httpConfigFromEnv()
  const port = Number(process.env.PORT ?? '4030')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port')
  createMcpHttpServer(config).listen(port, () => console.error(`Conformance Desk MCP listening on :${port}`))
} else {
  const rawToken = bearerToken(process.env.CONFORMANCE_MCP_TOKEN ? `Bearer ${process.env.CONFORMANCE_MCP_TOKEN}` : undefined)
  const auth = httpConfigFromEnv()
  const principal = { ...verifyServiceToken(rawToken, auth), rawToken }
  const handle = createMcpHandler(configFromEnv())
  const lines = createInterface({ input: stdin, terminal: false })
  lines.on('line', async line => {
    if (!line.trim()) return
    let response: unknown
    try { response = await handle(JSON.parse(line), principal) }
    catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } }
    if (response) stdout.write(`${JSON.stringify(response)}\n`)
  })
}
