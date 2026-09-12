'use strict'

async function createPaidFetch({
  accountId, privateKey, expectedPayTo, expectedAsset = '0.0.429274',
  expectedFeePayer = '0.0.7162784', maxAmountPerPayment = '$1', network = 'hedera:testnet',
}) {
  const { x402Client } = require('@x402/core/client')
  const { wrapFetchWithPayment } = require('@x402/fetch')
  const { createClientHederaSigner, isValidHederaEntityId, PrivateKey } = require('@x402/hedera')
  const { ExactHederaScheme } = require('@x402/hedera/exact/client')
  for (const [name, value] of Object.entries({ accountId, expectedPayTo, expectedAsset, expectedFeePayer })) {
    if (!isValidHederaEntityId(value)) throw new Error(`${name} must be a Hedera entity ID`)
  }
  const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(privateKey), { network })
  const client = x402Client.fromConfig({
    schemes: [{ network, client: new ExactHederaScheme(signer) }],
    spendControls: { maxAmountPerPayment },
    policies: [(_version, requirements) => requirements.filter((requirement) =>
      requirement.scheme === 'exact' && requirement.network === network &&
      requirement.payTo === expectedPayTo && requirement.asset === expectedAsset &&
      requirement.extra?.feePayer === expectedFeePayer)],
  })
  return wrapFetchWithPayment(fetch, client)
}

function paymentReference(response) {
  const direct = response.headers.get('x-payment-ref')
  if (direct) return direct
  const encoded = response.headers.get('payment-response') || response.headers.get('x-payment-response')
  if (!encoded) return null
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return value.transaction || value.transactionId || value.txHash || encoded
  } catch {
    return null
  }
}

async function buyVerdict({ url, body, paidFetch }) {
  const response = await paidFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Verdict service returned ${response.status}: ${await response.text()}`)
  const paymentTxId = paymentReference(response)
  if (!paymentTxId) throw new Error('Verdict response omitted x402 payment reference')
  return { verdict: await response.json(), paymentTxId }
}

module.exports = { createPaidFetch, buyVerdict, paymentReference }
