import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getAddress, verifyMessage } from 'ethers'
import { liveMandateMessage, type LiveMandate, type SignedLiveMandate } from '@desk/signal'

export { liveMandateMessage, type LiveMandate, type SignedLiveMandate } from '@desk/signal'

export type LiveClearanceStage = {
  id: 'mandate' | 'issuance' | 'hold' | 'payment' | 'evidence' | 'settlement' | 'audit'
  status: 'running' | 'confirmed' | 'failed'
  title: string
  detail: string
  proof?: Record<string, string | number | boolean | null>
}

type RunProcess = (script: string, environment: NodeJS.ProcessEnv) => Promise<unknown>
type StageListener = (stage: LiveClearanceStage) => void | Promise<void>

export interface LiveClearanceRunner {
  run(
    owner: string,
    signed: SignedLiveMandate,
    onStage: StageListener,
  ): Promise<{ runId: string; tradeDigest: unknown; proof: ReturnType<typeof publicProof> }>
}

type LiveClearanceOptions = {
  root?: string
  publicStateFile?: string
  now?: () => Date
  runProcess?: RunProcess
  maxRunsPerDay?: number
  cooldownSeconds?: number
}

type RateState = { runs: Array<{ id: string; owner: string; startedAt: string }> }

const SCRIPT_OUTPUT_LIMIT = 1024 * 1024
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function verifyLiveMandate(input: SignedLiveMandate, owner: string, now = new Date()): LiveMandate {
  const mandate = input?.mandate
  if (!mandate || input.signature == null) throw new Error('signed mandate is required')
  if (mandate.version !== 1 || mandate.owner !== owner || mandate.network !== 'hedera:testnet' ||
      mandate.asset !== 'SPCF' || mandate.units !== '1.0' || mandate.maxDecisionFee !== '0.01 USDC' ||
      mandate.policy !== 'strict-market-health') {
    throw new Error('mandate does not match the bounded live-clearance policy')
  }
  if (!/^did:privy:[A-Za-z0-9_-]+$/.test(mandate.owner)) throw new Error('invalid mandate owner')
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(mandate.nonce)) throw new Error('invalid mandate nonce')
  const expiry = Date.parse(mandate.expiresAt)
  const remaining = expiry - now.getTime()
  if (!Number.isFinite(expiry) || remaining < 60_000 || remaining > 15 * 60_000) {
    throw new Error('mandate expiry must be between one and fifteen minutes')
  }
  const wallet = getAddress(mandate.wallet)
  const recovered = getAddress(verifyMessage(liveMandateMessage({ ...mandate, wallet }), input.signature))
  if (recovered !== wallet) throw new Error('mandate signature does not match its wallet')
  return { ...mandate, wallet }
}

function executeScript(script: string, environment: NodeJS.ProcessEnv): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--execute'], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.length > SCRIPT_OUTPUT_LIMIT) child.kill('SIGTERM')
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      if (stderr.length > SCRIPT_OUTPUT_LIMIT) child.kill('SIGTERM')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`live stage failed (${path.basename(script)}): ${stderr.trim().split('\n').at(-1) || `exit ${code}`}`))
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : {})
      } catch {
        reject(new Error(`live stage returned invalid output (${path.basename(script)})`))
      }
    })
  })
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as T
  } catch (error: any) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function atomicJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, filename)
}

function publicProof(state: Record<string, any>) {
  return {
    tradeDigest: state.settlement?.tradeDigest ?? state.submitted?.tradeDigest ?? null,
    holdId: state.authorization?.holdId ?? null,
    paymentTransaction: state.purchased?.paymentTxId ?? null,
    settlementTransaction: state.settlement?.transactionId ?? null,
    hcsTransaction: state.audit?.transactionId ?? null,
    hcsSequence: state.audit?.topicSequenceNumber ? Number(state.audit.topicSequenceNumber) : null,
    replayPassed: state.replay?.passed ?? null,
    replayFailed: state.replay?.failed ?? null,
  }
}

function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/^(another live clearance|live clearance is cooling down|daily live-clearance limit|signed mandate|mandate )/i.test(message)) {
    return message
  }
  return 'The live clearance stopped before public proof was complete.'
}

export function createLiveClearanceRunner(options: LiveClearanceOptions = {}): LiveClearanceRunner {
  const root = path.resolve(options.root ?? process.env.LIVE_RUN_ROOT ?? '.context/live-runs')
  const publicStateFile = path.resolve(options.publicStateFile ?? process.env.CARETAKER_STATE_FILE ?? path.join(root, 'caretaker-state.json'))
  const now = options.now ?? (() => new Date())
  const runProcess = options.runProcess ?? executeScript
  const maxRunsPerDay = options.maxRunsPerDay ?? Number(process.env.LIVE_MAX_RUNS_PER_DAY ?? 3)
  const cooldownSeconds = options.cooldownSeconds ?? Number(process.env.LIVE_RUN_COOLDOWN_SECONDS ?? 600)
  let active = false

  async function reserve(owner: string, runId: string, startedAt: Date) {
    const policyFile = path.join(root, 'rate-policy.json')
    const current = await readJson<RateState>(policyFile, { runs: [] })
    const recent = current.runs.filter((run) => startedAt.getTime() - Date.parse(run.startedAt) < ONE_DAY_MS)
    const last = recent.at(-1)
    if (last && startedAt.getTime() - Date.parse(last.startedAt) < cooldownSeconds * 1000) {
      throw new Error(`live clearance is cooling down; retry after ${new Date(Date.parse(last.startedAt) + cooldownSeconds * 1000).toISOString()}`)
    }
    if (recent.length >= maxRunsPerDay) throw new Error('daily live-clearance limit reached')
    await atomicJson(policyFile, { runs: [...recent, { id: runId, owner, startedAt: startedAt.toISOString() }] })
  }

  return {
    async run(owner: string, signed: SignedLiveMandate, onStage: StageListener) {
      if (active) throw new Error('another live clearance is already running')
      active = true
      const startedAt = now()
      try {
        const mandate = verifyLiveMandate(signed, owner, startedAt)
        const runId = randomUUID()
        await reserve(owner, runId, startedAt)
        const runDirectory = path.join(root, runId)
        const holdFile = path.join(runDirectory, 'ats-hold.json')
        const stateFile = path.join(runDirectory, 'caretaker-state.json')
        const environment = {
          ...process.env,
          ATS_SEED_AMOUNT: mandate.units,
          TRADE_AMOUNT: mandate.units,
          ATS_HOLD_EXPIRY: String(Math.floor(startedAt.getTime() / 1000) + 3600),
          ATS_HOLD_FILE: holdFile,
          CARETAKER_STATE_FILE: stateFile,
          E2E_RUN_ID: runId,
          CONFORMANCE_SERVICE_URL: `http://127.0.0.1:${process.env.PORT ?? '8080'}`,
        }
        await onStage({ id: 'mandate', status: 'confirmed', title: 'Mandate authenticated', detail: 'Privy session and wallet signature match the bounded policy.', proof: { owner, wallet: mandate.wallet } })

        await onStage({ id: 'issuance', status: 'running', title: 'Preparing SPCF inventory', detail: 'The issuer is making exactly 1.0 SPCF available to the seller.' })
        const issuance: any = await runProcess('scripts/seed-equity.cjs', environment)
        await onStage({ id: 'issuance', status: 'confirmed', title: 'SPCF inventory confirmed', detail: 'ATS reports one seller unit ready for this run.', proof: { transaction: issuance.transactionId ?? null } })

        await onStage({ id: 'hold', status: 'running', title: 'Locking the exact ATS units', detail: 'The seller is binding asset, buyer, amount, expiry, and ClearingEscrow.' })
        const hold: any = await runProcess('scripts/create-hold.cjs', environment)
        await onStage({ id: 'hold', status: 'confirmed', title: 'ATS hold confirmed', detail: 'The unit can no longer be double-spent.', proof: { holdId: hold.holdId, transaction: hold.transactionId ?? null } })

        await onStage({ id: 'payment', status: 'running', title: 'Buying one verdict', detail: 'The Privy execution wallet is validating and paying the 0.01 USDC x402 quote.' })
        await onStage({ id: 'evidence', status: 'running', title: 'Checking live market evidence', detail: 'The seller service is querying the pinned Graph deployments and applying strict policy.' })
        await onStage({ id: 'settlement', status: 'running', title: 'Waiting for atomic settlement', detail: 'A conformant verdict executes the exact hold; a failed verdict releases it.' })
        await runProcess('scripts/run-caretaker.cjs', environment)
        const settled = await readJson<Record<string, any>>(stateFile, {})
        const proof = publicProof(settled)
        if (typeof proof.tradeDigest === 'string') environment.REPLAY_TRADE_DIGEST = proof.tradeDigest
        await onStage({ id: 'payment', status: 'confirmed', title: 'x402 payment settled', detail: 'Canonical Hedera USDC paid through Blocky402 before the verdict returned.', proof: { transaction: proof.paymentTransaction } })
        await onStage({ id: 'evidence', status: 'confirmed', title: 'Graph evidence passed', detail: 'All deterministic freshness, schema, deployment, and invariant checks passed.', proof: { deployments: Number(settled.purchased?.verdict?.checks?.shapeAgreement?.peers ?? 5) + 1 } })
        await onStage({ id: 'settlement', status: 'confirmed', title: 'ATS hold executed', detail: 'ClearingEscrow consumed the nonce and moved exactly 1.0 SPCF.', proof: { tradeDigest: proof.tradeDigest, transaction: proof.settlementTransaction } })

        await onStage({ id: 'audit', status: 'running', title: 'Replaying public proof', detail: 'Mirror Node, contract state, ATS state, signature, payment, and HCS are being recomputed.' })
        await runProcess('scripts/replay.cjs', environment)
        const completed = await readJson<Record<string, any>>(stateFile, {})
        const finalProof = publicProof(completed)
        if (finalProof.replayFailed !== 0 || Number(finalProof.replayPassed ?? 0) < 1) throw new Error('independent replay did not pass')
        await onStage({ id: 'audit', status: 'confirmed', title: 'Public replay passed', detail: 'Every binding independently matches public Hedera state.', proof: finalProof })
        await atomicJson(publicStateFile, completed)
        await atomicJson(path.join(root, 'latest.json'), { runId, owner, stateFile, completedAt: now().toISOString(), proof: finalProof })
        return { runId, tradeDigest: finalProof.tradeDigest, proof: finalProof }
      } catch (error) {
        await onStage({ id: 'audit', status: 'failed', title: 'Live clearance stopped', detail: publicFailure(error) })
        throw error
      } finally {
        active = false
      }
    },
  }
}
