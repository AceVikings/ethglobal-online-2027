export type Offering = {
  id: string;
  symbol: string;
  name: string;
  description: string;
  securityId: string;
  partition: string;
  unitPrice: string;
  currency: string;
  decimals: number;
};

export type VaultPolicy = {
  units: string;
  maxPrice: string;
  maxEvidenceFee: string;
  maxUtilization: number;
  maxEvidenceAgeMinutes: number;
  expiresAt: string;
};

export type Vault = {
  id: string;
  name: string;
  offeringId: string;
  receiver: string;
  executor: { address: string; status: "ready" | "funding" | "blocked"; hbarBalance: string; usdcBalance: string };
  policy: VaultPolicy;
  status: "draft" | "active" | "paused" | "archived";
};

export type AgentConnection = {
  id: string;
  name: string;
  status: "connected" | "revoked" | "expired";
  scopes: string[];
  lastSeenAt: string;
};

export type ApprovalRequest = {
  id: string;
  vaultId: string;
  clientName: string;
  status: "pending" | "approved" | "rejected";
  summary: string;
  requestedAt: string;
  mandateMessage: string;
};

export type RunEvent = {
  id: string;
  type: string;
  label: string;
  detail: string;
  status: "pending" | "running" | "confirmed" | "failed";
  occurredAt: string;
};

export type VaultRun = {
  id: string;
  vaultId: string;
  offeringSymbol: string;
  state: string;
  triggeredBy: string;
  createdAt: string;
  proofDigest?: string;
  events: RunEvent[];
};

export type VaultDraftInput = VaultPolicy & { offeringId: string; receiver: string; name: string };
export type VaultDraftPreview = { draftId: string; mandateMessage: string; preview: { policyHash: string; principal: string } };

const PRODUCTION_API_BASE = "https://conformance-desk-api-4p35sr23vq-uc.a.run.app";
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? PRODUCTION_API_BASE : "")).replace(/\/$/, "");

async function request<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? `Vault API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchVaultDashboard(accessToken: string) {
  const [offerings, vaults, connections, approvals, runs] = await Promise.all([
    request<{ offerings: Offering[] }>("/api/v1/offerings", accessToken),
    request<{ vaults: Vault[] }>("/api/v1/vaults", accessToken),
    request<{ connections: AgentConnection[] }>("/api/v1/connections", accessToken),
    request<{ approvals: ApprovalRequest[] }>("/api/v1/approvals", accessToken),
    request<{ runs: VaultRun[] }>("/api/v1/runs?limit=20", accessToken),
  ]);
  return { offerings: offerings.offerings, vaults: vaults.vaults, connections: connections.connections, approvals: approvals.approvals, runs: runs.runs };
}

export function previewVaultDraft(accessToken: string, input: VaultDraftInput) {
  return request<VaultDraftPreview>("/api/v1/vaults/drafts", accessToken, { method: "POST", body: JSON.stringify(input) });
}

export function activateVault(accessToken: string, draftId: string, signature: string) {
  return request<{ vault: Vault }>("/api/v1/vaults", accessToken, { method: "POST", body: JSON.stringify({ draftId, signature }) });
}

export function decideApproval(accessToken: string, approvalId: string, decision: "approve" | "reject", signature?: string) {
  return request<{ approval: ApprovalRequest; run?: VaultRun }>(`/api/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`, accessToken, {
    method: "POST",
    body: JSON.stringify(signature ? { signature } : {}),
  });
}

export async function watchRunEvents(
  runId: string,
  accessToken: string,
  lastEventId: string | null,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(`${API_BASE}/api/v1/runs/${encodeURIComponent(runId)}/events`, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${accessToken}`,
      ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
    },
    signal,
  });
  if (!response.ok) throw new Error(`Run event stream returned ${response.status}`);
  if (!response.headers.get("Content-Type")?.includes("text/event-stream") || !response.body) {
    throw new Error("Run event stream returned an invalid response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const consume = (block: string) => {
    const data = block.split("\n").filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (data) onEvent(JSON.parse(data) as RunEvent);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const blocks = buffered.split(/\r?\n\r?\n/);
    buffered = blocks.pop() ?? "";
    blocks.forEach(consume);
    if (done) break;
  }
  if (buffered.trim()) consume(buffered);
}
