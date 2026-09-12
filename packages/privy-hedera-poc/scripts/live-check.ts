import { keccak256, toUtf8Bytes } from 'ethers'
import { recoverPrivyCompressedPublicKey } from '../src/adapter.ts'
import { PrivyClient } from '../src/client.ts'

function required(name: 'PRIVY_APP_ID' | 'PRIVY_APP_SECRET' | 'PRIVY_WALLET_ID'): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const client = new PrivyClient({
  appId: required('PRIVY_APP_ID'),
  appSecret: required('PRIVY_APP_SECRET'),
})
const wallet = await client.getWallet(required('PRIVY_WALLET_ID'))
const probeHash = keccak256(toUtf8Bytes('clearing-desk:privy-live-check:v1')) as `0x${string}`
const signature = await client.signHash(wallet.id, probeHash)
const publicKey = recoverPrivyCompressedPublicKey(probeHash, signature, wallet.address)

// IDs, credentials, hashes, and signatures remain out of output. The address and
// recovered key are public values, but redact them here to keep logs minimal.
console.log(
  JSON.stringify({
    ok: true,
    chainType: wallet.chain_type,
    addressSuffix: wallet.address.slice(-6),
    publicKeyPrefix: publicKey.slice(0, 8),
    broadcast: false,
  }),
)
