import assert from 'node:assert/strict'
import test from 'node:test'
import { Wallet } from 'ethers'
import {
  hashVaultMandate, validateVaultMandate, verifyVaultMandateSignature, type VaultMandateV2,
} from '../src/index.ts'

const key = Wallet.createRandom()

function mandate(): VaultMandateV2 {
  return {
    version: 2, owner: 'did:privy:user-1', receiver: key.address, vaultId: 'vault-1', mandateVersion: 1,
    executor: `0x${'22'.repeat(20)}`, network: 'hedera:testnet', chainId: '296',
    verifyingContract: `0x${'33'.repeat(20)}`, offeringId: 'spcf', security: `0x${'44'.repeat(20)}`,
    partition: `0x${'00'.repeat(31)}01`, unitsBase: '1000000', maxUnitPriceMinor: '2000000',
    maxPrincipalPerRunMinor: '2000000', maxEvidenceFeePerRunMinor: '10000',
    aggregatePrincipalCapMinor: '10000000', aggregateEvidenceFeeCapMinor: '50000',
    aggregateUnitCapBase: '5000000', maxRunCount: 5, policyHash: `0x${'55'.repeat(32)}`,
    triggerMode: 'confirm_each_run', validFrom: '1789200000', expiresAt: '1789300000', nonce: `0x${'66'.repeat(32)}`,
  }
}

test('vault mandate hash is stable and every authority field is binding', async () => {
  const value = mandate()
  const signature = await key.signTypedData(
    { name: 'AI Clearing Desk Vault', version: '2', chainId: 296, verifyingContract: value.verifyingContract },
    { VaultMandate: [
      ['owner', 'string'], ['receiver', 'address'], ['vaultId', 'string'], ['mandateVersion', 'uint256'],
      ['executor', 'address'], ['network', 'string'], ['offeringId', 'string'], ['security', 'address'],
      ['partition', 'bytes32'], ['unitsBase', 'uint256'], ['maxUnitPriceMinor', 'uint256'],
      ['maxPrincipalPerRunMinor', 'uint256'], ['maxEvidenceFeePerRunMinor', 'uint256'],
      ['aggregatePrincipalCapMinor', 'uint256'], ['aggregateEvidenceFeeCapMinor', 'uint256'],
      ['aggregateUnitCapBase', 'uint256'], ['maxRunCount', 'uint256'], ['policyHash', 'bytes32'],
      ['triggerMode', 'string'], ['validFrom', 'uint256'], ['expiresAt', 'uint256'], ['nonce', 'bytes32'],
    ].map(([name, type]) => ({ name, type })) },
    value,
  )
  assert.equal(verifyVaultMandateSignature(value, signature).toLowerCase(), key.address.toLowerCase())
  assert.notEqual(hashVaultMandate(value), hashVaultMandate({ ...value, unitsBase: '1000001' }))
})

test('vault mandate validation rejects unknown fields and invalid bounds', () => {
  assert.deepEqual(validateVaultMandate(mandate()), mandate())
  assert.throws(() => validateVaultMandate({ ...mandate(), surprise: true }), /unknown field/)
  assert.throws(() => validateVaultMandate({ ...mandate(), unitsBase: '0' }), /unitsBase/)
  assert.throws(() => validateVaultMandate({ ...mandate(), aggregateUnitCapBase: '1' }), /aggregateUnitCapBase/)
  assert.throws(() => validateVaultMandate({ ...mandate(), expiresAt: '1789199999' }), /validity window/)
})
