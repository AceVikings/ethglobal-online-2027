import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClearingFlow } from "./ClearingFlow";

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
});
