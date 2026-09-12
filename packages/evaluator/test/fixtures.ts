import { LENDING_DEPLOYMENTS, type LendingMarketSnapshot } from '@desk/signal'

export const MARKET_SCHEMA = `
  type Market @entity {
    id: ID!
    totalValueLockedUSD: BigDecimal!
    totalBorrowBalanceUSD: BigDecimal!
    totalDepositBalanceUSD: BigDecimal!
    inputTokenBalance: BigInt!
  }
`

export const VALID_MARKETS: LendingMarketSnapshot[] = [
  {
    id: 'market-one',
    totalValueLockedUSD: '100',
    totalBorrowBalanceUSD: '40',
    totalDepositBalanceUSD: '60',
    inputTokenBalance: '10',
  },
]

export function snapshotFixtures(overrides: Partial<Record<string, Record<string, unknown>>> = {}) {
  return new Map(
    LENDING_DEPLOYMENTS.map((deployment, index) => {
      const base = {
        _meta: {
          deployment: deployment.deploymentId,
          hasIndexingErrors: false,
          block: { number: 1_000 + index, timestamp: 2_000 + index },
        },
        markets: structuredClone(VALID_MARKETS),
      }
      return [deployment.deploymentId, { ...base, ...overrides[deployment.deploymentId] }]
    }),
  )
}
