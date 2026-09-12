import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventFixture, jsonResponse, tradeFixture } from "../test/tradeFixture";
import { HomePage } from "./HomePage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("HomePage", () => {
  it("renders the ATS clearing story and API-backed trades", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => {
      if (input.endsWith("/events")) return Promise.resolve(jsonResponse([eventFixture]));
      return Promise.resolve(jsonResponse({ trades: [tradeFixture], nextCursor: null }));
    }));

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Private-credit trades that clear only after proof." })).toBeInTheDocument();
    expect(screen.getByText("View clearing desk")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "One held trade. Two provable outcomes." })).toBeInTheDocument();
    expect(await screen.findByText("250 NPCF")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek explains—not decides.")).toBeInTheDocument();
    expect(screen.getByText("180.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View clearing desk" })).toHaveAttribute("href", "/?section=desk");

    const heroImage = document.querySelector("img[src='/clearing-desk-hero-v3.webp']");
    expect(heroImage).toHaveAttribute("width", "1672");
    expect(document.querySelector("video")).not.toBeInTheDocument();
  }, 10_000);

  it("never substitutes fixtures when the backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(await screen.findByText("Live trade state could not be confirmed.")).toBeInTheDocument();
    expect(screen.queryByText("Northstar Private Credit Fund")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
  });
});
