import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { tradeFixture } from "../test/tradeFixture";
import { ClearingFlow } from "./ClearingFlow";

afterEach(cleanup);

describe("ClearingFlow", () => {
  it("shows the custody-safe sequence and both final outcomes", () => {
    render(<ClearingFlow />);

    expect(screen.getByRole("heading", { name: "One held trade. Two provable outcomes." })).toBeInTheDocument();
    expect(screen.getByText("Lock exact units")).toBeInTheDocument();
    expect(screen.getByText("Purchase one verdict")).toBeInTheDocument();
    expect(screen.getByText("Check live evidence")).toBeInTheDocument();
    expect(screen.getByText("Execute the exact hold.")).toBeInTheDocument();
    expect(screen.getByText("Release the exact hold.")).toBeInTheDocument();
    expect(screen.getByText("ATS hold prevents double-spend")).toBeInTheDocument();
    expect(screen.getByText("ClearingEscrow is sole executor")).toBeInTheDocument();
  });

  it("lets keyboard and pointer users inspect each causal step", () => {
    render(<ClearingFlow />);

    const hold = screen.getByRole("button", { name: /inspect hedera ats/i });
    const verdict = screen.getByRole("button", { name: /inspect signed policy/i });

    expect(hold).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("The fund units become unavailable")).toBeInTheDocument();

    fireEvent.click(verdict);

    expect(verdict).toHaveAttribute("aria-pressed", "true");
    expect(hold).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("The decision becomes trade-specific authority")).toBeInTheDocument();
    expect(screen.getByText(/signature binds the verdict/i)).toBeInTheDocument();
  });

  it("makes both settlement branches and the attempted audit anchor explicit", () => {
    render(<ClearingFlow />);

    expect(screen.getByRole("button", { name: /inspect execute branch/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inspect release branch/i })).toBeInTheDocument();
    expect(screen.getByText("Both branches attempt an HCS audit anchor")).toBeInTheDocument();
    expect(screen.getByText("Audit status follows settlement")).toBeInTheDocument();
    expect(screen.queryByText("Both branches anchor to HCS")).not.toBeInTheDocument();
  });

  it("staggers connector packets in causal order", () => {
    render(<ClearingFlow />);

    const connectors = screen.getAllByTestId("flow-connector");
    expect(connectors).toHaveLength(3);
    expect(connectors[0]).toHaveStyle("--packet-delay: 0ms");
    expect(connectors[1]).toHaveStyle("--packet-delay: 200ms");
    expect(connectors[2]).toHaveStyle("--packet-delay: 400ms");
  });

  it("guides users through the exact API-backed proof for a completed trade", () => {
    render(<MemoryRouter><ClearingFlow trade={tradeFixture} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Follow the completed trade, step by step." })).toBeInTheDocument();
    expect(screen.getByText("LIVE TRACE · CLR-001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open full evidence" })).toHaveAttribute("href", `/trades/${tradeFixture.tradeDigest}`);

    fireEvent.click(screen.getByRole("button", { name: /inspect privy \+ x402/i }));
    expect(screen.getByText(/0.01 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/Privy embedded wallet/)).toBeInTheDocument();
    expect(screen.getByText("Payer 0.0.101")).toBeInTheDocument();
    expect(screen.getByText("Canonical USDC 0.0.429274")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /inspect the graph/i }));
    expect(screen.getByText(/6 DEPLOYMENTS · 1\/1 CHECKS PASS/)).toBeInTheDocument();
    expect(screen.getByText(/messari\/lending-v3.1/)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /release branch \(counterfactual\)/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /inspect hedera hcs audit/i }));
    expect(screen.getByText(/TOPIC 0.0.300 · SEQUENCE 4 · REPLAY 11\/11/)).toBeInTheDocument();
    expect(screen.getByText(/1\/1 anchored messages passed independent replay/)).toBeInTheDocument();
  });

  it("does not call a locally signed x402 payment Privy-backed", () => {
    const localTrade = structuredClone(tradeFixture);
    localTrade.payment!.provenance!.payerProvider = "local";
    localTrade.verification = null;
    render(<MemoryRouter><ClearingFlow trade={localTrade} /></MemoryRouter>);

    expect(screen.getByRole("button", { name: /inspect x402 payment/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /inspect privy/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /inspect x402 payment/i }));
    expect(screen.getByText(/HEDERA PAYER/)).toBeInTheDocument();
    expect(screen.queryByText(/PRIVY PAYER/)).not.toBeInTheDocument();
  });
});
