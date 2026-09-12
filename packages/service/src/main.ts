import { createVerdictServer } from './server.ts'
import { evaluatorFromEnv } from './evaluator.ts'
import { paymentGateFromEnv } from './x402.ts'
import { createFileTradeReadModel } from './trades.ts'

const signingKey = process.env.VERDICT_SIGNER_KEY
if (!signingKey) throw new Error('VERDICT_SIGNER_KEY is required')

const [evaluator, paymentGate] = await Promise.all([evaluatorFromEnv(), paymentGateFromEnv()])
const trades = createFileTradeReadModel({
  stateFile: process.env.CARETAKER_STATE_FILE ?? '.context/caretaker-state.json',
  securityId: process.env.ATS_SECURITY_ID,
  topicId: process.env.HCS_TOPIC_ID,
  priceUsd: process.env.X402_PRICE_USDC,
  instrumentName: process.env.EQUITY_NAME,
  instrumentSymbol: process.env.EQUITY_SYMBOL,
  instrumentDecimals: 6,
})
const server = createVerdictServer({ evaluator, paymentGate, signingKey, trades })
const port = Number(process.env.PORT ?? 4020)
const host = process.env.HOST ?? '127.0.0.1'
server.listen(port, host, () => console.log(`conformance seller listening on ${host}:${port}`))
