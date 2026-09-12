'use strict'

const { Contract, JsonRpcProvider, Wallet } = require('ethers')
const GATE_ABI = ['function record(bytes32,uint8,bytes32,bytes32,bytes)', 'function recorded(bytes32) view returns (bool)']

function hederaClient(config) {
  const { Client, AccountId, PrivateKey } = require('@hiero-ledger/sdk')
  return Client.forTestnet().setOperator(AccountId.fromString(config.operatorId), PrivateKey.fromStringECDSA(config.operatorKey))
}

async function submitHcsMessage(config, topicId, message) {
  const { TopicMessageSubmitTransaction } = require('@hiero-ledger/sdk')
  const client = hederaClient(config)
  try {
    const response = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(message)).execute(client)
    const receipt = await response.getReceipt(client)
    return { transactionId: response.transactionId.toString(), status: receipt.status.toString() }
  } finally { client.close() }
}

async function recordGate(config, args) {
  const signer = new Wallet(config.operatorKey, new JsonRpcProvider(config.rpcUrl))
  const gate = new Contract(config.gateAddress, GATE_ABI, signer)
  const tx = await gate.record(args.signalHash, args.verdictCode, args.opHash, args.paymentRef, args.signature)
  const receipt = await tx.wait()
  return { transactionHash: receipt.hash }
}

module.exports = { GATE_ABI, hederaClient, submitHcsMessage, recordGate }
