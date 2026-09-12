import assert from 'node:assert/strict'
import test from 'node:test'
import { PrivateKey, PublicKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk'
import type { PaymentRequirements } from '@x402/core/types'
import { inspectHederaTransaction } from '@x402/hedera'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { Signature, SigningKey } from 'ethers'
import { createPrivyHederaSigner, decodePrivyCompactSignature } from '../src/adapter.ts'

const privateKeyHex = `0x${'11'.repeat(32)}`
const signingKey = new SigningKey(privateKeyHex)
const compressedPublicKey = SigningKey.computePublicKey(privateKeyHex, true)
const hederaPublicKey = PublicKey.fromStringECDSA(compressedPublicKey.slice(2))

const requirements = {
  scheme: 'exact',
  network: 'hedera:testnet',
  amount: '10000',
  asset: '0.0.0',
  payTo: '0.0.2002',
  maxTimeoutSeconds: 60,
  extra: { feePayer: '0.0.7162784' },
} as PaymentRequirements

test('Privy-style raw signatures produce a valid x402 Hedera payment payload', async () => {
  const signedHashes: string[] = []
  const signer = createPrivyHederaSigner({
    accountId: '0.0.1001',
    publicKey: compressedPublicKey,
    rawSign: async hash => {
      signedHashes.push(hash)
      const signature = Signature.from(signingKey.sign(hash))
      return `0x${signature.r.slice(2)}${signature.s.slice(2)}`
    },
  })

  const result = await new ExactHederaScheme(signer).createPaymentPayload(2, requirements)
  const transactionBase64 = (result.payload as { transaction: string }).transaction
  const transaction = Transaction.fromBytes(Buffer.from(transactionBase64, 'base64'))
  const inspected = inspectHederaTransaction(transactionBase64)

  assert.ok(signedHashes.length > 0, 'the frozen Hedera body was sent to the raw signer')
  assert.equal(hederaPublicKey.verifyTransaction(transaction), true)
  assert.equal(transaction instanceof TransferTransaction, true)
  assert.equal(inspected.hasNonTransferOperations, false)
  assert.equal(inspected.transactionIdAccountId, '0.0.7162784')
  assert.deepEqual(inspected.hbarTransfers, [
    { accountId: '0.0.1001', amount: '-10000' },
    { accountId: '0.0.2002', amount: '10000' },
  ])
})

test('the raw signer digest matches the digest used by the native Hiero ECDSA signer', async () => {
  const nativePrivateKey = PrivateKey.fromStringECDSA(privateKeyHex.slice(2))
  const signer = createPrivyHederaSigner({
    accountId: '0.0.1001',
    publicKey: compressedPublicKey,
    rawSign: async hash => {
      const signature = Signature.from(signingKey.sign(hash))
      return `0x${signature.r.slice(2)}${signature.s.slice(2)}`
    },
  })
  const transactionBase64 = await signer.createPartiallySignedTransferTransaction(requirements)
  const transaction = Transaction.fromBytes(Buffer.from(transactionBase64, 'base64'))

  for (const signable of transaction.signableNodeBodyBytesList) {
    const bodyBytes = signable.signableTransactionBodyBytes
    assert.equal(nativePrivateKey.publicKey.verify(bodyBytes, nativePrivateKey.sign(bodyBytes)), true)
  }
  assert.equal(nativePrivateKey.publicKey.verifyTransaction(transaction), true)
})

test('rejects signatures that cannot be inserted into Hedera SignaturePair', () => {
  assert.throws(() => decodePrivyCompactSignature(`0x${'aa'.repeat(66)}`), /64- or 65-byte/)
  assert.throws(() => decodePrivyCompactSignature(`0x${'aa'.repeat(64)}02`), /invalid recovery byte/)
})
