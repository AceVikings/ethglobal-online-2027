export type LiveMandate = {
  version: 1
  owner: string
  wallet: string
  network: 'hedera:testnet'
  asset: 'SPCF'
  units: '1.0'
  maxDecisionFee: '0.01 USDC'
  policy: 'strict-market-health'
  expiresAt: string
  nonce: string
}

export type SignedLiveMandate = {
  mandate: LiveMandate
  signature: string
}

export function liveMandateMessage(mandate: LiveMandate): string {
  return [
    'Clearing AI mandate',
    `Version: ${mandate.version}`,
    `Owner: ${mandate.owner}`,
    `Wallet: ${mandate.wallet}`,
    `Network: ${mandate.network}`,
    `Asset: ${mandate.asset}`,
    `Units: ${mandate.units}`,
    `Max decision fee: ${mandate.maxDecisionFee}`,
    `Policy: ${mandate.policy}`,
    `Expires: ${mandate.expiresAt}`,
    `Nonce: ${mandate.nonce}`,
  ].join('\n')
}
