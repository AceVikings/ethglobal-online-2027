import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { eventFixture } from "../test/tradeFixture";
import { TradeLifecycle } from "./TradeLifecycle";

describe("TradeLifecycle", () => {
  it("marks only backend-confirmed stages complete", () => {
    render(<TradeLifecycle events={[eventFixture]} />);

    expect(screen.getByRole("list", { name: "Confirmed trade lifecycle" })).toBeInTheDocument();
    expect(screen.getByText("ATS ACTION").parentElement).not.toHaveTextContent("UNCONFIRMED");
    expect(screen.getByText("PAYMENT").parentElement).toHaveTextContent("UNCONFIRMED");
  });
});
