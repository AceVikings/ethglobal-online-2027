'use strict'

const agent = require('../../packages/agent/src/index.cjs')

function executeRequested(argv = process.argv.slice(2)) {
  const unknown = argv.filter((arg) => arg !== '--execute')
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(', ')}`)
  return argv.includes('--execute')
}

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`) }

async function run(main) {
  try { await main() } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`)
    const state = error.details || error.operation
    if (state) process.stderr.write(`${JSON.stringify({ state }, null, 2)}\n`)
    process.exitCode = 1
  }
}

function txId(result) { return result?.transactionId || result?.payload?.transactionId || null }

module.exports = { ...agent, executeRequested, output, run, txId }
