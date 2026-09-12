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
  },
  payment: {
    status: "SETTLED",
    asset: "USDC",
    amount: "0.01",
    facilitator: "Blocky402",
    reference: "payment-1",
    transactionId: "0.0.100@123.456",
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
  },
  settlement: {
    action: "EXECUTE",
    transactionId: "0.0.200@123.789",
    consensusAt: "2026-09-12T14:43:00.000Z",
    contractEvent: "HoldSettled",
    hcsTopicId: "0.0.300",
    hcsSequenceNumber: 4,
  },
  links: {
    security: "https://hashscan.io/testnet/token/0.0.111",
    escrow: "https://hashscan.io/testnet/contract/0.0.222",
    payment: "https://hashscan.io/testnet/transaction/0.0.100@123.456",
    settlement: "https://hashscan.io/testnet/transaction/0.0.200@123.789",
    hcsTopic: "https://hashscan.io/testnet/topic/0.0.300",
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
