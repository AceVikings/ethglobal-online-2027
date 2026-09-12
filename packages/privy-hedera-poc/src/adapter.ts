import type { PaymentRequirements } from '@x402/core/types'
import {
  AccountId,
  Client,
  Hbar,
  PublicKey,
  TokenId,
  TransactionId,
  TransferTransaction,
} from '@hiero-ledger/sdk'
import { computeAddress, getBytes, getAddress, keccak256, Signature, SigningKey } from 'ethers'
import { PrivyClient, type PrivyWallet } from './client.ts'

export type PrivyRawSign = (hash: `0x${string}`) => Promise<`0x${string}`>

export interface PrivyHederaSignerConfig {
  accountId: string
  /** Compressed secp256k1 public key returned with a Privy Ethereum server wallet. */
  publicKey: string
  rawSign: PrivyRawSign
  network?: 'hedera:testnet' | 'hedera:mainnet'
}

export interface PrivyBackedHederaSignerConfig {
  accountId: string
  wallet: PrivyWallet
  client: PrivyClient
  network?: 'hedera:testnet' | 'hedera:mainnet'
}

/**
 * Converts Privy's compact secp256k1_sign response into the signature bytes
 * Hedera places in SignaturePair.ECDSASecp256k1.
 */
export function decodePrivyCompactSignature(signature: string): Uint8Array {
  const bytes = getBytes(signature)
  if (bytes.length !== 64 && bytes.length !== 65) {
    throw new Error(`Privy secp256k1_sign must return a 64- or 65-byte signature, got ${bytes.length}`)
  }
  if (bytes.length === 65 && ![0, 1, 27, 28].includes(bytes[64]!)) {
    throw new Error(`Privy secp256k1_sign returned an invalid recovery byte ${bytes[64]}`)
  }
  return bytes.subarray(0, 64)
}

/** Recover the wallet's compressed secp256k1 key from Privy's r||s response. */
export function recoverPrivyCompressedPublicKey(
  hash: `0x${string}`,
  compactSignature: string,
  walletAddress: string,
): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('hash must be a 32-byte 0x-prefixed hex string')
  const serialized = getBytes(compactSignature)
  const bytes = decodePrivyCompactSignature(compactSignature)
  const r = `0x${Buffer.from(bytes.subarray(0, 32)).toString('hex')}`
  const s = `0x${Buffer.from(bytes.subarray(32)).toString('hex')}`
  let expectedAddress: string
  try {
    expectedAddress = getAddress(walletAddress)
  } catch {
    throw new Error('Privy wallet address is not a valid Ethereum address')
  }

  const recoveryByte = serialized.length === 65 ? serialized[64]! : undefined
  const parities: readonly (0 | 1)[] = recoveryByte === undefined
    ? [0, 1]
    : [recoveryByte === 0 || recoveryByte === 27 ? 0 : 1]
  for (const yParity of parities) {
    try {
      const recovered = SigningKey.recoverPublicKey(hash, Signature.from({ r, s, yParity }))
      if (getAddress(computeAddress(recovered)) === expectedAddress) {
        return SigningKey.computePublicKey(recovered, true)
      }
    } catch {
      // Only one recovery parity can correspond to the wallet address.
    }
  }
  throw new Error('Privy signature does not match the wallet address')
}

/**
 * Resolves the public key without exporting private key material, then wires
 * future Hedera body hashes directly to Privy's server-wallet signer.
 */
export async function createPrivyBackedHederaSigner(config: PrivyBackedHederaSignerConfig) {
  const probeHash = keccak256(Buffer.from('clearing-desk:privy-hedera-public-key:v1')) as `0x${string}`
  const probeSignature = await config.client.signHash(config.wallet.id, probeHash)
  const publicKey = recoverPrivyCompressedPublicKey(probeHash, probeSignature, config.wallet.address)
  return createPrivyHederaSigner({
    accountId: config.accountId,
    publicKey,
    network: config.network,
    rawSign: hash => config.client.signHash(config.wallet.id, hash),
  })
}

/**
 * x402 ClientHederaSigner backed only by Privy's secp256k1_sign primitive.
 * Privy signs the Keccak-256 digest; Hiero injects the returned r||s bytes into
 * each frozen node-specific TransactionBody.
 */
export function createPrivyHederaSigner(config: PrivyHederaSignerConfig) {
  const accountId = AccountId.fromString(config.accountId)
  const publicKey = PublicKey.fromStringECDSA(config.publicKey.replace(/^0x/, ''))
  const network = config.network ?? 'hedera:testnet'

  return {
    accountId: accountId.toString(),
    async createPartiallySignedTransferTransaction(requirements: PaymentRequirements): Promise<string> {
      if (requirements.network !== network) {
        throw new Error(`payment network ${requirements.network} does not match signer network ${network}`)
      }
      const feePayer = requirements.extra?.feePayer
      if (typeof feePayer !== 'string') throw new Error('feePayer is required')
      const amount = BigInt(requirements.amount)
      if (amount <= 0n) throw new Error('amount must be greater than zero')

      const payTo = AccountId.fromString(requirements.payTo)
      const transaction = new TransferTransaction()
      if (requirements.asset === '0.0.0') {
        transaction.addHbarTransfer(accountId, Hbar.fromTinybars((-amount).toString()))
        transaction.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()))
      } else {
        const tokenId = TokenId.fromString(requirements.asset)
        transaction.addTokenTransfer(tokenId, accountId, -amount)
        transaction.addTokenTransfer(tokenId, payTo, amount)
      }
      transaction.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)))

      const client = network === 'hedera:mainnet' ? Client.forMainnet() : Client.forTestnet()
      try {
        transaction.freezeWith(client)
        await transaction.signWith(publicKey, async bodyBytes => {
          const hash = keccak256(bodyBytes) as `0x${string}`
          return decodePrivyCompactSignature(await config.rawSign(hash))
        })
        return Buffer.from(transaction.toBytes()).toString('base64')
      } finally {
        client.close()
      }
    },
  }
}
