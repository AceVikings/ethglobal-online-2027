'use strict'

const { Wallet, JsonRpcProvider, Contract } = require('ethers')
const path = require('node:path')

// ATS v8 publishes SecurityRole in its declarations but not from its CommonJS
// entrypoint. Keep the four role hashes pinned to the v8.0.0 declarations until
// upstream exports the enum in CJS.
const ATS_ROLES = Object.freeze({
  ISSUER: '0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f',
  CONTROL_LIST: '0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d',
  CORPORATE_ACTIONS: '0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd',
  BOND_MANAGER: '0x68fe577385095e80beadf873ac12a3100f9a9d1b6d40f0d123eecf3d01bf5c49',
})

function loadAts() {
  if (typeof global.window === 'undefined') {
    global.window = { addEventListener() {}, removeEventListener() {} }
  }
  return require('@hashgraph/asset-tokenization-sdk')
}

function createEip1193Wallet(wallet) {
  if (!wallet?.provider) throw new Error('ATS wallet requires a JSON-RPC provider')
  const address = wallet.address
  return {
    isMetaMask: true,
    isConnected: () => true,
    on() {},
    removeListener() {},
    async request({ method, params = [] }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address]
      if (method === 'eth_chainId') return '0x128'
      if (method === 'eth_sendTransaction') {
        const [request] = params
        if (!request || request.from?.toLowerCase() !== address.toLowerCase()) {
          throw new Error('ATS transaction sender does not match the configured operator')
        }
        const transaction = await wallet.sendTransaction({
          to: request.to,
          data: request.data,
          value: request.value,
          gasLimit: request.gas,
        })
        return transaction.hash
      }
      return wallet.provider.send(method, params)
    },
  }
}

async function connectAts(config) {
  const wallet = new Wallet(config.operatorKey, new JsonRpcProvider(config.rpcUrl))
  const ethereum = createEip1193Wallet(wallet)
  global.window = { ethereum, addEventListener() {}, removeEventListener() {} }
  global.ethereum = ethereum
  const ats = loadAts()
  // MirrorNode and JsonRpcRelay are likewise omitted from the CJS exports;
  // ConnectRequest accepts their public structural shape.
  const mirrorNode = { baseUrl: `${config.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/`, name: 'testnet' }
  const rpcNode = { baseUrl: config.rpcUrl, name: 'hashio' }
  await ats.Network.init(new ats.InitializationRequest({
    network: 'testnet', mirrorNode, rpcNode,
    configuration: { factoryAddress: config.factoryId, resolverAddress: config.resolverId },
  }))
  await ats.Network.connect(new ats.ConnectRequest({
    account: { accountId: config.operatorId, privateKey: { key: config.operatorKey, type: 'ECDSA' }, evmAddress: wallet.address },
    network: 'testnet', mirrorNode, rpcNode, wallet: ats.SupportedWallets.METAMASK, debug: true,
  }))
  // ATS v8 exposes only the MetaMask adapter for JSON-RPC signing. In debug
  // mode it registers that adapter without pairing a browser wallet; inject the
  // server-side ethers signer into the registered adapter. The dependency is
  // version-pinned because this internal hook is not part of ATS's public CJS API.
  const atsRoot = path.dirname(require.resolve('@hashgraph/asset-tokenization-sdk'))
  const Injectable = require(path.join(atsRoot, 'core/injectable/Injectable.js')).default
  Injectable.resolveTransactionHandler().setSignerOrProvider(wallet)
  return { ats, wallet }
}

function createHoldAdapter(ats, securityId) {
  return {
    create({ partition, escrowId, amount, buyerId, expirationDate }) {
      return ats.Security.createHoldByPartition(new ats.CreateHoldByPartitionRequest({
        securityId,
        partitionId: partition,
        escrowId,
        amount: String(amount),
        targetId: buyerId,
        expirationDate,
      }))
    },
    async get({ partition, sellerId, holdId }) {
      const hold = await ats.Security.getHoldForByPartition(new ats.GetHoldForByPartitionRequest({
        securityId,
        partitionId: partition,
        targetId: sellerId,
        holdId: Number(holdId),
      }))
      if (!hold) return null
      const expiration = hold.expirationDate instanceof Date
        ? Math.floor(hold.expirationDate.getTime() / 1000)
        : hold.expirationTimeStamp ?? hold.expirationTimestamp
      return {
        partition,
        seller: hold.tokenHolderAddress || sellerId,
        holdId: hold.id ?? holdId,
        amount: hold.amount,
        expirationTimestamp: expiration,
        escrow: hold.escrowAddress || hold.escrow,
        destination: hold.destinationAddress || hold.to,
      }
    },
    reclaim({ partition, sellerId, holdId }) {
      return ats.Security.reclaimHoldByPartition(new ats.ReclaimHoldByPartitionRequest({
        securityId,
        partitionId: partition,
        targetId: sellerId,
        holdId: Number(holdId),
      }))
    },
  }
}

const CLEARING_ESCROW_ABI = Object.freeze([
  'function settle((uint256 chainId,address verifyingContract,address security,bytes32 partition,address seller,address buyer,uint256 amount,uint256 holdId,uint256 holdExpiry,uint8 action,bytes32 policyHash,bytes32 evidenceHash,bytes32 paymentRef,uint256 issuedAt,uint256 authorizationExpiry,bytes32 nonce) authorization,bytes signature) returns (bytes32 tradeDigest)',
  'function usedNonces(bytes32 nonce) view returns (bool)',
  'function hashAuthorization((uint256 chainId,address verifyingContract,address security,bytes32 partition,address seller,address buyer,uint256 amount,uint256 holdId,uint256 holdExpiry,uint8 action,bytes32 policyHash,bytes32 evidenceHash,bytes32 paymentRef,uint256 issuedAt,uint256 authorizationExpiry,bytes32 nonce) authorization) view returns (bytes32)',
  'function signer() view returns (address)',
  'function policyHash() view returns (bytes32)',
  'event HoldSettled(bytes32 indexed tradeDigest,address indexed security,uint256 indexed holdId,uint8 action,bytes32 evidenceHash,bytes32 paymentRef,bytes32 nonce,address relayer)',
])

const ATS_HOLD_ABI = Object.freeze([
  'function getHoldForByPartition((bytes32 partition,address tokenHolder,uint256 holdId) hold) view returns (uint256 amount,uint256 expirationTimestamp,address escrow,address destination,bytes data,bytes operatorData,uint8 thirdPartyType)',
  'function balanceOf(address account) view returns (uint256)',
])

function createHoldReader(runner, securityAddress) {
  if (!runner) throw new Error('A provider is required for ATS hold reads')
  if (!securityAddress) throw new Error('ATS security address is required')
  const contract = new Contract(securityAddress, ATS_HOLD_ABI, runner)
  return {
    async get({ partition, seller, holdId }) {
      const hold = await contract.getHoldForByPartition({ partition, tokenHolder: seller, holdId })
      return {
        partition, seller, holdId: String(holdId),
        amount: hold.amount.toString(),
        expirationTimestamp: hold.expirationTimestamp.toString(),
        escrow: hold.escrow,
        destination: hold.destination,
      }
    },
    async balances({ seller, buyer }) {
      const [sellerBalance, buyerBalance] = await Promise.all([contract.balanceOf(seller), contract.balanceOf(buyer)])
      return { seller: sellerBalance.toString(), buyer: buyerBalance.toString() }
    },
  }
}

function createClearingEscrowAdapter(runner, escrowAddress) {
  if (!runner) throw new Error('A provider or signer is required for ClearingEscrow')
  if (!escrowAddress) throw new Error('ClearingEscrow address is required')
  const contract = new Contract(escrowAddress, CLEARING_ESCROW_ABI, runner)
  return {
    settle: (authorization, signature) => contract.settle(authorization, signature),
    isNonceUsed: (nonce) => contract.usedNonces(nonce),
    hashAuthorization: (authorization) => contract.hashAuthorization(authorization),
    async findSettlement(authorization) {
      const events = await contract.queryFilter(
        contract.filters.HoldSettled(null, authorization.security, authorization.holdId),
      )
      const event = events.find((candidate) =>
        Number(candidate.args.action) === Number(authorization.action) &&
        candidate.args.nonce.toLowerCase() === authorization.nonce.toLowerCase() &&
        candidate.args.evidenceHash.toLowerCase() === authorization.evidenceHash.toLowerCase() &&
        candidate.args.paymentRef.toLowerCase() === authorization.paymentRef.toLowerCase())
      return event ? { tradeDigest: event.args.tradeDigest, transactionHash: event.transactionHash } : null
    },
    async findSettlementByDigest(tradeDigest) {
      const events = await contract.queryFilter(contract.filters.HoldSettled(tradeDigest))
      const event = events.at(-1)
      return event ? { args: event.args, tradeDigest: event.args.tradeDigest, transactionHash: event.transactionHash } : null
    },
    signer: () => contract.signer(),
    policyHash: () => contract.policyHash(),
  }
}

module.exports = {
  ATS_ROLES,
  ATS_HOLD_ABI,
  CLEARING_ESCROW_ABI,
  createEip1193Wallet,
  loadAts,
  connectAts,
  createHoldAdapter,
  createHoldReader,
  createClearingEscrowAdapter,
}
