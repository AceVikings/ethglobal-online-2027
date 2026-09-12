import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

    const hold = screen.getByRole("button", { name: /inspect ats hold/i });
    const verdict = screen.getByRole("button", { name: /inspect signed verdict/i });

    expect(hold).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Custody changes here")).toBeInTheDocument();

    fireEvent.click(verdict);

    expect(verdict).toHaveAttribute("aria-pressed", "true");
    expect(hold).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Authority changes here")).toBeInTheDocument();
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
});
