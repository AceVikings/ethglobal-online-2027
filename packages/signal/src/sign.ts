import { keccak256, toUtf8Bytes, SigningKey, computeAddress, solidityPackedKeccak256 } from 'ethers'
import type { VerdictPayload, SignedVerdict, Verdict } from './types.ts'
import { VERDICT_CODE } from './types.ts'

/**
 * Canonical JSON: recursively sorted keys, no whitespace, UTF-8.
 *
 * This is the single most load-bearing function in the repo. The service signs
 * over its output, and the agent, the CLI and scripts/replay.ts all re-derive
 * the hash from it. Any divergence between producer and verifier silently
 * invalidates every signature, so there is exactly ONE implementation and
 * everything imports it from here.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null'
    return JSON.stringify(value)
  }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'bigint') throw new TypeError('BigInt is not valid JSON')
  if (typeof value !== 'object') throw new TypeError(`${typeof value} is not valid canonical JSON`)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined ? 'null' : canonicalJSON(item))).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const body = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]))
    .join(',')
  return '{' + body + '}'
}

/** keccak256 over the canonical payload, excluding any signature field. */
export function signalHash(payload: VerdictPayload): string {
  const { ...rest } = payload as VerdictPayload & { signature?: string }
  delete (rest as { signature?: string }).signature
  return keccak256(toUtf8Bytes(canonicalJSON(rest)))
}

/**
 * Raw secp256k1 over the 32-byte digest — deliberately NOT EIP-191 prefixed,
 * so ConformanceGate._recover can ecrecover it directly.
 */
export function signVerdict(payload: VerdictPayload, privateKey: string): SignedVerdict {
  const key = new SigningKey(privateKey)
  const derivedSigner = computeAddress(key.publicKey)
  if (derivedSigner.toLowerCase() !== payload.signer.toLowerCase()) {
    throw new Error(`Payload signer ${payload.signer} does not match private key ${derivedSigner}`)
  }
  const sig = key.sign(signalHash(payload))
  return { ...payload, signature: sig.serialized }
}

export function verifyVerdict(signed: SignedVerdict): { ok: boolean; recovered: string } {
  const { signature, ...payload } = signed
  const digest = signalHash(payload as VerdictPayload)
  const recovered = computeAddress(SigningKey.recoverPublicKey(digest, signature))
  return { ok: recovered.toLowerCase() === signed.signer.toLowerCase(), recovered }
}

/**
 * The digest each HCS message commits to.
 * Mirrors ConformanceGate.anchorDigest — keep the two in lockstep.
 */
export function anchorDigest(args: {
  paymentTxId: string
  signalHash: string
  opCalldataHash: string
  verdict: Verdict
  ts: string
}): string {
  return solidityPackedKeccak256(
    ['string', 'bytes32', 'bytes32', 'uint8', 'string'],
    [args.paymentTxId, args.signalHash, args.opCalldataHash, VERDICT_CODE[args.verdict], args.ts],
  )
}
