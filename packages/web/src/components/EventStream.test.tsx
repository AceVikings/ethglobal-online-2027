import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { decisions } from "../data/decisions";
import { EventStream } from "./EventStream";

describe("EventStream", () => {
  it("renders each decision's absolute spans against its own total duration", () => {
    for (const decision of decisions) {
      expect(decision.spans.length).toBeGreaterThan(0);

      for (const span of decision.spans) {
        expect(span.startMs).toBeGreaterThanOrEqual(0);
        expect(span.durationMs).toBeGreaterThan(0);
        expect(span.startMs + span.durationMs).toBeLessThanOrEqual(decision.durationMs);
      }
    }

    render(<EventStream />);
    const selected = decisions[1];
    const anchor = selected.spans.find((span) => span.label === "hcs.anchor");
    expect(anchor).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(selected.sequence) }));

    const timeline = screen.getByLabelText("hcs.anchor timeline position");
    const bar = timeline.firstElementChild;
    expect(bar).toHaveStyle({
      left: `${(anchor!.startMs / selected.durationMs) * 100}%`,
      width: `${(anchor!.durationMs / selected.durationMs) * 100}%`,
    });
    expect(within(timeline.parentElement!).getByText(`${anchor!.durationMs} ms`)).toBeInTheDocument();
  });
});
