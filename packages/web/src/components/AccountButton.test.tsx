import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type PrivySession, PrivySessionProvider } from "../auth/PrivyAuth";
import { AccountButton } from "./AccountButton";

afterEach(() => cleanup());

function renderAccount(overrides: Partial<PrivySession> = {}) {
  const session: PrivySession = {
    authenticated: false,
    configured: true,
    ready: true,
    userId: null,
    walletAddress: null,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue("token"),
    signMessage: vi.fn().mockResolvedValue("0xsigned"),
    ...overrides,
  };
  render(<PrivySessionProvider value={session}><AccountButton /></PrivySessionProvider>);
  return session;
}

describe("AccountButton", () => {
  it("opens Privy login for a signed-out user", () => {
    const session = renderAccount();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Privy" }));
    expect(session.login).toHaveBeenCalledOnce();
  });

  it("shows the embedded wallet and Hedera chain after login", () => {
    renderAccount({ authenticated: true, walletAddress: "0x1234567890abcdef1234567890abcdef12345678" });
    fireEvent.click(screen.getByRole("button", { name: /0x1234…5678/i }));
    expect(screen.getByText("Privy embedded signer")).toBeInTheDocument();
    expect(screen.getByText("HEDERA TESTNET · 296")).toBeInTheDocument();
    expect(screen.getByText("SIGN MANDATES")).toBeInTheDocument();
  });

  it("signs out from the account panel", async () => {
    const session = renderAccount({ authenticated: true, walletAddress: "0x1234567890abcdef1234567890abcdef12345678" });
    fireEvent.click(screen.getByRole("button", { name: /0x1234…5678/i }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(session.logout).toHaveBeenCalledOnce());
  });

  it("closes the account panel with Escape", () => {
    renderAccount({ authenticated: true, walletAddress: "0x1234567890abcdef1234567890abcdef12345678" });
    fireEvent.click(screen.getByRole("button", { name: /0x1234…5678/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Privy account" })).not.toBeInTheDocument();
  });

  it("explains when the public Privy app id is missing", () => {
    renderAccount({ configured: false });
    expect(screen.getByRole("button", { name: "Login not configured" })).toBeDisabled();
  });
});
