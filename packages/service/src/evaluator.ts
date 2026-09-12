import type { EvaluatorModule, VerdictEvaluator } from './types.ts'

const REQUIRED = ['GRAPH_STUDIO_KEY'] as const

/** Graph credentials are read only in this seller-side loader. */
export async function evaluatorFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<VerdictEvaluator> {
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length) throw new Error(`missing evaluator configuration: ${missing.join(', ')}`)

  const module = (await import(env.CONFORMANCE_EVALUATOR_MODULE ?? '@desk/evaluator')) as EvaluatorModule
  if (typeof module.createVerdictEvaluator !== 'function') {
    throw new Error('evaluator module must export createVerdictEvaluator(config)')
  }

  return module.createVerdictEvaluator({
    graphApiKey: env.GRAPH_STUDIO_KEY!,
    graphGatewayUrl: env.GRAPH_GATEWAY_BASE ?? 'https://gateway.thegraph.com/api/deployments/id',
    graphMcpUrl: env.GRAPH_MCP_URL ?? 'https://subgraphs.mcp.thegraph.com/sse',
  })
}
