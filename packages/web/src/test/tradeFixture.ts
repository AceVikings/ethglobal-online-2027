import type { Trade, TradeEvent } from "../api/trades";

export const tradeFixture: Trade = {
  tradeDigest: "0x1234567890abcdef",
  sequence: "CLR-001",
  state: "EXECUTED",
  verdict: "APPROVE",
  instrument: {
    name: "Northstar Private Credit Fund",
    symbol: "NPCF",
    securityAddress: "0x1111111111111111",
    partition: "0x2222222222222222",
    network: "hedera-testnet",
  },
  hold: {
    holdId: "HOLD-1042",
    seller: "0x3333333333333333",
    buyer: "0x4444444444444444",
    escrow: "0x5555555555555555",
    units: "250",
    createdAt: "2026-09-12T14:40:00.000Z",
    expiresAt: "2026-09-12T15:00:00.000Z",
    creationTransactionId: "0xaaaaaaaaaaaaaaaa",
    balances: { before: { seller: "0", buyer: "0" }, after: { seller: "0", buyer: "250000000" } },
  },
  payment: {
    status: "SETTLED",
    asset: "USDC",
    amount: "0.01",
    facilitator: "Blocky402",
    reference: "payment-1",
    transactionId: "0.0.100@123.456",
    provenance: {
      payerProvider: "privy",
      payerAccountId: "0.0.101",
      tokenId: "0.0.429274",
      payTo: "0.0.102",
      feePayer: "0.0.100",
    },
  },
  decision: {
    policyHash: "0x6666666666666666",
    evidenceHash: "0x7777777777777777",
    signer: "0x8888888888888888",
    issuedAt: "2026-09-12T14:42:00.000Z",
    expiresAt: "2026-09-12T14:52:00.000Z",
    nonce: "1",
    nonceConsumed: true,
    checks: [{ code: "FRESHNESS", label: "Evidence freshness", result: "PASS", publicValue: "12 / 50 blocks" }],
    explanation: "Every deterministic check passed.",
    explanationProvider: "deepseek",
    evidence: {
      standard: "messari/lending-v3.1",
      protocol: "aave-v3",
      network: "ethereum",
      deploymentId: "QmDeployment",
      block: 25963648,
      queryHash: "0x9999999999999999",
      deploymentsCompared: 6,
    },
  },
  settlement: {
    action: "EXECUTE",
    transactionId: "0.0.200@123.789",
    consensusAt: "2026-09-12T14:43:00.000Z",
    contractEvent: "HoldSettled",
    balances: { before: { seller: "0", buyer: "0" }, after: { seller: "0", buyer: "250000000" } },
    auditStatus: "ANCHORED",
    hcsTransactionId: "0.0.100@123.999",
    hcsTopicId: "0.0.300",
    hcsSequenceNumber: 4,
  },
  verification: {
    verifiedAt: "2026-09-12T14:44:00.000Z",
    checked: 1,
    passed: 1,
    failed: 0,
    checks: {
      signature: true, tradeDigest: true, paymentRef: true, evidenceHash: true,
      authorizationPins: true, action: true, heldTrade: true, nonceConsumed: true,
      contractEvent: true, mirrorFinality: true, atsHoldConsumed: true,
    },
  },
  links: {
    security: "https://hashscan.io/testnet/token/0.0.111",
    escrow: "https://hashscan.io/testnet/contract/0.0.222",
    holdCreation: "https://hashscan.io/testnet/transaction/0xaaaaaaaaaaaaaaaa",
    payment: "https://hashscan.io/testnet/transaction/0.0.100@123.456",
    settlement: "https://hashscan.io/testnet/transaction/0.0.200@123.789",
    hcsTopic: "https://hashscan.io/testnet/topic/0.0.300",
    hcsAudit: "https://hashscan.io/testnet/transaction/0.0.100@123.999",
  },
  updatedAt: "2026-09-12T14:43:01.000Z",
};

export const eventFixture: TradeEvent = {
  id: "event-1",
  tradeDigest: tradeFixture.tradeDigest,
  type: "HOLD_EXECUTED",
  occurredAt: "2026-09-12T14:43:00.000Z",
  transactionId: "0.0.200@123.789",
  publicDetail: "Exact held units reached the named buyer.",
};

export function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
