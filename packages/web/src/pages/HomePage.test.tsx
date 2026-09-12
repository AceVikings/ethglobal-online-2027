import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { HomePage } from "./HomePage";

afterEach(cleanup);

describe("HomePage", () => {
  it("renders the generated hero artwork with supporting motion", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Proof before execution." })).toBeInTheDocument();
    expect(screen.getByText("Explore the decision desk")).toBeInTheDocument();

    const heroImage = document.querySelector("img[src='/conformance-hero-v2.webp']");
    expect(heroImage).toBeInTheDocument();
    expect(heroImage).toHaveAttribute("width", "1672");
    expect(heroImage).toHaveAttribute("height", "941");

    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/conformance-hero-loop.mp4");
    expect(video).toHaveAttribute("poster", "/conformance-hero-v2.webp");
    expect(video).toHaveAttribute("preload", "metadata");
  });

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
