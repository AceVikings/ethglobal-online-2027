import { createVerdictServer } from './server.ts'
import { evaluatorFromEnv } from './evaluator.ts'
import { paymentGateFromEnv } from './x402.ts'

const signingKey = process.env.VERDICT_SIGNING_KEY
if (!signingKey) throw new Error('VERDICT_SIGNING_KEY is required')

const [evaluator, paymentGate] = await Promise.all([evaluatorFromEnv(), paymentGateFromEnv()])
const server = createVerdictServer({ evaluator, paymentGate, signingKey })
const port = Number(process.env.PORT ?? 4020)
const host = process.env.HOST ?? '127.0.0.1'
server.listen(port, host, () => console.log(`conformance seller listening on ${host}:${port}`))
