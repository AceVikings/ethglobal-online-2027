#!/usr/bin/env bash
set -euo pipefail

address="${CONFORMANCE_GATE_ADDRESS:-${2:-}}"
command=(forge verify-contract "$address" src/ConformanceGate.sol:ConformanceGate --chain-id 296 --verifier sourcify --verifier-url https://sourcify.dev/server)
if [[ "${1:-}" != "--execute" ]]; then
  echo "dry-run: CONFORMANCE_GATE_ADDRESS=0x... ${command[*]}"
  exit 0
fi
: "${address:?set CONFORMANCE_GATE_ADDRESS or pass it as the second argument}"
cd "$(dirname "$0")/../contracts"
"${command[@]}"
