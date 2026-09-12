import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import {
  canonicalJSON,
  clearingAuthorizationHash,
  clearingEvidenceHash,
  clearingPolicyHash,
  signalHash,
  signClearingAuthorization,
  signVerdict,
  verifyClearingAuthorization,
  verifyVerdict,
} from '../src/sign.ts'
import type { ClearingAuthorization, VerdictPayload } from '../src/types.ts'

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

test('clearing authorization matches the ClearingEscrow EIP-712 digest vector', () => {
  const authorization: ClearingAuthorization = {
    chainId: '296',
    verifyingContract: `0x${'11'.repeat(20)}`,
    security: `0x${'22'.repeat(20)}`,
    partition: `0x${'00'.repeat(31)}01`,
    seller: `0x${'33'.repeat(20)}`,
    buyer: `0x${'44'.repeat(20)}`,
    amount: '25',
    holdId: '7',
    holdExpiry: '1789300000',
    action: 1,
    policyHash: `0x${'66'.repeat(32)}`,
    evidenceHash: `0x${'77'.repeat(32)}`,
    paymentRef: `0x${'88'.repeat(32)}`,
    issuedAt: '1789200000',
    authorizationExpiry: '1789200300',
    nonce: `0x${'99'.repeat(32)}`,
  }
  // Generated independently from ClearingEscrow's Solidity type hash, domain
  // separator, and abi.encode field order. This catches JS/contract drift.
  assert.equal(
    clearingAuthorizationHash(authorization),
    '0x555ae2cde972b31112e9ba9bb67da571d4062ba63268a17ae11d97014ea639b4',
  )
  const signature = signClearingAuthorization(authorization, PRIVATE_KEY)
  assert.equal(verifyClearingAuthorization(authorization, signature, new Wallet(PRIVATE_KEY).address).ok, true)
  assert.notEqual(
    verifyClearingAuthorization({ ...authorization, amount: '26' }, signature, new Wallet(PRIVATE_KEY).address).ok,
    true,
  )
})

test('policy and derived-evidence commitments are canonical and tamper evident', () => {
  const policy = { pinnedCid: null, lagBoundBlocks: 50 }
  assert.equal(
    clearingPolicyHash('messari/lending-v3.1', policy),
    clearingPolicyHash('messari/lending-v3.1', { lagBoundBlocks: 50, pinnedCid: null }),
  )
  const evidence = {
    standard: payload().standard,
    subject: payload().subject,
    policy,
    checks: payload().checks,
    verdict: payload().verdict,
    evidence: payload().evidence,
  }
  assert.notEqual(clearingEvidenceHash(evidence), clearingEvidenceHash({ ...evidence, verdict: 'STALE' }))
})
