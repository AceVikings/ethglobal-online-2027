'use strict'

const { keccak256, toUtf8Bytes } = require('ethers')

const VERDICT_CODE = { CONFORMANT: 0, NON_CONFORMANT: 1, STALE: 2, DISAGREEMENT: 3 }

class AnchorFailure extends Error {
  constructor(details) {
    super(`Decision ${details.operation.status.toLowerCase()} but audit anchoring was incomplete`)
    this.name = 'AnchorFailure'
    this.details = details
  }
}

async function decideAndAct(input, deps) {
  const purchased = await deps.buyVerdict(input.request)
  const verified = await deps.verifyVerdict(purchased.verdict)
  if (!verified.ok) throw new Error(`Verdict signature mismatch; recovered ${verified.recovered}`)
  if (!(purchased.verdict.verdict in VERDICT_CODE)) throw new Error(`Unknown verdict ${purchased.verdict.verdict}`)

  const hash = await deps.signalHash(purchased.verdict)
  const conformant = purchased.verdict.verdict === 'CONFORMANT'
  let operation
  if (conformant) {
    const unblock = await deps.controlList.unblock(input.recipientId)
    let transfer
    try {
      transfer = await deps.executeTransfer(input.operation)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      let compensation = null
      try { compensation = await deps.controlList.block(input.recipientId) } catch (compensationError) {
        compensation = { error: compensationError.message }
      }
      failure.operation = { status: 'TRANSFER_FAILED', unblockTxId: unblock.transactionId, compensation }
      throw failure
    }
    operation = { status: 'EXECUTED', unblockTxId: unblock.transactionId, transactionId: transfer.transactionId }
  } else {
    operation = { status: 'REFUSED', reason: purchased.verdict.verdict }
  }

  const ts = deps.now().toISOString()
  const opCalldataHash = keccak256(input.operation.calldata)
  const paymentRef = keccak256(toUtf8Bytes(purchased.paymentTxId))
  const anchor = await deps.buildAnchor({
    paymentTxId: purchased.paymentTxId, signalHash: hash, opCalldataHash,
    verdict: purchased.verdict.verdict, ts,
  })
  const message = {
    t: 'DECISION', v: 1, paymentTxId: purchased.paymentTxId, signalHash: hash,
    verdict: purchased.verdict.verdict, opCalldataHash, op: operation.status, ts, digest: anchor,
  }
  const tasks = [Promise.resolve().then(() => deps.anchorHcs(message))]
  if (deps.recordGate) tasks.push(Promise.resolve().then(() => deps.recordGate({
    signalHash: hash, verdictCode: VERDICT_CODE[purchased.verdict.verdict], opHash: opCalldataHash,
    paymentRef, signature: purchased.verdict.signature,
  })))
  const [hcsResult, gateResult] = await Promise.allSettled(tasks)
  const hcs = hcsResult.status === 'fulfilled' ? hcsResult.value : null
  const gate = !deps.recordGate ? null : gateResult.status === 'fulfilled' ? gateResult.value : null
  const anchorErrors = {
    ...(hcsResult.status === 'rejected' ? { hcs: hcsResult.reason?.message || String(hcsResult.reason) } : {}),
    ...(deps.recordGate && gateResult.status === 'rejected' ? { gate: gateResult.reason?.message || String(gateResult.reason) } : {}),
  }
  if (Object.keys(anchorErrors).length) throw new AnchorFailure({ operation, hcs, gate, anchor: message, anchorErrors })
  return { purchased, operation, hcs, gate, anchor: message }
}

module.exports = { VERDICT_CODE, AnchorFailure, decideAndAct }
