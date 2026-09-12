'use strict'

const { Wallet, JsonRpcProvider, Interface } = require('ethers')

// ATS v8 publishes SecurityRole in its declarations but not from its CommonJS
// entrypoint. Keep the three audited role hashes we use explicit until upstream
// exports the enum in CJS.
const ATS_ROLES = Object.freeze({
  ISSUER: '0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f',
  CONTROL_LIST: '0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d',
  CORPORATE_ACTIONS: '0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd',
  BOND_MANAGER: '0x68fe577385095e80beadf873ac12a3100f9a9d1b6d40f0d123eecf3d01bf5c49',
})

function loadAts() {
  if (typeof global.window === 'undefined') global.window = {}
  return require('@hashgraph/asset-tokenization-sdk')
}

async function connectAts(config) {
  const ats = loadAts()
  // MirrorNode and JsonRpcRelay are likewise omitted from the CJS exports;
  // ConnectRequest accepts their public structural shape.
  const mirrorNode = { baseUrl: `${config.mirrorNodeUrl.replace(/\/$/, '')}/api/v1/`, name: 'testnet' }
  const rpcNode = { baseUrl: config.rpcUrl, name: 'hashio' }
  await ats.Network.init(new ats.InitializationRequest({
    network: 'testnet', mirrorNode, rpcNode,
    configuration: { factoryAddress: config.factoryId, resolverAddress: config.resolverId },
  }))
  const wallet = new Wallet(config.operatorKey, new JsonRpcProvider(config.rpcUrl))
  await ats.Network.connect(new ats.ConnectRequest({
    account: { accountId: config.operatorId, privateKey: { key: config.operatorKey, type: 'ECDSA' }, evmAddress: wallet.address },
    network: 'testnet', mirrorNode, rpcNode, wallet: ats.SupportedWallets.METAMASK, debug: false,
  }))
  return { ats, wallet }
}

function createControlListAdapter(ats, securityId) {
  const request = (targetId) => new ats.ControlListRequest({ securityId, targetId })
  return {
    block: (targetId) => ats.Security.addToControlList(request(targetId)),
    unblock: (targetId) => ats.Security.removeFromControlList(request(targetId)),
    isBlocked: (targetId) => ats.Security.isAccountInControlList(request(targetId)),
  }
}

function encodeTransfer({ to, amount }) {
  return new Interface(['function transfer(address to,uint256 amount)']).encodeFunctionData('transfer', [to, amount])
}

module.exports = { ATS_ROLES, loadAts, connectAts, createControlListAdapter, encodeTransfer }
