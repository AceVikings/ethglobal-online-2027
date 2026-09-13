#!/usr/bin/env -S node --experimental-strip-types
import { readFileSync } from 'node:fs'
import { stdin } from 'node:process'
import { randomUUID } from 'node:crypto'
import type { ClearingTrade } from '@desk/signal'
import { AgentClient } from './agent-client.ts'
import { clearAuth, loadAuth, saveAuth } from './auth.ts'
import { getVerdict, paymentFetchFromEnv } from './client.ts'

function usage(): never {
  console.error(`Usage:
  conformance-desk auth token [--token-file FILE] [--service-url URL]
  conformance-desk auth logout
  conformance-desk whoami | offerings
  conformance-desk vault list
  conformance-desk vault create --file FILE
  conformance-desk run request VAULT_ID [--request-id ID] [--file FILE]
  conformance-desk run watch RUN_ID [--last-event-id ID]
  conformance-desk history [--vault VAULT_ID]
  conformance-desk verify RUN_ID
  conformance-desk check <protocol> <network> <deployment-id> --request-id ID --trade FILE [--pin CID] [--lag BLOCKS] [--json]`)
  process.exit(1)
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  if (!argv[index + 1]) usage()
  return argv[index + 1]
}

function fileJson(path: string | undefined): unknown {
  if (!path) usage()
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function readToken(argv: string[]): Promise<string> {
  const tokenFile = option(argv, '--token-file')
  if (tokenFile) return readFileSync(tokenFile, 'utf8').trim()
  if (stdin.isTTY) throw new Error('pipe the token on stdin or use --token-file; command-line token arguments are intentionally unsupported')
  let value = ''
  for await (const chunk of stdin) value += chunk
  return value.trim()
}

async function legacyCheck(argv: string[]): Promise<void> {
  if (argv.length < 4) usage()
  const lag = Number(option(argv, '--lag') ?? '50')
  if (!Number.isSafeInteger(lag) || lag < 0) throw new Error('--lag must be a non-negative integer')
  const requestId = option(argv, '--request-id') ?? usage()
  const trade = fileJson(option(argv, '--trade')) as ClearingTrade
  const expectedSigner = process.env.CONFORMANCE_EXPECTED_SIGNER
  if (!expectedSigner) throw new Error('CONFORMANCE_EXPECTED_SIGNER is required')
  const result = await getVerdict({
    serviceUrl: process.env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020', expectedSigner,
    paymentFetch: await paymentFetchFromEnv(),
    input: {
      clientRequestId: requestId, standard: 'messari/lending-v3.1',
      subject: { protocol: argv[1], network: argv[2], deploymentId: argv[3] },
      policy: { pinnedCid: option(argv, '--pin') ?? null, lagBoundBlocks: lag }, trade,
    },
  })
  if (argv.includes('--json')) console.log(JSON.stringify({ ...result.verdict, paymentRef: result.paymentRef }, null, 2))
  else {
    const { verdict } = result
    console.log(`${verdict.verdict}  ${verdict.subject.protocol}/${verdict.subject.network}`)
    console.log(`deployment  ${verdict.subject.deploymentId}`)
    console.log(`block       ${verdict.evidence.block}`)
    console.log(`request     ${verdict.requestId}`)
    console.log(`signer      ${verdict.signer} (verified)`)
    if (result.paymentRef) console.log(`payment     ${result.paymentRef}`)
    for (const [name, check] of Object.entries(verdict.checks)) console.log(`${check.pass ? 'PASS' : 'FAIL'}        ${name}`)
  }
  process.exitCode = result.verdict.verdict === 'CONFORMANT' ? 0 : 2
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === 'check') return legacyCheck(argv)
  if (argv[0] === 'auth' && argv[1] === 'token') {
    const token = await readToken(argv)
    if (!token) throw new Error('access token is empty')
    await saveAuth({ token, serviceUrl: option(argv, '--service-url') ?? process.env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020' })
    console.log('Authentication saved.')
    return
  }
  if (argv[0] === 'auth' && argv[1] === 'logout') {
    await clearAuth()
    console.log('Authentication removed.')
    return
  }
  const auth = await loadAuth()
  const client = new AgentClient({ baseUrl: auth.serviceUrl, token: auth.token })
  let result: unknown
  if (argv[0] === 'whoami') result = await client.whoami()
  else if (argv[0] === 'offerings') result = await client.offerings()
  else if (argv[0] === 'vault' && argv[1] === 'list') result = await client.listVaults()
  else if (argv[0] === 'vault' && argv[1] === 'create') result = await client.createVault(fileJson(option(argv, '--file')))
  else if (argv[0] === 'run' && argv[1] === 'request' && argv[2]) {
    const body = option(argv, '--file') ? fileJson(option(argv, '--file')) : { requestId: option(argv, '--request-id') ?? randomUUID() }
    result = await client.requestRun(argv[2], body)
  } else if (argv[0] === 'run' && argv[1] === 'watch' && argv[2]) {
    for await (const event of client.watch(argv[2], option(argv, '--last-event-id'))) console.log(JSON.stringify(event))
    return
  } else if (argv[0] === 'history') result = await client.history(option(argv, '--vault'))
  else if (argv[0] === 'verify' && argv[1]) result = await client.verify(argv[1])
  else usage()
  console.log(JSON.stringify(result, null, 2))
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : 'command failed')
  process.exitCode = 1
})
