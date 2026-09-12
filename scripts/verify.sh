#!/usr/bin/env bash
set -euo pipefail

address="${CLEARING_ESCROW_ADDRESS:-${2:-}}"
creation_tx="${CLEARING_ESCROW_CREATION_TX:-${3:-}}"
contract="src/ClearingEscrow.sol:ClearingEscrow"
base_url="https://sourcify.dev/server"

if [[ "${1:-}" != "--execute" ]]; then
  echo "dry-run: CLEARING_ESCROW_ADDRESS=0x... CLEARING_ESCROW_CREATION_TX=0x... $0 --execute"
  exit 0
fi

: "${address:?set CLEARING_ESCROW_ADDRESS or pass it as the second argument}"
: "${creation_tx:?set CLEARING_ESCROW_CREATION_TX or pass it as the third argument}"
[[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "invalid clearing escrow address" >&2; exit 1; }
[[ "$creation_tx" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "invalid creation transaction hash" >&2; exit 1; }

cd "$(dirname "$0")/../contracts"
if existing="$(curl -fsS "$base_url/v2/contract/296/$address" 2>/dev/null)"; then
  jq '{alreadyVerified: true, match, creationMatch, runtimeMatch, chainId, address, verifiedAt, matchId}' <<<"$existing"
  [[ "$(jq -r '.match' <<<"$existing")" == "exact_match" ]] || exit 1
  exit 0
fi
compiler_version="$(forge inspect "$contract" metadata | jq -r '.compiler.version')"
standard_json="$(forge verify-contract "$address" "$contract" --chain-id 296 --show-standard-json-input)"
payload="$(jq -n \
  --argjson std "$standard_json" \
  --arg compiler "$compiler_version" \
  --arg contract "$contract" \
  --arg tx "$creation_tx" \
  '{stdJsonInput:$std,compilerVersion:$compiler,contractIdentifier:$contract,creationTransactionHash:$tx}')"
response="$(curl -fsS -X POST "$base_url/v2/verify/296/$address" \
  -H 'content-type: application/json' --data "$payload")"
verification_id="$(jq -er '.verificationId' <<<"$response")"

for _attempt in {1..15}; do
  result="$(curl -fsS "$base_url/v2/verify/$verification_id")"
  if [[ "$(jq -r '.isJobCompleted' <<<"$result")" == "true" ]]; then
    jq '{verificationId, contract: {match, creationMatch, runtimeMatch, chainId, address, verifiedAt, matchId}}' <<<"$result"
    [[ "$(jq -r '.contract.match' <<<"$result")" == "exact_match" ]] || exit 1
    exit 0
  fi
  sleep 2
done

echo "Sourcify verification did not complete within 30 seconds: $verification_id" >&2
exit 1
