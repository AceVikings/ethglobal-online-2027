import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TradeState } from "../api/trades";
import { StatusChip } from "./StatusChip";

afterEach(cleanup);

describe("StatusChip", () => {
  it.each<[TradeState, string]>([
    ["HOLD_PENDING", "Held · awaiting agent"],
    ["PAYMENT_REQUIRED", "Decision payment required"],
    ["PAYMENT_SETTLED", "Decision purchased"],
    ["EVALUATING", "Checking live evidence"],
    ["APPROVED", "Approved · awaiting execution"],
    ["DENIED", "Denied · awaiting release"],
    ["EXECUTING", "Executing hold"],
    ["RELEASING", "Releasing hold"],
    ["EXECUTED", "Cleared"],
    ["RELEASED", "Released"],
    ["EXPIRED", "Hold expired"],
    ["FAILED", "Action required"],
  ])("maps %s to its exact lifecycle label", (state, label) => {
    render(<StatusChip status={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
