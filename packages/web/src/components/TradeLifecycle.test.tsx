import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { eventFixture } from "../test/tradeFixture";
import type { TradeEvent } from "../api/trades";
import { TradeLifecycle } from "./TradeLifecycle";

afterEach(cleanup);

describe("TradeLifecycle", () => {
  it("marks only backend-confirmed stages complete", () => {
    render(<TradeLifecycle events={[eventFixture]} />);

    expect(screen.getByRole("list", { name: "Confirmed trade lifecycle" })).toBeInTheDocument();
    expect(screen.getByText("ATS ACTION").parentElement).not.toHaveTextContent("UNCONFIRMED");
    expect(screen.getByText("PAYMENT").parentElement).toHaveTextContent("UNCONFIRMED");
    expect(screen.getByLabelText("ATS action confirmed")).toBeInTheDocument();
    expect(screen.getByLabelText("Payment unconfirmed")).toBeInTheDocument();
  });

  it("does not paint settlement-to-audit complete when the audit event is missing", () => {
    const types: TradeEvent["type"][] = ["HOLD_CREATED", "PAYMENT_SETTLED", "EVIDENCE_EVALUATED", "VERDICT_SIGNED", "HOLD_EXECUTED"];
    const events = types.map((type, index): TradeEvent => ({ ...eventFixture, id: `event-${index}`, type }));

    render(<TradeLifecycle events={events} />);

    expect(screen.getByTestId("lifecycle-connector-verdict-ats-action")).toHaveAttribute("data-confirmed", "true");
    expect(screen.getByTestId("lifecycle-connector-ats-action-audit")).toHaveAttribute("data-confirmed", "false");
    expect(screen.getByLabelText("Audit unconfirmed")).toBeInTheDocument();
  });
});
