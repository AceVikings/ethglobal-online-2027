'use strict'

const { keccak256, toUtf8Bytes } = require('ethers')

const VERDICT_CODE = { CONFORMANT: 0, NON_CONFORMANT: 1, STALE: 2, DISAGREEMENT: 3 }

async function decideAndAct(input, deps) {
  const purchased = await deps.buyVerdict(input.request)
  const verified = await deps.verifyVerdict(purchased.verdict)
  if (!verified.ok) throw new Error(`Verdict signature mismatch; recovered ${verified.recovered}`)

  const hash = await deps.signalHash(purchased.verdict)
  const conformant = purchased.verdict.verdict === 'CONFORMANT'
  let operation
  if (conformant) {
    const unblock = await deps.controlList.unblock(input.recipientId)
    const transfer = await deps.executeTransfer(input.operation)
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
  const hcs = await deps.anchorHcs(message)
  const gate = deps.recordGate ? await deps.recordGate({
    signalHash: hash, verdictCode: VERDICT_CODE[purchased.verdict.verdict], opHash: opCalldataHash,
    paymentRef, signature: purchased.verdict.signature,
  }) : null
  return { purchased, operation, hcs, gate, anchor: message }
}

module.exports = { VERDICT_CODE, decideAndAct }
