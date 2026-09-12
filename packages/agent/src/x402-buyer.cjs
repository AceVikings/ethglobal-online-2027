'use strict'

async function createPaidFetch({ accountId, privateKey, network = 'hedera:testnet' }) {
  const { x402Client } = require('@x402/core/client')
  const { wrapFetchWithPayment } = require('@x402/fetch')
  const { createClientHederaSigner, PrivateKey } = require('@x402/hedera')
  const { ExactHederaScheme } = require('@x402/hedera/exact/client')
  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(privateKey), { network })
  const client = new x402Client().register('hedera:*', new ExactHederaScheme(signer))
  return wrapFetchWithPayment(fetch, client)
}

function paymentReference(response) {
  const encoded = response.headers.get('payment-response') || response.headers.get('x-payment-response')
  if (!encoded) return 'unreported'
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return value.transaction || value.transactionId || value.txHash || encoded
  } catch {
    return encoded
  }
}

async function buyVerdict({ url, body, paidFetch }) {
  const response = await paidFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Verdict service returned ${response.status}: ${await response.text()}`)
  return { verdict: await response.json(), paymentTxId: paymentReference(response) }
}

module.exports = { createPaidFetch, buyVerdict, paymentReference }
