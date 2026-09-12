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
import { getBytes, keccak256 } from 'ethers'

export type PrivyRawSign = (hash: `0x${string}`) => Promise<`0x${string}`>

export interface PrivyHederaSignerConfig {
  accountId: string
  /** Compressed secp256k1 public key returned with a Privy Ethereum server wallet. */
  publicKey: string
  rawSign: PrivyRawSign
  network?: 'hedera:testnet' | 'hedera:mainnet'
}

/**
 * Converts Privy's compact secp256k1_sign response into the signature bytes
 * Hedera places in SignaturePair.ECDSASecp256k1.
 */
export function decodePrivyCompactSignature(signature: string): Uint8Array {
  const bytes = getBytes(signature)
  if (bytes.length !== 64) {
    throw new Error(`Privy secp256k1_sign must return a 64-byte compact signature, got ${bytes.length}`)
  }
  return bytes
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
