import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { tradeFixture } from "../test/tradeFixture";
import { DecisionCard } from "./DecisionCard";

afterEach(cleanup);

describe("DecisionCard", () => {
  it("shows the held instrument, counterparties, price, and lifecycle state", () => {
    render(<MemoryRouter><DecisionCard trade={tradeFixture} /></MemoryRouter>);

    expect(screen.getByRole("article")).toHaveAttribute("data-layout", "trade-card");
    expect(screen.getByText("Cleared")).toBeInTheDocument();
    expect(screen.getByText(/Northstar Private Credit Fund/)).toBeInTheDocument();
    expect(screen.getByText("250 NPCF")).toBeInTheDocument();
    expect(screen.getByText("0.01 USDC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inspect trade/i })).toHaveAttribute("href", `/trades/${tradeFixture.tradeDigest}`);
  });

  it("does not style approval as final clearance", () => {
    render(<MemoryRouter><DecisionCard trade={{ ...tradeFixture, state: "APPROVED", settlement: null }} /></MemoryRouter>);
    expect(screen.getByText("Approved · awaiting execution")).toBeInTheDocument();
    expect(screen.queryByText("Cleared")).not.toBeInTheDocument();
  });
});
