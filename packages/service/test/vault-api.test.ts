import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Wallet } from 'ethers'
import { VAULT_MANDATE_TYPES, type VaultMandateV2 } from '@desk/signal'
import { createMemoryVaultRepository } from '../src/repositories/memory.ts'
import { createVerdictServer } from '../src/server.ts'

const repo = createMemoryVaultRepository()
const server = createVerdictServer({
  signingKey: Wallet.createRandom().privateKey,
  paymentGate: { async authorize() { return { ok: false } } },
  async evaluator() { throw new Error('unused') },
  verifyAccessToken: async token => ({ userId: token }), vaultRepository: repo,
})
let base = ''
before(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address'); base = `http://127.0.0.1:${address.port}` })
after(() => server.close())
const auth = (user: string) => ({ authorization: `Bearer ${user}`, 'content-type': 'application/json' })

test('vault API requires auth and never reveals another owner vault', async () => {
  assert.equal((await fetch(`${base}/api/v1/vaults`)).status, 401)
  const created = await fetch(`${base}/api/v1/vaults`, { method: 'POST', headers: auth('user-a'), body: JSON.stringify({ name: 'Income', offeringId: 'spcf', receiver: `0x${'11'.repeat(20)}`, executorRef: 'wallet-1', policy: { maxUtilizationBps: 8000, maxLagBlocks: 50, minTvlUsdMinor: '100', requireSchemaAgreement: true, requireInvariantPass: true } }) })
  assert.equal(created.status, 201)
  const vault = await created.json() as any
  assert.equal((await fetch(`${base}/api/v1/vaults/${vault.id}`, { headers: auth('user-b') })).status, 404)
  const listed = await fetch(`${base}/api/v1/vaults`, { headers: auth('user-a') })
  assert.equal((await listed.json() as any).vaults.length, 1)
})

test('run API returns 202, reuses matching requests, and rejects conflicts', async () => {
  const vault = (await (await fetch(`${base}/api/v1/vaults`, { method: 'POST', headers: auth('runner'), body: JSON.stringify({ name: 'Growth', offeringId: 'spcf', receiver: `0x${'22'.repeat(20)}`, executorRef: 'wallet-2', policy: { maxUtilizationBps: 7000, maxLagBlocks: 20, minTvlUsdMinor: '100', requireSchemaAgreement: true, requireInvariantPass: true } }) })).json()) as any
  const input = { vaultId: vault.id, requestId: 'request-1', mandateHash: `0x${'33'.repeat(32)}`, actor: { kind: 'web', clientId: 'web', requestId: 'request-1' }, snapshot: { unitsBase: '100' } }
  const first = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: auth('runner'), body: JSON.stringify(input) })
  assert.equal(first.status, 202)
  const firstBody = await first.json() as any
  const duplicate = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: auth('runner'), body: JSON.stringify(input) })
  assert.equal((await duplicate.json() as any).runId, firstBody.runId)
  const conflict = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: auth('runner'), body: JSON.stringify({ ...input, snapshot: { unitsBase: '101' } }) })
  assert.equal(conflict.status, 409)
})

test('mandate activation requires the authenticated owner and vault receiver signature', async () => {
  const signer = Wallet.createRandom()
  const vault = (await (await fetch(`${base}/api/v1/vaults`, { method: 'POST', headers: auth('did:privy:owner'), body: JSON.stringify({ name: 'Signed', offeringId: 'spcf', receiver: signer.address, executorRef: 'wallet-3', policy: { maxUtilizationBps: 7000, maxLagBlocks: 20, minTvlUsdMinor: '100', requireSchemaAgreement: true, requireInvariantPass: true } }) })).json()) as any
  const mandate: VaultMandateV2 = {
    version: 2, owner: 'did:privy:owner', receiver: signer.address, vaultId: vault.id, mandateVersion: 1,
    executor: `0x${'22'.repeat(20)}`, network: 'hedera:testnet', chainId: '296', verifyingContract: `0x${'33'.repeat(20)}`,
    offeringId: 'spcf', security: `0x${'44'.repeat(20)}`, partition: `0x${'00'.repeat(31)}01`, unitsBase: '100',
    maxUnitPriceMinor: '200', maxPrincipalPerRunMinor: '200', maxEvidenceFeePerRunMinor: '1', aggregatePrincipalCapMinor: '1000',
    aggregateEvidenceFeeCapMinor: '5', aggregateUnitCapBase: '500', maxRunCount: 5, policyHash: `0x${'55'.repeat(32)}`,
    triggerMode: 'confirm_each_run', validFrom: '1789200000', expiresAt: '1789300000', nonce: `0x${'66'.repeat(32)}`,
  }
  const signature = await signer.signTypedData({ name: 'AI Clearing Desk Vault', version: '2', chainId: 296, verifyingContract: mandate.verifyingContract }, VAULT_MANDATE_TYPES, mandate)
  const activated = await fetch(`${base}/api/v1/vaults/${vault.id}/mandates`, { method: 'POST', headers: auth('did:privy:owner'), body: JSON.stringify({ mandate, signature }) })
  assert.equal(activated.status, 201)
  const wrongOwner = await fetch(`${base}/api/v1/vaults/${vault.id}/mandates`, { method: 'POST', headers: auth('did:privy:other'), body: JSON.stringify({ mandate, signature }) })
  assert.equal(wrongOwner.status, 404)
})
