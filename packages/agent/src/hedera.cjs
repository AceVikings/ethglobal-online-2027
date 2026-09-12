'use strict'

const { JsonRpcProvider, Wallet } = require('ethers')

function hederaClient(config) {
  const { Client, AccountId, PrivateKey } = require('@hiero-ledger/sdk')
  return Client.forTestnet().setOperator(AccountId.fromString(config.operatorId), PrivateKey.fromStringECDSA(config.operatorKey))
}

async function submitHcsMessage(config, topicId, message) {
  const { TopicMessageSubmitTransaction } = require('@hiero-ledger/sdk')
  const client = hederaClient(config)
  try {
    const encoded = JSON.stringify(message)
    if (Buffer.byteLength(encoded) > 1024) throw new Error('HCS audit message exceeds 1024 bytes')
    const response = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(encoded).execute(client)
    const receipt = await response.getReceipt(client)
    const topicSequenceNumber = receipt.topicSequenceNumber?.toString()
    if (!topicSequenceNumber) throw new Error('HCS receipt returned no topic sequence number')
    return { transactionId: response.transactionId.toString(), status: receipt.status.toString(), topicSequenceNumber }
  } finally { client.close() }
}

async function assertRestrictedTopic(config, topicId, fetchImpl = fetch) {
  const url = `${config.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/topics/${topicId}`
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Mirror Node returned ${response.status} for HCS topic`)
  const topic = await response.json()
  if (!topic.submit_key?.key) throw new Error('HCS audit topic must have a submit key')
  return { topicId, restricted: true }
}

function hederaEvmSigner(config) {
  // Hashio rejects eth_getLogs when ethers includes it in a JSON-RPC batch.
  return new Wallet(config.operatorKey, new JsonRpcProvider(config.rpcUrl, undefined, { batchMaxCount: 1 }))
}

async function mirrorContractResult(config, transactionHash, fetchImpl = fetch) {
  const url = `${config.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/contracts/results/${transactionHash}`
  const response = await fetchImpl(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Mirror Node returned ${response.status} for settlement transaction`)
  const result = await response.json()
  if (result.error_message || (result.result && result.result !== 'SUCCESS')) {
    throw new Error(`Mirror Node reports failed settlement: ${result.error_message || result.result}`)
  }
  return result
}

module.exports = { assertRestrictedTopic, hederaClient, hederaEvmSigner, mirrorContractResult, submitHcsMessage }
