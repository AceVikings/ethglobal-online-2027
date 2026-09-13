import { PrivyClient } from '@privy-io/node'
import { createVerdictServer } from './server.ts'
import { evaluatorFromEnv } from './evaluator.ts'
import { paymentGateFromEnv } from './x402.ts'
import { createFileTradeReadModel } from './trades.ts'
import { createPublicTradeVerifier } from './verification.ts'
import { createLiveClearanceRunner } from './live-clearance.ts'
import { Firestore } from '@google-cloud/firestore'
import { createFirestoreVaultRepository } from './repositories/firestore.ts'
import { createMemoryVaultRepository } from './repositories/memory.ts'
import { createPersonalVaultService } from './personal.ts'
import { verifyMcpServiceToken } from './auth.ts'

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
const tradeVerifier = createPublicTradeVerifier({
  graphApiKey: process.env.GRAPH_STUDIO_KEY!,
  graphGatewayUrl: process.env.GRAPH_GATEWAY_BASE,
  mirrorNodeUrl: process.env.HEDERA_MIRROR_NODE,
})
const liveEnabled = process.env.LIVE_CLEARANCE_ENABLED === 'true'
const privyAppId = process.env.PRIVY_APP_ID
const privyAppSecret = process.env.PRIVY_APP_SECRET
if (liveEnabled && (!privyAppId || !privyAppSecret)) {
  throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET are required when live clearance is enabled')
}
const privy = privyAppId && privyAppSecret ? new PrivyClient({ appId: privyAppId, appSecret: privyAppSecret }) : null
const repositoryMode = process.env.VAULT_REPOSITORY ?? (process.env.K_SERVICE ? 'firestore' : 'memory')
if (!['firestore', 'memory'].includes(repositoryMode)) throw new Error('VAULT_REPOSITORY must be firestore or memory')
const vaultRepository = repositoryMode === 'firestore'
  ? createFirestoreVaultRepository(new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT }))
  : createMemoryVaultRepository()
const personalVaults = createPersonalVaultService(vaultRepository)
const mcpTokenConfig = process.env.CONFORMANCE_MCP_TOKEN_SECRET ? {
  secret: process.env.CONFORMANCE_MCP_TOKEN_SECRET,
  issuer: process.env.CONFORMANCE_MCP_ISSUER ?? 'https://conformance-desk.invalid',
  audience: process.env.CONFORMANCE_MCP_AUDIENCE ?? 'http://127.0.0.1:4020/mcp',
} : null
const server = createVerdictServer({
  evaluator, paymentGate, signingKey, trades, tradeVerifier,
  liveClearance: liveEnabled ? createLiveClearanceRunner() : undefined,
  verifyAccessToken: privy ? async (token) => {
    try {
      const claim = await privy.utils().auth().verifyAccessToken(token)
      return { userId: claim.user_id }
    } catch (error) {
      if (!mcpTokenConfig) throw error
      return verifyMcpServiceToken(token, mcpTokenConfig)
    }
  } : mcpTokenConfig ? async token => verifyMcpServiceToken(token, mcpTokenConfig) : undefined,
  corsAllowedOrigin: process.env.CORS_ALLOWED_ORIGIN,
  vaultRepository,
  personalVaults,
  mcp: mcpTokenConfig ? {
    ...mcpTokenConfig,
    backendUrl: process.env.CONFORMANCE_SERVICE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '4020'}`,
  } : undefined,
})
const port = Number(process.env.PORT ?? 4020)
const host = process.env.HOST ?? '127.0.0.1'
server.listen(port, host, () => console.log(`conformance seller listening on ${host}:${port}`))
