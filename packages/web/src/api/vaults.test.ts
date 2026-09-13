import { afterEach, describe, expect, it, vi } from "vitest";

import { watchRunEvents } from "./vaults";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("watchRunEvents", () => {
  it("streams only backend-issued events with bearer auth and Last-Event-ID", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('id: 3\ndata: {"id":"3","type":"AUTHORIZED","label":"Policy authorized","detail":"Deterministic checks passed","status":"confirmed","occurredAt":"2026-09-13T10:03:00.000Z"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const received: string[] = [];

    await watchRunEvents("run-91", "privy-token", "2", (event) => received.push(event.label));

    expect(received).toEqual(["Policy authorized"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/runs/run-91/events", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer privy-token", "Last-Event-ID": "2" }),
    }));
  });
});
