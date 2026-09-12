'use strict'

const path = require('node:path')
const fs = require('node:fs')
const agent = require('../../packages/agent/src/index.cjs')

function executeRequested(argv = process.argv.slice(2)) {
  const unknown = argv.filter((arg) => arg !== '--execute')
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(', ')}`)
  return argv.includes('--execute')
}

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`) }

function loadJson(file) {
  const absolute = path.resolve(process.cwd(), file)
  return JSON.parse(fs.readFileSync(absolute, 'utf8'))
}

async function run(main) {
  try { await main() } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  }
}

function txId(result) { return result?.transactionId || result?.payload?.transactionId || null }

module.exports = { ...agent, executeRequested, output, loadJson, run, txId }
