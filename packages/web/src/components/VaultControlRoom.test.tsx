import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type PrivySession, PrivySessionProvider } from "../auth/PrivyAuth";
import { VaultControlRoom } from "./VaultControlRoom";

const offering = {
  id: "offering-npcf",
  symbol: "NPCF",
  name: "Northstar Private Credit Fund",
  description: "Senior secured private credit",
  securityId: "0.0.6124891",
  partition: "CLASS-A",
  unitPrice: "12.50",
  currency: "USDC",
  decimals: 2,
};

const vault = {
  id: "vault-7",
  name: "Income guardrail",
  offeringId: offering.id,
  receiver: "0x1111111111111111111111111111111111111111",
  executor: { address: "0.0.7123456", status: "ready", hbarBalance: "8.2", usdcBalance: "50.01" },
  policy: { units: "4", maxPrice: "13.00", maxEvidenceFee: "0.01", maxUtilization: 72, maxEvidenceAgeMinutes: 15, expiresAt: "2026-09-14T10:00:00.000Z" },
  status: "active",
};

const connection = { id: "grant-1", name: "Codex terminal", status: "connected", scopes: ["vaults:read", "runs:request"], lastSeenAt: "2026-09-13T10:00:00.000Z" };
const approval = { id: "approval-1", vaultId: vault.id, clientName: "Codex terminal", status: "pending", summary: "Buy 4 NPCF within the signed cap", requestedAt: "2026-09-13T10:01:00.000Z", mandateMessage: "approve:approval-1" };
const run = {
  id: "run-91",
  vaultId: vault.id,
  offeringSymbol: "NPCF",
  state: "EVALUATING",
  triggeredBy: "Codex terminal via MCP",
  createdAt: "2026-09-13T10:02:00.000Z",
  events: [
    { id: "1", type: "HOLD_CONFIRMED", label: "ATS hold confirmed", detail: "4 NPCF locked", status: "confirmed", occurredAt: "2026-09-13T10:02:10.000Z" },
    { id: "2", type: "EVALUATING", label: "Graph evidence evaluating", detail: "Waiting for deterministic verdict", status: "running", occurredAt: "2026-09-13T10:02:20.000Z" },
  ],
};

function json(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
}

function renderControlRoom(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const session: PrivySession = {
    authenticated: true,
    configured: true,
    ready: true,
    userId: "did:privy:owner-7",
    walletAddress: vault.receiver,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue("privy-token"),
    signMessage: vi.fn().mockResolvedValue("0xsigned"),
    signTypedData: vi.fn().mockResolvedValue("0xtyped"),
  };
  render(<PrivySessionProvider value={session}><VaultControlRoom /></PrivySessionProvider>);
  return session;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("VaultControlRoom", () => {
  it("renders personalized controls, agent activity, history, and backend-confirmed events", async () => {
    renderControlRoom((input) => {
      const url = String(input);
      if (url.endsWith("/offerings")) return json({ offerings: [offering] });
      if (url.endsWith("/vaults")) return json({ vaults: [vault] });
      if (url.endsWith("/connections")) return json({ connections: [connection] });
      if (url.endsWith("/approvals")) return json({ approvals: [approval] });
      if (url.endsWith("/runs/run-91/events")) return Promise.resolve(new Response("", { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      if (url.includes("/runs")) return json({ runs: [run] });
      throw new Error(`Unexpected request ${url}`);
    });

    expect(await screen.findByRole("heading", { name: "Build a vault your agent cannot outgrow." })).toBeInTheDocument();
    expect(screen.getByText("Northstar Private Credit Fund")).toBeInTheDocument();
    expect(screen.getByLabelText("Investment units")).toHaveValue(4);
    expect(screen.getAllByText("Receiver wallet")).toHaveLength(2);
    expect(screen.getAllByText("0.0.7123456")).toHaveLength(2);
    expect(screen.getAllByText("Codex terminal").length).toBeGreaterThan(0);
    expect(screen.getByText("Buy 4 NPCF within the signed cap")).toBeInTheDocument();
    expect(await screen.findByText("ATS hold confirmed")).toBeInTheDocument();
    expect(screen.getByText("Triggered by Codex terminal via MCP")).toBeInTheDocument();
  });

  it("uses a Privy bearer token to preview and sign the exact draft", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const session = renderControlRoom((input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/offerings")) return json({ offerings: [offering] });
      if (url.endsWith("/vaults") && init?.method === "POST") return json({ vault });
      if (url.endsWith("/vaults/drafts")) return json({ draftId: "draft-9", mandateMessage: "typed-mandate:draft-9", typedData: { domain: { name: "Conformance Desk" }, primaryType: "VaultMandate", types: {}, message: { draftId: "draft-9" } }, preview: { policyHash: "0xpolicy", principal: "50.00 USDC" } });
      if (url.endsWith("/vaults")) return json({ vaults: [] });
      if (url.endsWith("/connections")) return json({ connections: [] });
      if (url.endsWith("/approvals")) return json({ approvals: [] });
      if (url.includes("/runs")) return json({ runs: [] });
      throw new Error(`Unexpected request ${url}`);
    });

    expect(await screen.findByText("Northstar Private Credit Fund")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Investment units"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview exact mandate" }));
    expect(await screen.findByText("50.00 USDC")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign EIP-712 & activate" }));

    await waitFor(() => expect(session.signTypedData).toHaveBeenCalledWith(expect.objectContaining({ primaryType: "VaultMandate" })));
    const draftRequest = requests.find(({ url }) => url.endsWith("/vaults/drafts"));
    expect(draftRequest?.init?.headers).toMatchObject({ Authorization: "Bearer privy-token" });
    expect(JSON.parse(String(draftRequest?.init?.body))).toMatchObject({ offeringId: offering.id, units: "6", receiver: vault.receiver });
  });

  it("shows an actionable error and never substitutes demo fixtures", async () => {
    renderControlRoom(() => Promise.reject(new Error("offline")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Personal vault data is unavailable");
    expect(screen.queryByText("Northstar Private Credit Fund")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry private data" })).toBeInTheDocument();
  });
});
