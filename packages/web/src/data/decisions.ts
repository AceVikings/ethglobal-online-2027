export type Verdict =
  | "CONFORMANT"
  | "NON_CONFORMANT"
  | "STALE"
  | "DISAGREEMENT";

type Check = {
  label: string;
  result: "PASS" | "FAIL" | "WARN";
  value: string;
};

type Span = {
  label: string;
  startMs: number;
  durationMs: number;
  active?: boolean;
};

export type Decision = {
  id: string;
  sequence: string;
  protocol: string;
  network: string;
  verdict: Verdict;
  operation: string;
  issuedAt: string;
  durationMs: number;
  payment: string;
  transactionId: string | null;
  signalHash: string;
  checksPassed: number;
  checksTotal: number;
  policy?: string;
  checks?: Check[];
  spans: Span[];
};

export const decisions: Decision[] = [
  {
    id: "decision-001",
    sequence: "CD-2409-001",
    protocol: "Aave v3",
    network: "Ethereum",
    verdict: "CONFORMANT",
    operation: "CONTROL LIST RELEASED",
    issuedAt: "14:42:06",
    durationMs: 1842,
    payment: "0.05 USDC",
    transactionId: "0.0.7162784@1789252926.442",
    signalHash: "0x10b9a8f2d44c97",
    checksPassed: 5,
    checksTotal: 5,
    policy: "Operator policy · 50 block freshness bound",
    checks: [
      { label: "Deployment CID", result: "PASS", value: "QmJCNW…81zk" },
      { label: "Indexing errors", result: "PASS", value: "false" },
      { label: "Freshness", result: "PASS", value: "12 / 50 blocks" },
      { label: "Shape agreement", result: "PASS", value: "11 fields · 0 mismatch" },
      { label: "Invariants", result: "PASS", value: "4 checked" },
    ],
    spans: [
      { label: "x402.verify", startMs: 0, durationMs: 331 },
      { label: "graph.gateway", startMs: 368, durationMs: 516 },
      { label: "mcp.schema", startMs: 663, durationMs: 409 },
      { label: "signal.check", startMs: 1105, durationMs: 240, active: true },
      { label: "hcs.anchor", startMs: 1380, durationMs: 462 },
    ],
  },
  {
    id: "decision-002",
    sequence: "CD-2409-002",
    protocol: "Aave v3",
    network: "Base",
    verdict: "NON_CONFORMANT",
    operation: "REFUSED — NO OPERATION SUBMITTED",
    issuedAt: "14:38:19",
    durationMs: 1651,
    payment: "0.05 USDC",
    transactionId: null,
    signalHash: "0x9c2a6e451cc021",
    checksPassed: 4,
    checksTotal: 5,
    policy: "Caller policy · deployment CID pinned",
    checks: [
      { label: "Deployment CID", result: "FAIL", value: "served Qmb5… · pinned QmD7…" },
      { label: "Indexing errors", result: "PASS", value: "false" },
      { label: "Freshness", result: "PASS", value: "18 / 50 blocks" },
      { label: "Shape agreement", result: "PASS", value: "11 fields · 0 mismatch" },
      { label: "Invariants", result: "PASS", value: "4 checked" },
    ],
    spans: [
      { label: "x402.verify", startMs: 0, durationMs: 331 },
      { label: "graph.gateway", startMs: 330, durationMs: 516 },
      { label: "mcp.schema", startMs: 594, durationMs: 409 },
      { label: "signal.check", startMs: 990, durationMs: 240, active: true },
      { label: "hcs.anchor", startMs: 1189, durationMs: 462 },
    ],
  },
  {
    id: "decision-003",
    sequence: "CD-2409-003",
    protocol: "Compound v3",
    network: "Ethereum",
    verdict: "CONFORMANT",
    operation: "COUPON UPDATE RECORDED",
    issuedAt: "14:31:54",
    durationMs: 2026,
    payment: "0.05 USDC",
    transactionId: "0.0.7162784@1789252314.921",
    signalHash: "0x7fe1d1a022a615",
    checksPassed: 5,
    checksTotal: 5,
    spans: [
      { label: "x402.verify", startMs: 0, durationMs: 331 },
      { label: "graph.gateway", startMs: 405, durationMs: 516 },
      { label: "signal.check", startMs: 1216, durationMs: 240, active: true },
      { label: "hcs.anchor", startMs: 1564, durationMs: 462 },
    ],
  },
  {
    id: "decision-004",
    sequence: "CD-2409-004",
    protocol: "SparkLend",
    network: "Ethereum",
    verdict: "STALE",
    operation: "REFUSED — NO OPERATION SUBMITTED",
    issuedAt: "14:24:03",
    durationMs: 1438,
    payment: "0.05 USDC",
    transactionId: null,
    signalHash: "0x41cb287905183f",
    checksPassed: 4,
    checksTotal: 5,
    spans: [
      { label: "x402.verify", startMs: 0, durationMs: 331 },
      { label: "graph.gateway", startMs: 288, durationMs: 516 },
      { label: "signal.check", startMs: 863, durationMs: 240, active: true },
      { label: "hcs.anchor", startMs: 976, durationMs: 462 },
    ],
  },
];

export function getDecision(id: string | undefined) {
  return decisions.find((decision) => decision.id === id);
}
