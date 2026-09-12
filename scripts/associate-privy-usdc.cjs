#!/usr/bin/env node
'use strict'

const { AccountId, Client, PublicKey, TokenAssociateTransaction, TokenId, TransactionId } = require('@hiero-ledger/sdk')
const { getAddress, keccak256 } = require('ethers')
const { executeRequested, output, run } = require('./lib/common.cjs')

function required(env, name) {
  const value = env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function tokenRelationship(mirrorUrl, accountId, tokenId) {
  const url = new URL(`/api/v1/accounts/${accountId}/tokens`, mirrorUrl)
  url.searchParams.set('token.id', tokenId)
  url.searchParams.set('limit', '1')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Mirror Node relationship lookup failed (${response.status})`)
  const body = await response.json()
  return body.tokens?.[0] ?? null
}

async function waitForTokenRelationship(mirrorUrl, accountId, tokenId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const relationship = await tokenRelationship(mirrorUrl, accountId, tokenId)
    if (relationship) return relationship
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error('USDC association succeeded but is not yet visible on Mirror Node')
}

run(async () => {
  const execute = executeRequested()
  const accountId = required(process.env, 'PRIVY_HEDERA_ACCOUNT_ID')
  const tokenId = process.env.HTS_USDC_ID || '0.0.429274'
  const mirrorUrl = process.env.HEDERA_MIRROR_URL || 'https://testnet.mirrornode.hedera.com'
  AccountId.fromString(accountId)
  TokenId.fromString(tokenId)

  const existing = await tokenRelationship(mirrorUrl, accountId, tokenId)
  if (existing) {
    return output({ mode: execute ? 'execute' : 'dry-run', alreadyAssociated: true, accountId, tokenId, balance: existing.balance })
  }
  if (!execute) {
    return output({
      mode: 'dry-run',
      action: 'TokenAssociateTransaction',
      signer: 'Privy remote secp256k1 signer',
      accountId,
      tokenId,
    })
  }

  const { PrivyClient, decodePrivyCompactSignature, recoverPrivyCompressedPublicKey } = await import('@desk/privy-hedera-poc')
  const appId = required(process.env, 'PRIVY_APP_ID')
  const appSecret = required(process.env, 'PRIVY_APP_SECRET')
  const walletId = required(process.env, 'PRIVY_WALLET_ID')
  const privy = new PrivyClient({ appId, appSecret })
  const wallet = await privy.getWallet(walletId)
  const expectedAddress = process.env.PRIVY_WALLET_ADDRESS
  if (expectedAddress && getAddress(wallet.address) !== getAddress(expectedAddress)) {
    throw new Error('Privy wallet address does not match PRIVY_WALLET_ADDRESS')
  }

  const probeHash = keccak256(Buffer.from('clearing-desk:privy-hedera-association:v1'))
  const probeSignature = await privy.signHash(wallet.id, probeHash)
  const publicKey = PublicKey.fromStringECDSA(
    recoverPrivyCompressedPublicKey(probeHash, probeSignature, wallet.address).replace(/^0x/, ''),
  )
  const account = AccountId.fromString(accountId)
  const client = Client.forTestnet()
  try {
    const transaction = new TokenAssociateTransaction()
      .setAccountId(account)
      .setTokenIds([TokenId.fromString(tokenId)])
      .setTransactionId(TransactionId.generate(account))
      .freezeWith(client)
    await transaction.signWith(publicKey, async bodyBytes => {
      const hash = keccak256(bodyBytes)
      return decodePrivyCompactSignature(await privy.signHash(wallet.id, hash))
    })
    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)
    const confirmed = await waitForTokenRelationship(mirrorUrl, accountId, tokenId)
    output({
      mode: 'execute',
      accountId,
      tokenId,
      transactionId: response.transactionId.toString(),
      status: receipt.status.toString(),
      balance: confirmed.balance,
    })
  } finally {
    client.close()
  }
})
