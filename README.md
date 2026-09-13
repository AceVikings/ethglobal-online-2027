![Clearing AI cover](docs/assets/clearing-ai-cover.png)

# Clearing AI — The Conformance Desk

The Conformance Desk lets a user create a personalized, tightly bounded AI-managed clearing vault. The user's
Privy embedded wallet signs the selected ATS asset, units, price/risk limits, expiry, and a
maximum `0.01 USDC` decision fee. A separate Privy-controlled buyer agent pays a Hedera x402
endpoint for a live standardized market-data check. A signed decision then makes
`ClearingEscrow` execute or release that hold, then attempts to anchor the final digest to Hedera
Consensus Service.

There is no simulated success path. The UI reads the durable result of this workflow and only
publishes a trade after the x402 payment, contract event, ATS balance change, and Mirror Node result
have all been confirmed.

## Live application

- Dashboard: [ethglobal-online-2027.onrender.com](https://ethglobal-online-2027.onrender.com)
- Guided vault demo: [open `/vaults`](https://ethglobal-online-2027.onrender.com/#/vaults)
- Clearing API: [health](https://conformance-desk-api-4p35sr23vq-uc.a.run.app/health) · [confirmed trades](https://conformance-desk-api-4p35sr23vq-uc.a.run.app/api/v1/trades)
- Source: [public GitHub repository](https://github.com/AceVikings/ethglobal-online-2027)

The dashboard is a Render Static Site. The dedicated `/vaults` control room guides the demo through
configuration, EIP-712 authorization, one-time account-bound MCP connection, agent run request,
human approval, replayable live events, and personal proof history. Its browser requests go to the scale-to-zero Cloud Run API.
Public reads expose only sanitized, chain-confirmed caretaker state. The authenticated live endpoint
writes isolated run artifacts to Cloud Storage and publishes a run only after independent replay
passes. Deployment from `main` uses GitHub OIDC and Workload Identity Federation, not a stored GCP
service-account key. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Why this exists

Tokenizing an asset is only the first step. Private-market counterparties still need to know whether
the data source is healthy enough to execute an exact transfer now. The Desk turns that question
into a paid machine-to-machine service with a bounded buyer, reproducible live evidence, and an
on-chain action that cannot be redirected to another trade.

## Architecture

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Web as Render vault UI
    participant Privy as Privy user wallet
    participant Seller
    participant ATS as Hedera ATS security
    participant Buyer as Privy buyer agent
    participant API as x402 clearing service
    participant Blocky as Blocky402 facilitator
    participant Graph as The Graph Gateway + MCP
    participant Escrow as ClearingEscrow
    participant HCS as Hedera Consensus Service

    User->>Web: Sign in and choose ATS asset, units, price, risk, fee, and expiry
    Web->>Privy: Sign exact mandate, expiry, policy, and spend ceiling
    Privy-->>Web: Wallet signature plus authenticated session
    User->>Web: Generate a short-lived account-bound MCP connection
    Buyer->>API: Request a run through scoped MCP tools
    API-->>Web: Publish an approval request for the same run ID
    User->>Privy: Approve that exact run
    API->>API: Verify Privy session, wallet signature, limits, cooldown, and quota
    Seller->>ATS: Issue and lock exact fund units in a hold
    Buyer->>API: Request a decision for that hold
    API-->>Buyer: HTTP 402 with Hedera USDC terms
    Buyer->>Buyer: Enforce payee, token, fee payer, and spend cap
    Buyer->>Blocky: Sign payment with Privy wallet
    Blocky-->>API: Verify payment
    API->>Graph: Read six pinned live deployments and schemas
    Graph-->>API: Current blocks, markets, schema, and provenance
    API->>API: Apply deterministic policy and sign exact action
    API->>Blocky: Settle payment
    API-->>Buyer: Signed APPROVE or DENY authorization
    Buyer->>Buyer: Verify signer and every immutable trade field
    Buyer->>Escrow: Submit one-use authorization
    alt APPROVE
        Escrow->>ATS: Execute exact hold to buyer
    else DENY
        Escrow->>ATS: Release exact hold to seller
    end
    Buyer->>Buyer: Confirm event, nonce, balances, and Mirror finality
    Buyer-->>HCS: Anchor final decision digest
```

The user mandate wallet, seller, and buyer agent are separate authorities with separate credentials.
The user wallet authorizes the job but does not hold server keys or pay Hedera gas. The seller never exposes its
Graph key or raw provider rows. The buyer receives no issuer role and cannot change the asset,
parties, amount, hold, policy, or action after the verdict is signed. DeepSeek is optional
presentation: it can explain the fixed result, but it cannot decide, sign, pay, or settle.

## Sponsor integrations and qualification status

Requirements are from the current
[ETHOnline 2026 prize page](https://ethglobal.com/events/ethonline2026/prizes). Code links are pinned
to the public `main` branch so judges can inspect the current implementation.

### Hedera — AI & Agentic Payments

| Requirement | Implementation | Status | Code |
| --- | --- | --- | --- |
| Live x402 service on Hedera through Blocky402 | `/verdict` registers the exact Hedera scheme with Blocky402 and Circle testnet USDC; no valid payment means no evaluation or verdict. | **Complete on testnet:** paid request settled through Blocky402 | [payment gate][loc-x402-server] |
| Agent completes a real paid request | The buyer enforces network, payee, asset, Blocky fee payer, and spend cap before signing; the caretaker uses that paid fetch. | **Complete:** Privy payer sent `0.01` canonical testnet USDC | [bounded buyer][loc-x402-buyer], [wiring][loc-caretaker-pay] |
| Public source and payment-flow docs | This public repository documents setup, architecture, the funded transaction, and the runnable payment flow. | **Complete** | This document |
| Five-minute-or-less paid-request demo | The demo uses the caretaker and only passes after the facilitator transaction and settlement are confirmed. | **Live flow complete;** recording is a submission artifact | [payment to finality][loc-caretaker-finality], [guided dashboard][loc-guided-flow] |

Hedera is also the execution and audit layer: the ATS hold prevents double-spending, the escrow
consumes a one-use authorization, and the agent attempts to record the final digest on HCS after
settlement. An HCS outage degrades audit metadata but cannot reverse or duplicate settlement.

### Hedera — Tokenization of Anything

| Requirement | Implementation | Status | Code |
| --- | --- | --- | --- |
| Use ATS to issue or manage a tokenized asset | ATS issues `Spokane Private Credit Fund` units, configures regulation metadata and roles, seeds the seller, and creates an escrow-bound hold. | **Complete on testnet** | [issuance][loc-ats-issue], [hold][loc-ats-hold] |
| Deploy and demonstrate on Hedera testnet | The security, clearing escrow, parties, and restricted HCS topic are deployed on testnet; public links are below. | **Complete on testnet** | [escrow][loc-escrow] |
| Public repo and verified contracts where applicable | Contract source is public and Sourcify exactly matches both creation and runtime bytecode. | **Complete** | [contract source][loc-escrow] |
| Show issuance, configuration, and a lifecycle operation | The approved lifecycle executes the ATS hold after a paid verdict; the caretaker verifies the exact seller/buyer balance delta. | **Complete:** hold `2` executed; buyer gained exactly `1.0` unit | [finality assertions][loc-caretaker-finality], [public projection][loc-public-proof] |

This is a secondary-market clearing use case, not a decorative token. ATS supplies issuance,
ownership, roles, and the hold lifecycle; the Desk adds paid market-data assurance and atomic
execution for an exact off-exchange transfer.

### The Graph — Composable or Standardized Graph Products

| Requirement | Implementation | Status | Code |
| --- | --- | --- | --- |
| Compose products or build on a standardized schema | One Messari Lending v3.1 query spans Aave, Compound, Morpho, and Spark across six pinned deployments; Gateway reads compose with Subgraph MCP schema, discovery, and query-count calls. | **Complete; live-validated** | [catalog][loc-graph-catalog], [evaluator][loc-graph-evaluator] |
| Consume live provider data; no mock/static dataset | The evaluator calls The Graph Gateway and live Subgraph MCP at request time, validates deployment metadata, and fails closed. | **Complete; live-validated** | [live evaluator][loc-graph-evaluator], [MCP transport][loc-graph-mcp] |
| Make standards leverage clear | One policy checks schema compatibility, indexing health, freshness, and market values without protocol-specific query branches. | **Complete** | [shared decision][loc-graph-decision] |
| Public repo and two-to-four-minute demo | Public source, live services, and the runnable path are documented here; the presentation follows the completed paid clearing run. | **Implementation complete;** recording is a submission artifact | [MCP tool][loc-desk-mcp], [guided dashboard][loc-guided-flow] |

### The Graph — Best AI Tooling or AI Use Case (From Scratch)

| Requirement | Implementation | Status | Code |
| --- | --- | --- | --- |
| The Graph is load-bearing | No Graph evidence means no signed verdict and therefore no escrow settlement. | **Complete** | [service boundary][loc-service-boundary] |
| Do meaningful work with live data | The service derives five checks and an APPROVE/DENY action instead of printing raw rows. | **Complete; live-validated** | [decision][loc-graph-decision] |
| Reusable tooling | `get_conformance_verdict` exposes the paid, signature-verifying flow as an MCP tool with a strict trade schema. | **Complete** | [MCP server][loc-desk-mcp] |
| Open source and correct pool | This public project was built from scratch for ETHOnline 2026. Setup and verification are below. | **Complete** | This document |

### Privy — Best Financial Flow

| Requirement | Implementation | Status | Code |
| --- | --- | --- | --- |
| Privy is core and at least one wallet is used | Every user signs in through Privy and receives an embedded Hedera-compatible EVM wallet. A separate Privy server wallet is paired to the Hedera buyer account. | **Complete** | [React provider][loc-privy-react], [wallet client][loc-privy-client] |
| Functional flow using generally available features | The browser wallet signs the exact five-minute clearing mandate and sends its Privy access token; the API verifies both before any work starts. The server wallet then signs the x402 Hedera payment. | **Complete** | [user signature][loc-privy-mandate-ui], [server verification][loc-live-server], [Hedera signer][loc-privy-signer] |
| Working demo and source | The live vault streams ATS issuance, hold, paid Graph verdict, escrow finality, and replay back to the authenticated user. | **Complete in product** | [live runner][loc-live-runner], [execution feed][loc-live-console] |
| Explain Privy's UX improvement | A user gets a recoverable login and explicit signing prompt without installing a wallet, while the autonomous agent pays without exporting its key. The UI makes those two authorities visibly distinct. | **Complete** | [account UI][loc-privy-account], [bounded buyer][loc-x402-buyer] |

## Live testnet resources

| Resource | Evidence |
| --- | --- |
| ATS equity security — `0.0.10506353` | [HashScan](https://hashscan.io/testnet/contract/0.0.10506353) |
| ClearingEscrow — `0.0.10506286` | [HashScan](https://hashscan.io/testnet/contract/0.0.10506286) · [Sourcify exact match](https://sourcify.dev/server/v2/contract/296/0x5D6Ee3b3f1f28872041F104ba4709Ac3a4fE4439) |
| Restricted audit topic — `0.0.10506273` | [HashScan](https://hashscan.io/testnet/topic/0.0.10506273) |
| Privy-controlled buyer — `0.0.10506237` | [HashScan](https://hashscan.io/testnet/account/0.0.10506237) |
| ATS hold creation — hold `2` | [HashScan](https://hashscan.io/testnet/transaction/0xfeb7eab09bfc768a4c624ea2a10a5278ea45fd3b77e99691f91802f372ef7cd2) |
| Privy + Blocky402 payment — `0.01 USDC` | [HashScan](https://hashscan.io/testnet/transaction/0.0.7162784@1789243987.325425735) |
| ClearingEscrow execution | [HashScan](https://hashscan.io/testnet/transaction/0.0.7314364-1789244000-627475762) |
| HCS audit anchor — sequence `1` | [HashScan](https://hashscan.io/testnet/transaction/0.0.7078256@1789244136.640562221) |

These resources come from one completed paid run. Its public replay passed all 11 bindings: signature,
trade digest, payment reference, evidence hash, authorization pins, action, held trade, consumed nonce,
contract event, Mirror finality, and consumed ATS hold.

## Run locally

Requirements: Node.js 22.x, npm 10+, and Foundry.

```bash
npm ci --ignore-scripts
test -f .env || cp .env.example .env
npm run check
```

Fill `.env` locally; never commit it. Required live values are documented in `.env.example`. The
preferred buyer uses `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID`, and
`PRIVY_HEDERA_ACCOUNT_ID`. DeepSeek credentials are optional and only enable an explanation.

Put the public browser identifier in `packages/web/.env.local` as
`VITE_PRIVY_APP_ID=...` (never put `PRIVY_APP_SECRET` in a Vite variable), then start the API and
visual dashboard in separate shells:

```bash
npm run start:service
npm run dev --workspace @conformance-desk/web
```

Every mutation is dry-run-first. Inspect the JSON before adding `--execute`:

```bash
node --env-file=.env --experimental-strip-types scripts/associate-privy-usdc.cjs
node --env-file=.env scripts/issue-equity.cjs
node --env-file=.env scripts/seed-equity.cjs
node --env-file=.env scripts/create-hold.cjs
node --env-file=.env --experimental-strip-types scripts/run-caretaker.cjs
```

Execute a funded testnet run:

```bash
node --env-file=.env --experimental-strip-types scripts/run-caretaker.cjs --execute
node --env-file=.env scripts/replay.cjs --execute
```

The dashboard at `http://127.0.0.1:5173` can run that path directly: sign in with Privy, review the
fixed mandate, approve its wallet signature, and watch all seven server stages stream to the browser.
The final proof room is published only after the 11-check replay succeeds. Before settlement it
intentionally displays “No held trades”; it never inserts a fixture to manufacture demo state.

Follow [`docs/E2E.md`](docs/E2E.md) for the evidence checklist, recovery rules, and negative tests.

## Security and trust boundaries

- An ATS hold names buyer, amount, expiry, and escrow, preventing double-spend while pending.
- `ClearingEscrow` accepts only a complete, unexpired EIP-712 authorization from the configured
  signer. A changed field, policy, action, or reused nonce reverts.
- The buyer accepts only the expected network, USDC token, payee, Blocky fee payer, and maximum price.
- Payment verification precedes Graph work; payment settlement precedes verdict delivery.
- Contract state and ATS balance delta are authoritative. HCS is a post-finality audit anchor.
- DeepSeek sees derived checks only and cannot override policy or sign anything.

## Packages

| Path | Purpose |
| --- | --- |
| `packages/signal` | Checks, Graph catalog/client, canonical JSON, signatures, and HCS digest |
| `packages/evaluator` | Live six-deployment Graph Gateway + Subgraph MCP evaluator |
| `packages/service` | Public reads/verifier, authenticated live runner, and x402-protected signed verdict endpoint |
| `packages/agent` | Bounded buyer, authorization verification, finality, and HCS anchoring |
| `packages/privy-hedera-poc` | Privy wallet client and Hedera x402 signer adapter |
| `packages/cli` | Signature-verifying paid consumer |
| `packages/mcp-server` | Reusable `get_conformance_verdict` MCP tool |
| `packages/web` | Privy login, signed mandate, animated live execution feed, and public proof rooms |
| `contracts` | `ClearingEscrow`, which executes or releases exact ATS holds |
| `scripts` | Dry-run-first issuance, lifecycle, deployment, sweep, replay, and verification |

## Honest limits

- ATS is ERC-1400 with partial ERC-3643 support. Coupon APIs are accounting operations; they do not
  transfer money.
- The qualification security keeps ATS internal KYC off because no SSI issuer/grants are
  provisioned. It uses regulation metadata, issuer/control roles, ownership, and escrowed holds; we
  do not claim KYC enforcement.
- Circle testnet USDC's fee schedule cannot be changed here. `scripts/hts-fees.cjs` creates a
  separate demonstration token and is not presented as the x402 asset.
- HIP-423 schedules are one-shot; they cannot invoke an HTTP agent or recur by themselves.
- The pinned ATS dependency has transitive npm audit findings. The proposed forced fix is an
  incompatible ATS downgrade, so the ATS process must not accept untrusted schemas or archives.

## Verification status

The code passes the Node/UI and Foundry suites plus all workspace builds. The repository is public,
the API is deployed on Cloud Run, and the dashboard is deployed on Render. The funded testnet run paid
`0.01` canonical USDC from the Privy-controlled buyer, evaluated six live Graph deployments, executed
the exact ATS hold, reached Mirror finality, anchored HCS sequence `1`, and passed all 11 independent
replay checks. The deployed API, local seller API, and Vite proxy return that same sanitized durable
state. CORS permits the Render site and the two documented local Vite origins.

The remaining submission artifact is the final uncut demo recording. Run the visual and browser-console
checks in [`docs/E2E.md`](docs/E2E.md) immediately before recording; unit/UI tests do not substitute
for that pass.

Primary references: [Hedera ATS](https://docs.hedera.com/solutions/tokenization/ats),
[Hedera x402](https://docs.hedera.com/solutions/ai/x402),
[The Graph Subgraph MCP](https://thegraph.com/docs/en/ai-suite/subgraph-mcp/introduction/), and
[Privy wallets](https://docs.privy.io/wallets/overview).

[loc-x402-server]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/service/src/adapters/x402-hedera.ts#L29-L108
[loc-x402-buyer]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/agent/src/x402-buyer.cjs#L3-L28
[loc-caretaker-pay]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/scripts/run-caretaker.cjs#L118-L151
[loc-caretaker-finality]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/scripts/run-caretaker.cjs#L155-L199
[loc-ats-issue]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/scripts/issue-equity.cjs#L13-L53
[loc-ats-hold]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/scripts/create-hold.cjs#L18-L88
[loc-escrow]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/contracts/src/ClearingEscrow.sol#L64-L169
[loc-graph-catalog]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/signal/src/deployments.ts#L25-L107
[loc-graph-evaluator]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/evaluator/src/index.ts#L150-L193
[loc-graph-decision]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/signal/src/checks.ts#L130-L178
[loc-graph-mcp]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/signal/src/mcp.ts#L33-L128
[loc-desk-mcp]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/mcp-server/src/server.ts#L53-L114
[loc-service-boundary]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/service/src/server.ts#L77-L127
[loc-privy-client]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/privy-hedera-poc/src/client.ts#L49-L145
[loc-privy-signer]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/privy-hedera-poc/src/adapter.ts#L81-L140
[loc-guided-flow]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/web/src/components/ClearingFlow.tsx#L76-L240
[loc-public-proof]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/service/src/trades.ts#L50-L151
[loc-privy-react]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/web/src/auth/PrivyAuth.tsx#L1-L94
[loc-privy-account]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/web/src/components/AccountButton.tsx#L1-L119
[loc-privy-mandate-ui]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/web/src/components/LiveClearanceConsole.tsx#L29-L73
[loc-live-console]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/web/src/components/LiveClearanceConsole.tsx#L76-L179
[loc-live-server]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/service/src/server.ts#L184-L235
[loc-live-runner]: https://github.com/AceVikings/ethglobal-online-2027/blob/main/packages/service/src/live-clearance.ts#L112-L190
