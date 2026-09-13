#!/usr/bin/env node
'use strict'

const { AccountId, Client, PrivateKey, Transaction } = require('@hiero-ledger/sdk')
const { executeRequested, output, required } = require('./lib/common.cjs')

function positiveAmount(value) {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error('DVP_ALLOWANCE_BASE_UNITS must be a positive integer')
  return BigInt(value)
}

async function main() {
  const request = {
    ownerAccountId: process.env.PRIVY_HEDERA_ACCOUNT_ID || '<PRIVY_HEDERA_ACCOUNT_ID>',
    tokenId: process.env.HTS_USDC_ID || '0.0.429274',
    spenderAccountId: process.env.CLEARING_ESCROW_ID || '<CLEARING_ESCROW_ID>',
    amount: process.env.DVP_ALLOWANCE_BASE_UNITS || '1000000',
    feePayer: process.env.HEDERA_OPERATOR_ID || '<HEDERA_OPERATOR_ID>',
  }
  if (!executeRequested()) return output({ mode: 'dry-run', request })

  const { PrivyClient, createPrivyBackedHederaSigner } = await import('@desk/privy-hedera-poc')
  const client = new PrivyClient({
    appId: required(process.env, 'PRIVY_APP_ID'),
    appSecret: required(process.env, 'PRIVY_APP_SECRET'),
  })
  const wallet = await client.getWallet(required(process.env, 'PRIVY_WALLET_ID'))
  const signer = await createPrivyBackedHederaSigner({
    accountId: required(process.env, 'PRIVY_HEDERA_ACCOUNT_ID'),
    wallet,
    client,
    network: 'hedera:testnet',
  })
  const operatorId = required(process.env, 'HEDERA_OPERATOR_ID')
  const partiallySigned = await signer.createPartiallySignedTokenAllowanceTransaction({
    tokenId: required(process.env, 'HTS_USDC_ID'),
    spenderAccountId: required(process.env, 'CLEARING_ESCROW_ID'),
    amount: positiveAmount(required(process.env, 'DVP_ALLOWANCE_BASE_UNITS')),
    feePayer: operatorId,
  })
  const hedera = Client.forTestnet().setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringECDSA(required(process.env, 'HEDERA_OPERATOR_KEY')),
  )
  try {
    const transaction = Transaction.fromBytes(Buffer.from(partiallySigned, 'base64'))
    const response = await transaction.execute(hedera)
    const receipt = await response.getReceipt(hedera)
    output({
      mode: 'execute',
      status: receipt.status.toString(),
      transactionId: response.transactionId.toString(),
      ownerAccountId: signer.accountId,
      tokenId: required(process.env, 'HTS_USDC_ID'),
      spenderAccountId: required(process.env, 'CLEARING_ESCROW_ID'),
      amount: required(process.env, 'DVP_ALLOWANCE_BASE_UNITS'),
    })
  } finally {
    hedera.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
