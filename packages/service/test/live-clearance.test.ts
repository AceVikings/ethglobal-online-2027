import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Wallet } from 'ethers'

import { createLiveClearanceRunner, liveMandateMessage, verifyLiveMandate, type LiveMandate } from '../src/live-clearance.ts'

const owner = 'did:privy:demo-user'
const when = new Date('2026-09-13T04:30:00.000Z')

function mandate(wallet: string): LiveMandate {
  return {
    version: 1,
    owner,
    wallet,
    network: 'hedera:testnet',
    asset: 'SPCF',
    units: '1.0',
    maxDecisionFee: '0.01 USDC',
    policy: 'strict-market-health',
    expiresAt: new Date(when.getTime() + 5 * 60_000).toISOString(),
    nonce: 'submission-demo-nonce-1234',
  }
}

test('verifies a bounded Privy wallet mandate and rejects tampering', async () => {
  const wallet = Wallet.createRandom()
  const value = mandate(wallet.address)
  const signature = await wallet.signMessage(liveMandateMessage(value))
  assert.equal(verifyLiveMandate({ mandate: value, signature }, owner, when).wallet, wallet.address)
  assert.throws(() => verifyLiveMandate({ mandate: { ...value, units: '2.0' as '1.0' }, signature }, owner, when), /bounded/)
})

test('runs the real stage contract in order and publishes only after replay passes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clearing-live-'))
  const publicStateFile = path.join(root, 'public-state.json')
  const wallet = Wallet.createRandom()
  const value = mandate(wallet.address)
  const signature = await wallet.signMessage(liveMandateMessage(value))
  const scripts: string[] = []
  const stages: Array<{ id: string; status: string }> = []
  const runner = createLiveClearanceRunner({
    root,
    publicStateFile,
    now: () => when,
    cooldownSeconds: 0,
    runProcess: async (script, environment) => {
      scripts.push(script)
      if (script.endsWith('seed-equity.cjs')) return { transactionId: '0xissue' }
      if (script.endsWith('create-hold.cjs')) return { holdId: '3', transactionId: '0xhold' }
      const stateFile = environment.CARETAKER_STATE_FILE!
      if (script.endsWith('run-caretaker.cjs')) {
        await mkdir(path.dirname(stateFile), { recursive: true })
        await writeFile(stateFile, JSON.stringify({
          authorization: { holdId: '3' },
          purchased: { paymentTxId: '0.0.1@1.2', verdict: { checks: { shapeAgreement: { peers: 5 } } } },
          settlement: { tradeDigest: `0x${'12'.repeat(32)}`, transactionId: '0.0.2@2.3' },
          audit: { transactionId: '0.0.3@3.4', topicSequenceNumber: '9' },
        }))
        return {}
      }
      const current = JSON.parse(await readFile(stateFile, 'utf8'))
      await writeFile(stateFile, JSON.stringify({ ...current, replay: { checked: 1, passed: 1, failed: 0 } }))
      return { checked: 1, passed: 1, failed: 0 }
    },
  })
  const result = await runner.run(owner, { mandate: value, signature }, (stage) => { stages.push(stage) })
  assert.deepEqual(scripts.map((value) => path.basename(value)), [
    'seed-equity.cjs', 'create-hold.cjs', 'run-caretaker.cjs', 'replay.cjs',
  ])
  assert.equal(result.tradeDigest, `0x${'12'.repeat(32)}`)
  assert.equal(stages.at(-1)?.id, 'audit')
  assert.equal(stages.at(-1)?.status, 'confirmed')
  const published = JSON.parse(await readFile(publicStateFile, 'utf8'))
  assert.equal(published.replay.failed, 0)
})

test('retries an unambiguous pre-payment failure and releases a failed run from the quota', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'clearing-live-retry-'))
  const wallet = Wallet.createRandom()
  const value = mandate(wallet.address)
  const signature = await wallet.signMessage(liveMandateMessage(value))
  let attempts = 0
  const runner = createLiveClearanceRunner({
    root,
    now: () => when,
    cooldownSeconds: 0,
    runProcess: async (script) => {
      attempts += 1
      if (script.endsWith('seed-equity.cjs')) throw new Error('temporary relay failure')
      return {}
    },
  })

  await assert.rejects(runner.run(owner, { mandate: value, signature }, () => {}), /temporary relay failure/)
  assert.equal(attempts, 2)
  const policy = JSON.parse(await readFile(path.join(root, 'rate-policy.json'), 'utf8'))
  assert.deepEqual(policy.runs, [])
})
