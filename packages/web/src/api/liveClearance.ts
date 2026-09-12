import type { LiveMandate, SignedLiveMandate } from "@desk/signal";

export type LiveStage = {
  id: "mandate" | "issuance" | "hold" | "payment" | "evidence" | "settlement" | "audit";
  status: "running" | "confirmed" | "failed";
  title: string;
  detail: string;
  proof?: Record<string, string | number | boolean | null>;
};

export type LiveResult = {
  runId: string;
  tradeDigest: string;
  proof: Record<string, string | number | boolean | null>;
};

type LiveEvent =
  | { type: "stage"; stage: LiveStage }
  | { type: "complete"; result: LiveResult }
  | { type: "error"; message: string };

const PRODUCTION_API_BASE = "https://conformance-desk-api-4p35sr23vq-uc.a.run.app";
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? PRODUCTION_API_BASE : "")
).replace(/\/$/, "");

export function createLiveMandate(owner: string, wallet: string, now = new Date()): LiveMandate {
  return {
    version: 1,
    owner,
    wallet,
    network: "hedera:testnet",
    asset: "SPCF",
    units: "1.0",
    maxDecisionFee: "0.01 USDC",
    policy: "strict-market-health",
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    nonce: crypto.randomUUID(),
  };
}

export async function streamLiveClearance(
  signed: SignedLiveMandate,
  accessToken: string,
  onStage: (stage: LiveStage) => void,
): Promise<LiveResult> {
  const response = await fetch(`${API_BASE}/api/v1/live-clearances`, {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(signed),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(error?.message ?? error?.error ?? `Live clearance returned ${response.status}`);
  }
  if (!response.body) throw new Error("Live clearance returned no event stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: LiveResult | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as LiveEvent;
    if (event.type === "stage") onStage(event.stage);
    else if (event.type === "complete") result = event.result;
    else throw new Error(event.message);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffered);
  if (!result) throw new Error("Live clearance ended without a final proof");
  return result;
}
