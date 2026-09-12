import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { DecisionPage } from "./DecisionPage";
import { getDecision } from "../data/decisions";

afterEach(cleanup);

function renderDecisionRoute(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/decisions/${id}`]}>
      <Routes>
        <Route path="/decisions/:id" element={<DecisionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DecisionPage", () => {
  it("links directly to the selected HashScan transaction", () => {
    const decision = getDecision("decision-003");
    expect(decision?.transactionId).toBeTruthy();

    renderDecisionRoute("decision-003");

    expect(screen.getByRole("link", { name: /open in hashscan/i })).toHaveAttribute(
      "href",
      `https://hashscan.io/testnet/transaction/${encodeURIComponent(decision!.transactionId!)}`,
    );
  });

  it("discloses preview data and summarizes checks when details are unavailable", () => {
    renderDecisionRoute("decision-004");

    expect(screen.getByText("PREVIEW")).toBeInTheDocument();
    expect(screen.getByText("STATIC DATA · API PENDING")).toBeInTheDocument();
    expect(screen.getByText("Check detail unavailable for this decision")).toBeInTheDocument();
    expect(screen.getByText("4/5 checks passed · individual evidence not provided")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open in hashscan/i })).not.toBeInTheDocument();
  });
});
