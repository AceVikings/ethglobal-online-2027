export const MESSARI_LENDING_STANDARD = 'messari/lending-v3.1' as const

export type DeploymentHealth = 'healthy' | 'thin-indexer-set'

export interface LendingDeployment {
  protocol: 'aave-v3' | 'compound-v3' | 'sparklend'
  network: 'ethereum' | 'polygon' | 'arbitrum' | 'base'
  deploymentId: string
  standard: typeof MESSARI_LENDING_STANDARD
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
    deploymentId: 'JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk',
    standard: MESSARI_LENDING_STANDARD,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'aave-v3',
    network: 'polygon',
    deploymentId: '6yuf1C49aWEscgk5n9D1DekeG1BCk5Z9imJYJT3sVmAT',
    standard: MESSARI_LENDING_STANDARD,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'aave-v3',
    network: 'arbitrum',
    deploymentId: '4xyasjQeREe7PxnF6wVdobZvCw5mhoHZq3T7guRpuNPf',
    standard: MESSARI_LENDING_STANDARD,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'aave-v3',
    network: 'base',
    deploymentId: 'D7mapexM5ZsQckLJai2FawTKXJ7CqYGKM8PErnS3cJi9',
    standard: MESSARI_LENDING_STANDARD,
    health: {
      status: 'thin-indexer-set',
      checkedAt: '2026-09-12',
      note: 'Low allocation observed during architecture verification; recheck before demo.',
    },
  },
  {
    protocol: 'compound-v3',
    network: 'ethereum',
    deploymentId: 'AwoxEZbiWLvv6e3QdvdMZw4WDURdGbvPfHmZRc8Dpfz9',
    standard: MESSARI_LENDING_STANDARD,
    health: { status: 'healthy', checkedAt: '2026-09-12' },
  },
  {
    protocol: 'sparklend',
    network: 'ethereum',
    deploymentId: 'GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si',
    standard: MESSARI_LENDING_STANDARD,
    health: {
      status: 'thin-indexer-set',
      checkedAt: '2026-09-12',
      note: 'Low allocation observed during architecture verification; recheck before demo.',
    },
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
