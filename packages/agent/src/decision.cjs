'use strict'

const { randomUUID } = require('node:crypto')

const { keccak256, toUtf8Bytes, verifyTypedData } = require('ethers')

const CLEARING_ACTION = Object.freeze({ APPROVE: 1, DENY: 2 })
const CLEARING_PHASE = Object.freeze({
  PENDING: 'PENDING',
  HOLD_CONFIRMED: 'HOLD_CONFIRMED',
  PAID: 'PAID',
  AUTHORIZED: 'AUTHORIZED',
  SETTLEMENT_SUBMITTED: 'SETTLEMENT_SUBMITTED',
  SETTLED: 'SETTLED',
  COMPLETE: 'COMPLETE',
})

const TRADE_FIELDS = Object.freeze([
  'chainId', 'verifyingContract', 'security', 'partition', 'seller', 'buyer',
  'amount', 'holdId', 'holdExpiry', 'policyHash',
])

const AUTHORIZATION_TYPES = Object.freeze({
  Verdict: [
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
    { name: 'security', type: 'address' },
    { name: 'partition', type: 'bytes32' },
    { name: 'seller', type: 'address' },
    { name: 'buyer', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'holdId', type: 'uint256' },
    { name: 'holdExpiry', type: 'uint256' },
    { name: 'action', type: 'uint8' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'paymentRef', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'authorizationExpiry', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
})

function verifyClearingAuthorization(signed, authorization = signed?.authorization || signed) {
  try {
    const signature = signed?.authorizationSignature || signed?.signature
    if (!signature) throw new Error('Clearing authorization signature is required')
    const recovered = verifyTypedData({
      name: 'AI Clearing Desk', version: '1',
      chainId: authorization.chainId,
      verifyingContract: authorization.verifyingContract,
    }, AUTHORIZATION_TYPES, authorization, signature)
    return { ok: true, recovered }
  } catch (error) {
    return { ok: false, recovered: null, error: error?.message || String(error) }
  }
}

function comparable(value) {
  if (typeof value === 'string' && value.startsWith('0x')) return value.toLowerCase()
  if (typeof value === 'bigint' || typeof value === 'number' || /^\d+$/.test(String(value))) return BigInt(value).toString()
  return String(value)
}

function assertSame(field, actual, expected, label = 'Authorization') {
  if (actual === undefined || expected === undefined || comparable(actual) !== comparable(expected)) {
    throw new Error(`${label} ${field} does not match held trade`)
  }
}

function assertExactHold(hold, trade) {
  if (!hold) throw new Error('Exact ATS hold was not found')
  const mapping = {
    partition: 'partition', seller: 'seller', holdId: 'holdId', amount: 'amount',
    expirationTimestamp: 'holdExpiry', escrow: 'verifyingContract', destination: 'buyer',
  }
  for (const [holdField, tradeField] of Object.entries(mapping)) {
    // Some ATS read adapters do not echo the identifier fields. When present,
    // they are still checked; the lookup itself is keyed by the exact values.
    if (hold[holdField] !== undefined) assertSame(tradeField, hold[holdField], trade[tradeField], 'ATS hold')
  }
  return hold
}

function extractSignedAuthorization(verdict) {
  const authorization = verdict?.authorization || verdict
  const signature = verdict?.authorizationSignature || verdict?.signature
  if (!authorization || !signature) throw new Error('Verdict omitted its authorization or signature')
  return { authorization, signature }
}

function assertActionBoundAuthorization(authorization, trade, paymentTxId, paymentReferenceHash) {
  for (const field of TRADE_FIELDS) assertSame(field, authorization[field], trade[field])
  if (authorization.action !== CLEARING_ACTION.APPROVE && authorization.action !== CLEARING_ACTION.DENY) {
    throw new Error(`Unknown clearing action ${authorization.action}`)
  }
  for (const field of ['evidenceHash', 'paymentRef', 'issuedAt', 'authorizationExpiry', 'nonce']) {
    if (authorization[field] === undefined || authorization[field] === null || authorization[field] === '') {
      throw new Error(`Authorization omitted ${field}`)
    }
  }
  const expectedPaymentRef = paymentReferenceHash
    ? paymentReferenceHash(paymentTxId)
    : keccak256(toUtf8Bytes(paymentTxId))
  if (comparable(authorization.paymentRef) !== comparable(expectedPaymentRef)) {
    throw new Error('Authorization paymentRef does not match the settled x402 payment')
  }
}

async function explainWithoutAuthority(authorization, reasonVerdict, signedVerdict) {
  const requiredRecommendation = authorization.action === CLEARING_ACTION.APPROVE ? 'ACT' : 'REFUSE'
  if (!reasonVerdict) return {
    status: 'disabled', authoritative: false, requiredRecommendation,
  }
  try {
    const explanation = await reasonVerdict(signedVerdict)
    return {
      status: explanation.recommendation === requiredRecommendation ? 'ok' : 'conflict',
      authoritative: false,
      requiredRecommendation,
      ...explanation,
    }
  } catch (error) {
    return {
      status: 'degraded', authoritative: false, requiredRecommendation,
      error: error?.message || String(error),
    }
  }
}

async function persist(state, deps) {
  if (deps.saveState) await deps.saveState(state)
  return state
}

async function transition(state, phase, patch, deps) {
  const occurredAt = (deps.now ? deps.now() : new Date()).toISOString()
  const transitions = [...(state.transitions || []), { phase, occurredAt }]
  Object.assign(state, patch, { phase, transitions, updatedAt: occurredAt })
  return persist(state, deps)
}

async function confirmFinalState(state, input, deps) {
  if (!deps.confirmSettlement) throw new Error('A contract, ATS, and Mirror settlement confirmer is required')
  const expectedLifecycle = state.authorization.action === CLEARING_ACTION.APPROVE ? 'EXECUTED' : 'RELEASED'
  const settlement = await deps.confirmSettlement({
    trade: input.trade,
    hold: state.hold,
    authorization: state.authorization,
    expectedLifecycle,
    submitted: state.submitted || null,
  })
  if (!settlement?.confirmed) throw new Error('Settlement could not be confirmed from contract, ATS, and Mirror state')
  if (settlement.lifecycle && settlement.lifecycle !== expectedLifecycle) {
    throw new Error(`Confirmed lifecycle ${settlement.lifecycle} does not match ${expectedLifecycle}`)
  }
  return { ...settlement, lifecycle: expectedLifecycle }
}

/**
 * Resumable buyer-agent clearing loop.
 *
 * The state must be durably saved by saveState. Every mutation is preceded by
 * an exact-state observation, and a consumed contract nonce is never submitted
 * again. The relayer key only pays and submits; it has no ATS issuer or
 * control-list privilege.
 */
async function runClearingTrade(input, deps, initialState = null) {
  if (!input?.trade) throw new Error('Held trade is required')
  const state = initialState ? structuredClone(initialState) : { phase: CLEARING_PHASE.PENDING, trade: input.trade }
  for (const field of TRADE_FIELDS) assertSame(field, state.trade?.[field], input.trade[field], 'Saved state')
  // A later invocation retries a degraded audit without ever replaying payment
  // or settlement. The first invocation still returns the truthful final asset
  // state immediately when HCS is temporarily unavailable.
  if (state.phase === CLEARING_PHASE.COMPLETE && state.audit?.status === 'DEGRADED') {
    state.phase = CLEARING_PHASE.SETTLED
  }

  while (state.phase !== CLEARING_PHASE.COMPLETE) {
    switch (state.phase) {
      case CLEARING_PHASE.PENDING: {
        let hold = await deps.observeHold(input.trade)
        if (!hold && deps.createHold) {
          await deps.createHold(input.trade)
          hold = await deps.observeHold(input.trade)
        }
        assertExactHold(hold, input.trade)
        await transition(state, CLEARING_PHASE.HOLD_CONFIRMED, { hold }, deps)
        break
      }
      case CLEARING_PHASE.HOLD_CONFIRMED: {
        if (!state.clientRequestId) {
          state.clientRequestId = deps.createClientRequestId ? deps.createClientRequestId() : randomUUID()
          await persist(state, deps)
        }
        const purchased = await deps.buyVerdict({
          ...input.request, trade: input.trade, clientRequestId: state.clientRequestId,
        })
        if (!purchased?.paymentTxId) throw new Error('Paid verdict omitted x402 payment evidence')
        await transition(state, CLEARING_PHASE.PAID, { purchased }, deps)
        break
      }
      case CLEARING_PHASE.PAID: {
        const { authorization, signature } = extractSignedAuthorization(state.purchased.verdict)
        assertActionBoundAuthorization(
          authorization, input.trade, state.purchased.paymentTxId, deps.paymentReferenceHash,
        )
        if (!deps.verifyAuthorization) throw new Error('Authorization signature verifier is required')
        const verified = await deps.verifyAuthorization(state.purchased.verdict, authorization)
        if (!verified?.ok) throw new Error(`Verdict signature mismatch; recovered ${verified?.recovered || 'unknown'}`)
        const expectedSigner = deps.expectedSigner || input.expectedSigner
        if (!expectedSigner) throw new Error('Trusted verdict signer is required')
        if (verified.recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
          throw new Error(`Unexpected verdict signer ${verified.recovered}`)
        }
        const reasoning = await explainWithoutAuthority(authorization, deps.reasonVerdict, state.purchased.verdict)
        await transition(state, CLEARING_PHASE.AUTHORIZED, { authorization, signature, reasoning }, deps)
        break
      }
      case CLEARING_PHASE.AUTHORIZED: {
        if (!deps.isNonceUsed || !deps.submitSettlement) throw new Error('ClearingEscrow adapter is required')
        if (await deps.isNonceUsed(state.authorization.nonce)) {
          const settlement = await confirmFinalState(state, input, deps)
          await transition(state, CLEARING_PHASE.SETTLED, { settlement, lifecycle: settlement.lifecycle }, deps)
          break
        }
        const submitted = await deps.submitSettlement(state.authorization, state.signature)
        await transition(state, CLEARING_PHASE.SETTLEMENT_SUBMITTED, { submitted }, deps)
        break
      }
      case CLEARING_PHASE.SETTLEMENT_SUBMITTED: {
        if (!await deps.isNonceUsed(state.authorization.nonce)) {
          throw new Error('ClearingEscrow transaction finalized without consuming its nonce')
        }
        const settlement = await confirmFinalState(state, input, deps)
        await transition(state, CLEARING_PHASE.SETTLED, { settlement, lifecycle: settlement.lifecycle }, deps)
        break
      }
      case CLEARING_PHASE.SETTLED: {
        const message = {
          t: 'CLEARING_DECISION', v: 2,
          tradeDigest: state.settlement.tradeDigest || state.submitted?.tradeDigest,
          action: state.authorization.action === CLEARING_ACTION.APPROVE ? 'APPROVE' : 'DENY',
          lifecycle: state.lifecycle,
          escrow: state.authorization.verifyingContract,
          security: state.authorization.security,
          paymentTxId: state.purchased.paymentTxId,
          settlementTransactionHash: state.settlement.transactionHash || state.submitted?.transactionHash || null,
          settlementTransactionId: state.settlement.transactionId || null,
        }
        let audit
        try {
          audit = deps.anchorAudit
            ? { ...await deps.anchorAudit(message), status: 'ANCHORED' }
            : { status: 'DISABLED' }
        } catch (error) {
          audit = { status: 'DEGRADED', error: error?.message || String(error) }
        }
        await transition(state, CLEARING_PHASE.COMPLETE, { audit }, deps)
        break
      }
      default:
        throw new Error(`Unknown clearing phase ${state.phase}`)
    }
  }
  return state
}

module.exports = {
  CLEARING_ACTION,
  CLEARING_PHASE,
  AUTHORIZATION_TYPES,
  TRADE_FIELDS,
  assertActionBoundAuthorization,
  assertExactHold,
  runClearingTrade,
  verifyClearingAuthorization,
}
