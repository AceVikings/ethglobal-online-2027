# End-to-end demo runbook

This is the exact Hedera testnet approval flow used for the demo. It does not treat a fixture,
submitted transaction, or zero exit code as proof of settlement. The denial branch and tamper cases
are covered by the contract and agent test suites; a live denial would require a separate escrow and
hold committed to a denial-producing policy, so it is not part of the presentation run.

## Passing evidence

A run passes only when all of these agree:

1. Blocky402 returns a real Circle testnet USDC payment transaction.
2. The Graph responds from all six pinned live deployments and the Subgraph MCP.
3. `ClearingEscrow` emits one `HoldSettled` event and consumes the authorization nonce.
4. The ATS hold reaches zero and the seller/buyer balance delta equals the exact held amount.
5. Mirror Node indexes the settlement transaction.
6. HCS replay recomputes the signed authorization and matches the escrow and Mirror records.
7. The dashboard reads that durable caretaker state through the real seller API.

Keep all evidence under `.context/e2e/`; it is gitignored. Never put keys, payment headers, or raw
signed payment payloads in screenshots or committed logs.

## Credentials and resources

| Role | Required values | Preflight assertion |
| --- | --- | --- |
| Graph seller | `GRAPH_STUDIO_KEY` | Live Gateway query succeeds for every pinned deployment |
| Verdict authority | `VERDICT_SIGNER_KEY`, `CONFORMANCE_EXPECTED_SIGNER`, `POLICY_HASH` | Key derives the expected signer; escrow reports that signer and policy |
| x402 seller | `X402_PAY_TO`, `X402_*` settings | Payee is the intended Hedera seller and Blocky advertises the pinned fee payer |
| Privy payer | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID`, `PRIVY_HEDERA_ACCOUNT_ID` | Wallet address resolves to the public key controlling the Hedera buyer account |
| Hedera relayer | `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | Distinct ECDSA account can relay the escrow transaction; it is not the payer |
| ATS seller | `HEDERA_SELLER_ID`, `HEDERA_SELLER_KEY`, `SELLER_EVM_ADDRESS` | Key matches the seller that owns or holds the fund units |
| ATS trade | security, partition, buyer, escrow, and `.context/ats-hold.json` | Stored identity exactly matches `.env` and live ATS state |
| Audit | `HCS_TOPIC_ID` | Topic exists and has the expected submit key |
| Optional explanation | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | Absence or failure cannot change the deterministic action |

The Privy payer needs HBAR for account operation and Circle testnet USDC `0.0.429274` for the paid
request. Use only free faucets. Stop if any provider asks for a card, deposit, or mainnet asset.

Before using the Circle faucet, explicitly associate the canonical USDC token with the Privy-backed
Hedera account. The association is signed remotely by Privy; no buyer private key is exported:

```bash
node --env-file=.env --experimental-strip-types scripts/associate-privy-usdc.cjs
node --env-file=.env --experimental-strip-types scripts/associate-privy-usdc.cjs --execute
```

Only after `alreadyAssociated` is true should the Circle faucet send USDC to
`PRIVY_HEDERA_ACCOUNT_ID`.

## 1. Prepare an isolated run

From the repository root:

```bash
npm ci --ignore-scripts
test -f .env || cp .env.example .env # then fill it locally
export E2E_RUN_ID="demo-$(date -u +%Y%m%dT%H%M%SZ)"
export CARETAKER_STATE_FILE=".context/e2e/$E2E_RUN_ID/caretaker-state.json"
mkdir -p ".context/e2e/$E2E_RUN_ID"
npm run check
npm run build
```

The clean gate is 149 Node/browser tests, 15 Foundry tests, and a successful web production build.

## 2. Verify live public infrastructure

```bash
curl -fsS https://api.testnet.blocky402.com/supported
curl -fsS https://testnet.hashio.io/api \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl -fsS 'https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.10506237/tokens?token.id=0.0.429274&limit=1'
```

Require x402 v2, scheme `exact`, network `hedera:testnet`, fee payer `0.0.7162784`, Hashio chain ID
`0x128` (296), and a non-zero buyer USDC balance. A missing token row is a hard stop.

## 3. Exercise The Graph live

```bash
E2E_RUN_ID="$E2E_RUN_ID" node --env-file=.env scripts/sweep.cjs --execute
```

Pass only when `checked` and `healthy` are both `6`. The command stores provider timestamps,
deployment IDs, blocks, and health under `.context/e2e/$E2E_RUN_ID/graph.json` without raw rows or
the API key.

## 4. Recover an expired prepared hold if necessary

First run the caretaker preview:

```bash
CARETAKER_STATE_FILE="$CARETAKER_STATE_FILE" \
  node --env-file=.env --experimental-strip-types scripts/run-caretaker.cjs
```

If the stored hold is still live, continue. If it expired, reclaim and replace it:

```bash
ATS_HOLD_RECLAIM_FILE=".context/e2e/$E2E_RUN_ID/ats-hold-reclaim.json" \
  node --env-file=.env scripts/reclaim-hold.cjs
ATS_HOLD_RECLAIM_FILE=".context/e2e/$E2E_RUN_ID/ats-hold-reclaim.json" \
  node --env-file=.env scripts/reclaim-hold.cjs --execute
ATS_HOLD_EXPIRY="$(( $(date +%s) + 3600 ))" \
  node --env-file=.env scripts/create-hold.cjs --execute
```

The reclaim refuses an unexpired or identity-mismatched hold, signs only with the seller, and
publishes evidence only after the live amount is zero.

## 5. Start the real API and dashboard

Terminal A:

```bash
CARETAKER_STATE_FILE="$CARETAKER_STATE_FILE" npm run start:service
```

Terminal B:

```bash
npm run dev --workspace @desk/web
```

Before settlement these must return an empty real read model, never a fixture:

```bash
curl -fsS http://127.0.0.1:4020/api/v1/trades
curl -fsS http://127.0.0.1:5173/api/v1/trades
```

## 6. Execute exactly one paid clearing

Terminal C, with the same exported run variables:

```bash
CARETAKER_STATE_FILE="$CARETAKER_STATE_FILE" \
  node --env-file=.env --experimental-strip-types scripts/run-caretaker.cjs --execute
```

The command is checkpointed. If the process stops after payment or after contract submission, rerun
the identical command with the same state file; it resumes instead of paying or settling twice.

Require the final state to report:

- a settled Blocky payment reference;
- `CONFORMANT` and action `APPROVE`;
- lifecycle `EXECUTED`;
- one escrow transaction hash and trade digest;
- nonce consumed;
- hold amount zero;
- seller decrease and buyer increase equal to the stored raw hold amount;
- Mirror transaction ID;
- HCS sequence metadata, or an explicit degraded audit status if HCS alone failed.

HCS degradation does not falsify an otherwise final settlement, but the Hedera audit-trail bonus is
not demonstrated until the anchor succeeds.

## 7. Independently replay public evidence

```bash
node --env-file=.env scripts/replay.cjs --execute
```

Pass only when `checked` is at least `1`, `failed` is `0`, and every row confirms signature, trade
digest, payment reference, authorization pins, action, nonce, contract event, Mirror finality, and
consumed ATS hold. Zero topic messages exits non-zero by design.

## 8. Verify the visual demo

Open `http://127.0.0.1:5173` and verify:

- the completed trade appears without a refresh after API polling;
- its amount, action, protocol, lifecycle, and transaction links match the caretaker state;
- the timeline reaches payment, evidence, authorization, settlement, and audit in order;
- opening the trade reveals no secret, raw Graph row, or payment authorization;
- the browser console has no warning or error.

The same API check should now return exactly the chain-confirmed trade:

```bash
curl -fsS http://127.0.0.1:4020/api/v1/trades
curl -fsS http://127.0.0.1:5173/api/v1/trades
```

## Final submission gates

- Publish the repository only after choosing whether to preserve or squash historical internal docs.
- Confirm the existing Sourcify creation/runtime exact match still resolves before recording.
- Record a single uncut demo of the paid request, ATS execution, replay, and dashboard.
- Link the payment, escrow event, ATS security, and HCS topic in the submission.
- Rotate every credential that was pasted into chat or used during the demo.

Do not describe the project as end-to-end verified until Steps 1–8 pass in one funded run.
