import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventFixture, jsonResponse, tradeFixture } from "../test/tradeFixture";
import { DecisionPage } from "./DecisionPage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderTrade(trade = tradeFixture) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => Promise.resolve(jsonResponse(input.endsWith("/events") ? [eventFixture] : trade))));
  return render(<MemoryRouter initialEntries={[`/trades/${trade.tradeDigest}`]}><Routes><Route path="/trades/:tradeDigest" element={<DecisionPage />} /></Routes></MemoryRouter>);
}

describe("DecisionPage", () => {
  it("separates x402 payment from ATS settlement and labels AI explanation", async () => {
    renderTrade();
    expect(await screen.findByRole("heading", { name: tradeFixture.instrument.name })).toBeInTheDocument();
    expect(screen.getByText("0.01 USDC")).toBeInTheDocument();
    expect(screen.getByText("Exact hold executed")).toBeInTheDocument();
    expect(screen.getByText("AI EXPLANATION · NOT USED TO DETERMINE OUTCOME")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "x402 payment" })).toHaveAttribute("href", tradeFixture.links.payment);
    expect(screen.getByRole("link", { name: "ATS execution" })).toHaveAttribute("href", tradeFixture.links.settlement);
  });

  it("shows a denied trade as a real release with no units transferred", async () => {
    const released = { ...tradeFixture, state: "RELEASED" as const, verdict: "DENY" as const, decision: { ...tradeFixture.decision!, checks: [{ code: "FRESHNESS", label: "Evidence freshness", result: "FAIL" as const, publicValue: "73 / 50 blocks" }] }, settlement: { ...tradeFixture.settlement!, action: "RELEASE" as const, contractEvent: "HoldSettled" } };
    renderTrade(released);
    expect(await screen.findByText("Released")).toBeInTheDocument();
    expect(screen.getByText("Exact hold released")).toBeInTheDocument();
    expect(screen.getByText("No units reached the buyer.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ATS release" })).toBeInTheDocument();
  });

  it("does not render non-allow-listed verification links", async () => {
    renderTrade({ ...tradeFixture, links: { ...tradeFixture.links, settlement: "https://example.com/transaction/unsafe" } });
    await screen.findByRole("heading", { name: tradeFixture.instrument.name });
    expect(screen.queryByRole("link", { name: "ATS execution" })).not.toBeInTheDocument();
  });
});
