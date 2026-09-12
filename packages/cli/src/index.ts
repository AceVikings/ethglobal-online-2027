#!/usr/bin/env -S node --experimental-strip-types
import { readFileSync } from 'node:fs'
import { getVerdict, paymentFetchFromEnv } from './client.ts'
import type { ClearingTrade } from '@desk/signal'

function usage(): never {
  console.error('Usage: conformance-desk check <protocol> <network> <deployment-id> --request-id ID --trade FILE [--pin CID] [--lag BLOCKS] [--json]')
  process.exit(1)
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  if (!argv[index + 1]) usage()
  return argv[index + 1]
}

const argv = process.argv.slice(2)
if (argv[0] !== 'check' || argv.length < 4) usage()
const lag = Number(option(argv, '--lag') ?? '50')
if (!Number.isSafeInteger(lag) || lag < 0) throw new Error('--lag must be a non-negative integer')
const requestId = option(argv, '--request-id') ?? usage()
const tradeFile = option(argv, '--trade') ?? usage()
const trade = JSON.parse(readFileSync(tradeFile, 'utf8')) as ClearingTrade
const expectedSigner = process.env.CONFORMANCE_EXPECTED_SIGNER
if (!expectedSigner) throw new Error('CONFORMANCE_EXPECTED_SIGNER is required')

const result = await getVerdict({
  serviceUrl: process.env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020',
  expectedSigner,
  paymentFetch: await paymentFetchFromEnv(),
  input: {
    clientRequestId: requestId,
    standard: 'messari/lending-v3.1',
    subject: { protocol: argv[1], network: argv[2], deploymentId: argv[3] },
    policy: { pinnedCid: option(argv, '--pin') ?? null, lagBoundBlocks: lag },
    trade,
  },
})

if (argv.includes('--json')) {
  console.log(JSON.stringify({ ...result.verdict, paymentRef: result.paymentRef }, null, 2))
} else {
  const { verdict } = result
  console.log(`${verdict.verdict}  ${verdict.subject.protocol}/${verdict.subject.network}`)
  console.log(`deployment  ${verdict.subject.deploymentId}`)
  console.log(`block       ${verdict.evidence.block}`)
  console.log(`request     ${verdict.requestId}`)
  console.log(`signer      ${verdict.signer} (verified)`)
  if (result.paymentRef) console.log(`payment     ${result.paymentRef}`)
  for (const [name, check] of Object.entries(verdict.checks)) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}        ${name}`)
  }
}

process.exitCode = result.verdict.verdict === 'CONFORMANT' ? 0 : 2
