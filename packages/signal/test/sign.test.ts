import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import { anchorDigest, canonicalJSON, signalHash, signVerdict, verifyVerdict } from '../src/sign.ts'
import type { VerdictPayload } from '../src/types.ts'

const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8417f4603b6b78690d'

function payload(): VerdictPayload {
  return {
    v: 1,
    requestId: '00000000-0000-4000-8000-000000000001',
    issuedAt: '2026-09-13T09:14:02Z',
    standard: 'messari/lending-v3.1',
    subject: { protocol: 'aave-v3', network: 'base', deploymentId: 'D7mapexM' },
    policy: { pinnedCid: 'QmPinned', lagBoundBlocks: 50 },
    checks: {
      cidMatch: { pass: true, served: 'QmPinned', pinned: 'QmPinned' },
      indexingErrors: { pass: true, value: false },
      freshness: { pass: true, lagBlocks: 12, bound: 50, block: 100, headBlock: 112 },
      shapeAgreement: {
        pass: true,
        peers: 3,
        fieldsCompared: 11,
        mismatches: 0,
        missingByDeployment: {},
        extraByDeployment: {},
      },
      invariants: { pass: true, checked: 4, violations: [] },
    },
    verdict: 'CONFORMANT',
    evidence: { queryHash: `0x${'11'.repeat(32)}`, queryText: '{ _meta { deployment } }', block: 100 },
    signer: new Wallet(PRIVATE_KEY).address,
  }
}

test('canonical JSON recursively sorts keys and follows JSON array semantics', () => {
  assert.equal(canonicalJSON({ z: 1, a: { d: 4, c: 3 }, omitted: undefined }), '{"a":{"c":3,"d":4},"z":1}')
  assert.equal(canonicalJSON([1, undefined, Number.NaN]), '[1,null,null]')
})

test('canonical signing round trip survives key reordering', () => {
  const unsigned = payload()
  const signed = signVerdict(unsigned, PRIVATE_KEY)
  const reordered = {
    signature: signed.signature,
    ...Object.fromEntries(Object.entries(unsigned).reverse()),
  } as unknown as typeof signed

  assert.equal(signalHash(reordered), signalHash(unsigned))
  assert.equal(verifyVerdict(reordered).ok, true)
  assert.equal(signed.signature.length, 132)
})

test('tampering invalidates a signed verdict', () => {
  const signed = signVerdict(payload(), PRIVATE_KEY)
  const tampered = { ...signed, verdict: 'NON_CONFORMANT' as const }
  assert.equal(verifyVerdict(tampered).ok, false)
})

test('signer must correspond to the signing key', () => {
  const unsigned = { ...payload(), signer: Wallet.createRandom().address }
  assert.throws(() => signVerdict(unsigned, PRIVATE_KEY), /does not match private key/)
})

test('anchor digest is deterministic and domain fields affect it', () => {
  const args = {
    paymentTxId: '0.0.123@1.2',
    signalHash: `0x${'22'.repeat(32)}`,
    opCalldataHash: `0x${'33'.repeat(32)}`,
    verdict: 'CONFORMANT' as const,
    ts: '2026-09-13T09:14:05Z',
  }
  assert.equal(anchorDigest(args), anchorDigest({ ...args }))
  assert.notEqual(anchorDigest(args), anchorDigest({ ...args, verdict: 'STALE' }))
})
