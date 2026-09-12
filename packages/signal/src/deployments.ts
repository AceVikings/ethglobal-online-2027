export const MESSARI_LENDING_STANDARD = 'messari/lending-v3.1' as const

export type DeploymentHealth = 'healthy' | 'thin-indexer-set'

export const REQUIRED_MARKET_FIELDS = [
  'id',
  'totalValueLockedUSD',
  'totalBorrowBalanceUSD',
  'totalDepositBalanceUSD',
  'inputTokenBalance',
] as const

export interface LendingDeployment {
  protocol: 'aave-v3' | 'compound-v3' | 'morpho-aave-v3' | 'sparklend'
  network: 'ethereum' | 'polygon' | 'arbitrum'
  subgraphId: string
  deploymentId: string
  standard: typeof MESSARI_LENDING_STANDARD
  schemaVersion: '3.1.0'
  requiredMarketFields: typeof REQUIRED_MARKET_FIELDS
  verifiedAt: string
  observedBlock: number
  health: {
    status: DeploymentHealth
    checkedAt: '2026-09-12'
    note?: string
  }
}

/**
 * Version-pinned Messari Lending v3.1 deployments used by the conformance sweep.
 * A deployment ID, unlike a mutable subgraph ID, identifies one exact version.
 */
export const LENDING_DEPLOYMENTS = [
  {
    protocol: 'aave-v3',
    network: 'ethereum',
    subgraphId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
    deploymentId: 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd',
    standard: MESSARI_LENDING_STANDARD,
    schemaVersion: '3.1.0',
    requiredMarketFields: REQUIRED_MARKET_FIELDS,
    verifiedAt: '2026-09-12T16:44:21Z',
    observedBlock: 25962609,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'aave-v3',
    network: 'polygon',
    subgraphId: '6yuf1C49aWEscgk5n9D1DekeG1BCk5Z9imJYJT3sVmAT',
    deploymentId: 'QmZvndp7kSUaMZo3W21bLyggU8wpcYG5LXBbGvu21t4cvD',
    standard: MESSARI_LENDING_STANDARD,
    schemaVersion: '3.1.0',
    requiredMarketFields: REQUIRED_MARKET_FIELDS,
    verifiedAt: '2026-09-12T16:44:21Z',
    observedBlock: 93684282,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'aave-v3',
    network: 'arbitrum',
    subgraphId: '4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf',
    deploymentId: 'QmUGh2BNwmiLgd9r81pz7f1khe18fondJUSbsFHfKvhrvk',
    standard: MESSARI_LENDING_STANDARD,
    schemaVersion: '3.1.0',
    requiredMarketFields: REQUIRED_MARKET_FIELDS,
    verifiedAt: '2026-09-12T16:44:21Z',
    observedBlock: 504455193,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'morpho-aave-v3',
    network: 'ethereum',
    subgraphId: 'FKe6ANnWmGPE6hajGLoTgPrVF2jYPHiRu2Jwcg9ZmG9A',
    deploymentId: 'QmVpuZKrjhjHx2hCtpGNaW29ZYq4Xt2GyPLpiMDP2YTAHE',
    standard: MESSARI_LENDING_STANDARD,
    schemaVersion: '3.1.0',
    requiredMarketFields: REQUIRED_MARKET_FIELDS,
    verifiedAt: '2026-09-12T16:44:21Z',
    observedBlock: 25962609,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'compound-v3',
    network: 'ethereum',
    subgraphId: 'AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9',
    deploymentId: 'QmNrQoow7pjM3biRnnhzeCaDYhuEbDyjKCpFeNv2oGXnuK',
    standard: MESSARI_LENDING_STANDARD,
    schemaVersion: '3.1.0',
    requiredMarketFields: REQUIRED_MARKET_FIELDS,
    verifiedAt: '2026-09-12T16:44:21Z',
    observedBlock: 25962609,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'sparklend',
    network: 'ethereum',
    subgraphId: 'GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si',
    deploymentId: 'QmTVumjhubXWP8MeDx5g114MRX99E4Gie5mFqVurttF99X',
    standard: MESSARI_LENDING_STANDARD,
    schemaVersion: '3.1.0',
    requiredMarketFields: REQUIRED_MARKET_FIELDS,
    verifiedAt: '2026-09-12T16:44:21Z',
    observedBlock: 25962609,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
] as const satisfies readonly LendingDeployment[]

export function findDeployment(protocol: string, network: string): LendingDeployment | undefined {
  return LENDING_DEPLOYMENTS.find(
    (deployment) => deployment.protocol === protocol && deployment.network === network,
  )
}

export function requireDeployment(protocol: string, network: string): LendingDeployment {
  const deployment = findDeployment(protocol, network)
  if (!deployment) throw new Error(`Unsupported lending deployment: ${protocol} on ${network}`)
  return deployment
}
