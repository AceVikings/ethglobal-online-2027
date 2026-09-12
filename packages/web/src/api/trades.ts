export type TradeState =
  | "HOLD_PENDING"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_SETTLED"
  | "EVALUATING"
  | "APPROVED"
  | "DENIED"
  | "EXECUTING"
  | "RELEASING"
  | "EXECUTED"
  | "RELEASED"
  | "EXPIRED"
  | "FAILED";

export type Verdict = "APPROVE" | "DENY" | null;

export type Trade = {
  tradeDigest: `0x${string}`;
  sequence: string;
  state: TradeState;
  verdict: Verdict;
  instrument: {
    name: string;
    symbol: string;
    securityAddress: `0x${string}`;
    partition: `0x${string}`;
    network: "hedera-testnet";
  };
  hold: {
    holdId: string;
    seller: `0x${string}`;
    buyer: `0x${string}`;
    escrow: `0x${string}`;
    units: string;
    createdAt: string;
    expiresAt: string;
  };
  payment: null | {
    status: "REQUIRED" | "SETTLED" | "FAILED";
    asset: string;
    amount: string;
    facilitator: "Blocky402";
    reference: string | null;
    transactionId: string | null;
  };
  decision: null | {
    policyHash: `0x${string}`;
    evidenceHash: `0x${string}`;
    signer: `0x${string}`;
    issuedAt: string;
    expiresAt: string;
    nonce: string;
    nonceConsumed: boolean;
    checks: Array<{
      code: string;
      label: string;
      result: "PASS" | "FAIL";
      publicValue: string;
    }>;
    explanation: string | null;
    explanationProvider: "deepseek" | null;
  };
  settlement: null | {
    action: "EXECUTE" | "RELEASE";
    transactionId: string;
    consensusAt: string;
    contractEvent: string;
    hcsTopicId: string | null;
    hcsSequenceNumber: number | null;
  };
  links: {
    security: string;
    escrow: string;
    payment: string | null;
    settlement: string | null;
    hcsTopic: string | null;
  };
  updatedAt: string;
};

export type TradeEvent = {
  id: string;
  tradeDigest: `0x${string}`;
  type:
    | "HOLD_CREATED"
    | "PAYMENT_CHALLENGED"
    | "PAYMENT_SETTLED"
    | "EVIDENCE_EVALUATED"
    | "VERDICT_SIGNED"
    | "HOLD_EXECUTED"
    | "HOLD_RELEASED"
    | "HOLD_EXPIRED"
    | "AUDIT_ANCHORED"
    | "FAILED";
  occurredAt: string;
  transactionId: string | null;
  publicDetail: string;
};

export type TradeListResponse = {
  trades: Trade[];
  nextCursor: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw new Error(`Clearing API returned ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Clearing API returned a non-JSON response");

  return response.json() as Promise<T>;
}

export function fetchTrades(signal?: AbortSignal) {
  return readJson<TradeListResponse>("/api/v1/trades?limit=20", signal);
}

export function fetchTrade(tradeDigest: string, signal?: AbortSignal) {
  return readJson<Trade>(`/api/v1/trades/${encodeURIComponent(tradeDigest)}`, signal);
}

export function fetchTradeEvents(tradeDigest: string, signal?: AbortSignal) {
  return readJson<TradeEvent[]>(`/api/v1/trades/${encodeURIComponent(tradeDigest)}/events`, signal);
}

export function shortId(value: string) {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function safeTestnetLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hashscan.io" && url.pathname.startsWith("/testnet/")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
