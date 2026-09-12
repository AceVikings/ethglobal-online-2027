import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("renders all five regression checks", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    const regressionCard = screen
      .getByRole("heading", { name: "Five checks. One precedence." })
      .closest("article");

    expect(regressionCard).not.toBeNull();

    const card = within(regressionCard!);
    for (const label of [
      "CID MATCH",
      "INDEXING",
      "FRESHNESS",
      "SHAPE AGREEMENT",
      "INVARIANTS",
    ]) {
      expect(card.getByText(label)).toBeInTheDocument();
    }
  });
});
