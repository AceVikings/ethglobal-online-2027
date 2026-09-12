#!/usr/bin/env bash
set -euo pipefail

address="${CLEARING_ESCROW_ADDRESS:-${2:-}}"
constructor_args="${CLEARING_ESCROW_CONSTRUCTOR_ARGS:-}"
command=(forge verify-contract "$address" src/ClearingEscrow.sol:ClearingEscrow --chain-id 296 --verifier sourcify --verifier-url https://sourcify.dev/server)
if [[ -n "$constructor_args" ]]; then
  command+=(--constructor-args "$constructor_args")
fi
if [[ "${1:-}" != "--execute" ]]; then
  echo "dry-run: CLEARING_ESCROW_ADDRESS=0x... CLEARING_ESCROW_CONSTRUCTOR_ARGS=0x... ${command[*]}"
  exit 0
fi
: "${address:?set CLEARING_ESCROW_ADDRESS or pass it as the second argument}"
: "${constructor_args:?set CLEARING_ESCROW_CONSTRUCTOR_ARGS to the ABI-encoded signer and policy hash}"
cd "$(dirname "$0")/../contracts"
"${command[@]}"
