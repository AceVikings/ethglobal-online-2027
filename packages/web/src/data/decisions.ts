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
  startPercent: number;
  widthPercent: number;
  duration: string;
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
  spans?: Span[];
};

export const defaultSpans: Span[] = [
  { label: "x402.verify", startPercent: 0, widthPercent: 18, duration: "331 ms" },
  { label: "graph.gateway", startPercent: 20, widthPercent: 28, duration: "516 ms" },
  { label: "signal.check", startPercent: 60, widthPercent: 13, duration: "240 ms", active: true },
  { label: "hedera.anchor", startPercent: 75, widthPercent: 25, duration: "462 ms" },
];

const detailedSpans: Span[] = [
  ...defaultSpans.slice(0, 2),
  { label: "mcp.schema", startPercent: 36, widthPercent: 22, duration: "409 ms" },
  ...defaultSpans.slice(2),
];

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
    spans: detailedSpans,
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
    spans: detailedSpans.map((span) =>
      span.label === "signal.check" ? { ...span, widthPercent: 18 } : span,
    ),
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
  },
];

export function getDecision(id: string | undefined) {
  return decisions.find((decision) => decision.id === id);
}
