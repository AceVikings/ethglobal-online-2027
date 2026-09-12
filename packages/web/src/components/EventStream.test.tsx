import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventFixture, jsonResponse, tradeFixture } from "../test/tradeFixture";
import { EventStream } from "./EventStream";

afterEach(() => vi.unstubAllGlobals());

describe("EventStream", () => {
  it("loads backend-confirmed lifecycle events for the selected trade", async () => {
    const secondTrade = { ...tradeFixture, tradeDigest: "0xabcdef1234567890" as const, sequence: "CLR-002", state: "RELEASED" as const };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([eventFixture])));
    vi.stubGlobal("fetch", fetchMock);

    render(<EventStream trades={[tradeFixture, secondTrade]} />);
    expect(await screen.findByText("HOLD EXECUTED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /CLR-002/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/trades/${encodeURIComponent(secondTrade.tradeDigest)}/events`,
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    ));
  });

  it("shows an explicit unavailable state when events cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<EventStream trades={[tradeFixture]} />);
    expect(await screen.findByText("Activity unavailable")).toBeInTheDocument();
  });
});
