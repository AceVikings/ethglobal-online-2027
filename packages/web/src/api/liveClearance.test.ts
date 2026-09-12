import { describe, expect, it, vi } from "vitest";
import { createLiveMandate, streamLiveClearance } from "./liveClearance";

describe("live clearance API", () => {
  it("creates an exact five-minute bounded mandate", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "demo-nonce-12345678" });
    const mandate = createLiveMandate(
      "did:privy:demo-user",
      "0x1234567890abcdef1234567890abcdef12345678",
      new Date("2026-09-13T04:30:00.000Z"),
    );
    expect(mandate).toMatchObject({
      network: "hedera:testnet", asset: "SPCF", units: "1.0",
      maxDecisionFee: "0.01 USDC", policy: "strict-market-health",
      expiresAt: "2026-09-13T04:35:00.000Z", nonce: "demo-nonce-12345678",
    });
    vi.unstubAllGlobals();
  });

  it("consumes stage events before returning public proof", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"stage","stage":{"id":"hold","status":"confirmed","title":"Held","detail":"Final"}}\n'));
        controller.enqueue(encoder.encode('{"type":"complete","result":{"runId":"run-1","tradeDigest":"0xabc","proof":{}}}\n'));
        controller.close();
      },
    }), { status: 200 })));
    const stages: string[] = [];
    const result = await streamLiveClearance({ mandate: {} as never, signature: "0xsigned" }, "token", (stage) => stages.push(stage.id));
    expect(stages).toEqual(["hold"]);
    expect(result.runId).toBe("run-1");
    vi.unstubAllGlobals();
  });
});
