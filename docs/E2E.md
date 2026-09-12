# End-to-end test plan

This runbook proves the live Conformance Desk path without treating a local mock, a submitted
transaction, or a passing process exit as proof of settlement. Run it on Hedera testnet only.

## Safety and evidence rules

- Keep secrets in the gitignored `.env`; never write keys, payment headers, or signed payloads to
  committed logs.
- Use fresh, distinct ECDSA testnet issuer, seller, and buyer accounts. Fund them only from a free
  testnet faucet.
- Stop if any provider requires a paid plan, card, deposit, or mainnet asset.
- Capture transaction IDs, consensus timestamps, topic sequence numbers, contract addresses, and
  Graph block/deployment IDs. Redact authorization headers and private keys.
- Confirm every mutation through Mirror Node or contract state. An SDK response alone is not a
  passing assertion.
- Use a unique `E2E_RUN_ID` in memos and evidence filenames so parallel or repeated runs cannot be
  confused.

Store uncommitted evidence under `.context/e2e/<E2E_RUN_ID>/`:

```text
preflight.json
graph.json
x402.json
ats-refusal.json
ats-success.json
hcs-replay.json
escrow.json
summary.json
```

## Credential and resource gate

The run may start only when all required values are present and have been checked without printing
their secrets.

| Capability | Required values or resource | Preflight assertion |
| --- | --- | --- |
| Graph seller | `GRAPH_STUDIO_KEY` | One pinned deployment query succeeds; provider spend limit is zero |
| Verdict signer | `VERDICT_SIGNER_KEY`, `CONFORMANCE_EXPECTED_SIGNER` | Derived address exactly matches the expected signer |
| x402 seller | `X402_PAY_TO` | Valid Hedera account ID controlled by the seller |
| x402 buyer | `HEDERA_OPERATOR_ID`, ECDSA `HEDERA_OPERATOR_KEY` | Mirror Node resolves the account and EVM alias |
| Testnet funds | HBAR and Circle testnet USDC `0.0.429274` | Balances cover two verdict purchases and network fees |
| Seller and buyer | Distinct testnet accounts and EVM aliases | Both resolve; neither is the verdict signer or escrow |
| Reasoner (optional) | `DEEPSEEK_API_KEY`, explicit `DEEPSEEK_MODEL` | One minimal explanation request succeeds on the available free tier |
| Audit | `HCS_TOPIC_ID`, `CLEARING_ESCROW_ADDRESS` | Topic is readable; escrow signer and policy hash match local config |
| ATS | `ATS_SECURITY_ID`, partition, seller, buyer, hold ID | Issuer policy is configured and the pending hold names `ClearingEscrow` |

Run the normal offline gate before spending testnet resources:

```bash
npm ci --ignore-scripts
npm run check
node scripts/run-caretaker.cjs
node scripts/replay.cjs
```

## Stage 1: public infrastructure smoke

1. Fetch Blocky402 `/supported` and require x402 v2, `exact`, `hedera:testnet`, and fee payer
   `0.0.7162784`.
2. Query Hashio for chain ID 296.
3. Query Mirror Node for the issuer, seller, buyer, HCS topic, ATS security, and escrow contract.
4. Record response timestamps and identifiers in `preflight.json`.

Pass: every endpoint agrees on testnet and every configured ID resolves. This stage performs no
mutation.

## Stage 2: live Graph evaluation and signed verdict

Start the seller locally, then request one verdict directly through its evaluator test seam or a
protected request whose payment has not yet been submitted.

Assertions:

- all six pinned Messari Lending v3.1 deployment IDs are queried;
- MCP schema, discovery, and 30-day query-count calls return successfully;
- the target `_meta.deployment` equals its pinned deployment ID;
- the five checks, verdict, query hash, and indexed block are present;
- raw market rows and `GRAPH_STUDIO_KEY` are absent from the response;
- the signature recovers exactly `CONFORMANCE_EXPECTED_SIGNER`;
- repeating the same canonical payload produces the same signal hash;
- a wrong deployment ID, stale block bound, and signer mismatch each fail closed.

Pass: a live response is cryptographically verifiable and contains only derived evidence. Save a
redacted response plus the six deployment IDs and observed blocks in `graph.json`.

## Stage 3: x402 challenge, payment, and settlement

Use the CLI buyer against the local seller at a price of `0.01` testnet USDC.

Assertions:

1. An unsigned request returns HTTP 402 and declares only the pinned network, scheme, USDC asset,
   pay-to account, and Blocky fee payer.
2. The buyer rejects altered network, asset, pay-to account, fee payer, and a price above
   `X402_MAX_PRICE` before signing.
3. A valid buyer request results in exactly one settlement attempt.
4. The seller returns no verdict when verification or settlement fails.
5. On success, the returned payment transaction ID exists on Mirror Node, transfers the expected
   USDC amount to `X402_PAY_TO`, and is the payment reference committed by the decision record.
6. Reusing the same payment authorization cannot buy a second verdict.

Pass: balances and the Mirror Node transaction prove one exact testnet-USDC settlement. Save IDs,
amounts, pre/post balances, and redacted requirements in `x402.json`.

## Stage 4: held-trade denial

Create a signed `NON_CONFORMANT`, `STALE`, or `DISAGREEMENT` result from a controlled live policy
condition, not by editing the returned verdict. The seller first creates an ATS hold for the exact
buyer and amount with `ClearingEscrow` as its escrow.

Assertions:

- the deterministic action is `RELEASE`; DeepSeek may explain it but a conflicting recommendation
  is recorded and cannot change the action;
- `ClearingEscrow` releases the exact hold and consumes the authorization nonce;
- no units move to the buyer and the seller's available balance increases by the released amount;
- a second submission of the same authorization reverts;
- HCS and the escrow event agree on trade digest, action, evidence hash, and payment reference.

Pass: Mirror Node and ATS state prove release without a buyer balance change, while both audit
records identify the denial. Save evidence in `ats-refusal.json`.

## Stage 5: conformant execution

Create a fresh hold for a live target that satisfies every check, then run:

```bash
node scripts/run-caretaker.cjs --execute
```

Assertions:

- the purchased verdict is `CONFORMANT` and its signer matches the configured signer;
- the deterministic action is `EXECUTE`; the model can explain but cannot change it;
- `ClearingEscrow` validates chain, security, partition, seller, buyer, amount, hold ID, hold expiry,
  policy hash, evidence hash, payment reference, authorization expiry, signer, and nonce;
- ATS executes the held amount directly to the named buyer and the nonce becomes unusable;
- altered buyer, amount, hold ID, action, or evidence fields each revert without an ATS mutation;
- HCS anchoring is attempted after finality; an anchor failure is reported as degraded audit state,
  never as a failed or duplicated settlement.

Pass: Mirror Node proves one hold execution and the exact seller/buyer balance delta. Save evidence
in `ats-success.json`.

## Stage 6: audit replay and replay protection

Run:

```bash
node scripts/replay.cjs --execute
```

Assertions:

- every version-2 `CLEARING_DECISION` message recomputes to its published digest;
- the successful and refusal messages have distinct sequence numbers and correct operation labels;
- each escrow event matches the HCS trade digest, action, policy hash, evidence hash, and payment
  reference;
- the authorization nonce is consumed after the first settlement;
- submitting the same authorization again reverts and emits no second settlement event;
- corrupted HCS content fails local replay validation.

Pass: `failed` is zero for genuine topic messages, the escrow rejects replay, and cross-record
fields match. Save the replay output and event query as `hcs-replay.json` and `escrow.json`.

## Final acceptance matrix

The run is complete only when `summary.json` links every assertion to evidence and all rows below
pass.

| Path | Required result |
| --- | --- |
| Offline regression | Node and Solidity suites pass from a clean install |
| Live Graph | Six deployments queried; derived signed verdict verified |
| x402 negative | Tampered requirements and failed settlement return no verdict |
| x402 positive | One exact USDC settlement confirmed on Mirror Node |
| ATS denial | Exact hold released; buyer balance unchanged |
| ATS approval | Exact hold executed once; seller/buyer balance delta confirmed |
| Tamper resistance | Altered authorization fields revert before ATS mutation |
| HCS | Both decisions replay with valid digests |
| Escrow | Events match HCS and duplicate authorization nonce reverts |

Do not describe the project as end-to-end verified until this matrix has been completed against live
testnet resources. Testnet transaction fees are not fiat payments, but the run must still stop if the
free faucet or provider free tiers are unavailable.
