#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--execute" ]]; then
  echo 'dry-run: VERDICT_SIGNER_KEY=0x... POLICY_HASH=0x... HEDERA_OPERATOR_KEY=0x... forge script script/DeployConformanceGate.s.sol:DeployConformanceGate --rpc-url https://testnet.hashio.io/api --broadcast'
  exit 0
fi

: "${VERDICT_SIGNER_KEY:?set VERDICT_SIGNER_KEY}"
: "${POLICY_HASH:?set POLICY_HASH}"
: "${HEDERA_OPERATOR_KEY:?set HEDERA_OPERATOR_KEY}"
RPC_URL="${HEDERA_JSON_RPC:-https://testnet.hashio.io/api}"
export VERDICT_SIGNER_ADDRESS="$(cast wallet address --private-key "$VERDICT_SIGNER_KEY")"
cd "$(dirname "$0")/../contracts"
forge script script/DeployConformanceGate.s.sol:DeployConformanceGate --rpc-url "$RPC_URL" --private-key "$HEDERA_OPERATOR_KEY" --broadcast
