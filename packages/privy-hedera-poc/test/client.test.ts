import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import test from 'node:test'
import { Transaction } from '@hiero-ledger/sdk'
import type { PaymentRequirements } from '@x402/core/types'
import { ExactHederaScheme } from '@x402/hedera/exact/client'
import { computeAddress, keccak256, Signature, SigningKey } from 'ethers'
import {
  createPrivyBackedHederaSigner,
  recoverPrivyCompressedPublicKey,
} from '../src/adapter.ts'
import { PrivyApiError, PrivyClient } from '../src/client.ts'

const appId = 'test-app-id'
const appSecret = 'test-app-secret'
const walletId = 'test-wallet-id'
const externalId = 'clearing-desk-agent'
const privateKey = `0x${'22'.repeat(32)}`
const signingKey = new SigningKey(privateKey)
const walletAddress = computeAddress(SigningKey.computePublicKey(privateKey, true))

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function withMockServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => void handler(request, response))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server has no TCP address')
  try {
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}

function client(baseUrl: string): PrivyClient {
  return new PrivyClient({ appId, appSecret, baseUrl })
}

test('get-or-create uses external ID and sends required Privy authentication headers', async () => {
  const requests: Array<{ method?: string; url?: string; authorization?: string; appId?: string; body?: unknown }> = []
  await withMockServer(async (request, response) => {
    const record = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      appId: request.headers['privy-app-id'] as string | undefined,
      body: request.method === 'POST' ? await readJson(request) : undefined,
    }
    requests.push(record)
    if (request.method === 'GET') return json(response, 404, { error: 'not_found' })
    return json(response, 200, {
      id: walletId,
      address: walletAddress,
      chain_type: 'ethereum',
      external_id: externalId,
    })
  }, async baseUrl => {
    const wallet = await client(baseUrl).getOrCreateWalletByExternalId(externalId, 'Clearing agent')
    assert.equal(wallet.id, walletId)
  })

  const expectedAuthorization = `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`
  assert.deepEqual(requests.map(request => [request.method, request.url]), [
    ['GET', `/v1/wallets/ext_wal_${externalId}`],
    ['POST', '/v1/wallets'],
  ])
  assert.ok(requests.every(request => request.authorization === expectedAuthorization))
  assert.ok(requests.every(request => request.appId === appId))
  assert.deepEqual(requests[1]?.body, {
    chain_type: 'ethereum',
    external_id: externalId,
    display_name: 'Clearing agent',
  })
})

test('raw signing validates the RPC contract and recovers the compressed wallet key', async () => {
  const hash = keccak256(Buffer.from('privy mock server proof')) as `0x${string}`
  await withMockServer(async (request, response) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, `/v1/wallets/${walletId}/rpc`)
    assert.deepEqual(await readJson(request), { method: 'secp256k1_sign', params: { hash } })
    const signature = Signature.from(signingKey.sign(hash))
    json(response, 200, {
      method: 'secp256k1_sign',
      data: { signature: signature.serialized, encoding: 'hex' },
    })
  }, async baseUrl => {
    const signature = await client(baseUrl).signHash(walletId, hash)
    assert.equal(
      recoverPrivyCompressedPublicKey(hash, signature, walletAddress),
      SigningKey.computePublicKey(privateKey, true),
    )
  })
})

test('recovered key is fed into the Hedera signer while every body hash stays remote', async () => {
  let signCalls = 0
  await withMockServer(async (request, response) => {
    const body = await readJson(request)
    const params = body.params as { hash: `0x${string}` }
    const signature = Signature.from(signingKey.sign(params.hash))
    signCalls += 1
    json(response, 200, {
      method: 'secp256k1_sign',
      data: { signature: signature.serialized, encoding: 'hex' },
    })
  }, async baseUrl => {
    const signer = await createPrivyBackedHederaSigner({
      accountId: '0.0.1001',
      wallet: { id: walletId, address: walletAddress, chain_type: 'ethereum' },
      client: client(baseUrl),
    })
    const requirements = {
      scheme: 'exact',
      network: 'hedera:testnet',
      amount: '10000',
      asset: '0.0.0',
      payTo: '0.0.2002',
      maxTimeoutSeconds: 60,
      extra: { feePayer: '0.0.7162784' },
    } as PaymentRequirements
    const payload = await new ExactHederaScheme(signer).createPaymentPayload(2, requirements)
    const transaction = Transaction.fromBytes(
      Buffer.from((payload.payload as { transaction: string }).transaction, 'base64'),
    )
    assert.equal(signingKey.publicKey.length > 0, true)
    assert.equal(transaction.toBytes().length > 0, true)
  })
  assert.ok(signCalls > 1, 'one probe and at least one frozen Hedera body were signed remotely')
})

test('HTTP and malformed signing responses fail closed without exposing provider bodies', async () => {
  await withMockServer((_request, response) => {
    json(response, 401, { error: `denied-${appSecret}` })
  }, async baseUrl => {
    await assert.rejects(
      client(baseUrl).getWallet(walletId),
      error =>
        error instanceof PrivyApiError &&
        error.status === 401 &&
        !error.message.includes(appSecret) &&
        !error.message.includes('denied'),
    )
  })

  await withMockServer((_request, response) => {
    json(response, 200, { method: 'secp256k1_sign', data: { signature: '0x1234', encoding: 'hex' } })
  }, async baseUrl => {
    await assert.rejects(
      client(baseUrl).signHash(walletId, `0x${'01'.repeat(32)}`),
      /invalid secp256k1_sign response/,
    )
  })
})

test('signature recovery rejects a compact signature from a different wallet', () => {
  const hash = keccak256(Buffer.from('wrong wallet proof')) as `0x${string}`
  const signature = Signature.from(signingKey.sign(hash))
  const compact = `0x${signature.r.slice(2)}${signature.s.slice(2)}`
  assert.throws(
    () => recoverPrivyCompressedPublicKey(hash, compact, computeAddress(SigningKey.computePublicKey(`0x${'33'.repeat(32)}`, true))),
    /does not match the wallet address/,
  )
})
