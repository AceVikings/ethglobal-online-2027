#!/usr/bin/env -S node --experimental-strip-types
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { configFromEnv, createMcpHandler } from './server.ts'

const handle = createMcpHandler(await configFromEnv())
const lines = createInterface({ input: stdin, terminal: false })
lines.on('line', async (line) => {
  if (!line.trim()) return
  let response: unknown
  try {
    response = await handle(JSON.parse(line))
  } catch {
    response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
  }
  if (response) stdout.write(`${JSON.stringify(response)}\n`)
})
