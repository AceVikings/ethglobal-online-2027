import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DecisionCard } from "./DecisionCard";
import type { Decision } from "../data/decisions";

const baseDecision: Decision = {
  id: "decision-001",
  sequence: "CD-2409-001",
  protocol: "Aave v3",
  network: "Base",
  verdict: "CONFORMANT",
  operation: "CONTROL LIST RELEASED",
  issuedAt: "14:42:06",
  durationMs: 1842,
  payment: "0.05 USDC",
  transactionId: "0.0.7162784@1789252926.442",
  signalHash: "0x10b9a8f2d44c97",
  checksPassed: 5,
  checksTotal: 5,
};

function renderCard(decision: Decision) {
  return render(
    <MemoryRouter>
      <DecisionCard decision={decision} />
    </MemoryRouter>,
  );
}

describe("DecisionCard", () => {
  it("renders conformant and refused outcomes with the same structural weight", () => {
    const success = renderCard(baseDecision);
    const successArticle = screen.getByRole("article");
    expect(successArticle).toHaveAttribute("data-layout", "decision-card");
    expect(screen.getByText("CONFORMANT")).toBeInTheDocument();
    success.unmount();

    renderCard({
      ...baseDecision,
      id: "decision-002",
      verdict: "NON_CONFORMANT",
      operation: "REFUSED — NO OPERATION SUBMITTED",
      transactionId: null,
      checksPassed: 4,
    });

    expect(screen.getByRole("article")).toHaveAttribute(
      "data-layout",
      "decision-card",
    );
    expect(screen.getByText("NON-CONFORMANT")).toBeInTheDocument();
    expect(screen.getByText("No Hedera transaction")).toBeInTheDocument();
  });
});
