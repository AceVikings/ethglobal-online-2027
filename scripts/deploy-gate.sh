#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--execute" ]]; then
  echo 'dry-run: VERDICT_SIGNER_ADDRESS=0x... POLICY_HASH=0x... PRIVATE_KEY=0x... forge script script/DeployConformanceGate.s.sol:DeployConformanceGate --rpc-url https://testnet.hashio.io/api --broadcast'
  exit 0
fi

: "${VERDICT_SIGNER_ADDRESS:?set VERDICT_SIGNER_ADDRESS}"
: "${POLICY_HASH:?set POLICY_HASH}"
: "${PRIVATE_KEY:?set PRIVATE_KEY}"
RPC_URL="${HEDERA_RPC_URL:-https://testnet.hashio.io/api}"
cd "$(dirname "$0")/../contracts"
forge script script/DeployConformanceGate.s.sol:DeployConformanceGate --rpc-url "$RPC_URL" --broadcast
