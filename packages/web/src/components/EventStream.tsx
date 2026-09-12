import { useEffect, useState } from "react";

import { fetchTradeEvents, shortId, type Trade, type TradeEvent } from "../api/trades";
import { StatusChip } from "./StatusChip";

type EventState =
  | { status: "idle" | "loading"; events: TradeEvent[] }
  | { status: "ready"; events: TradeEvent[] }
  | { status: "error"; events: TradeEvent[] };

export function EventStream({ trades }: { trades: Trade[] }) {
  const [selectedDigest, setSelectedDigest] = useState(trades[0]?.tradeDigest ?? "");
  const [retryKey, setRetryKey] = useState(0);
  const [eventState, setEventState] = useState<EventState>({ status: "idle", events: [] });
  const selected = trades.find((trade) => trade.tradeDigest === selectedDigest) ?? trades[0];

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: number | undefined;
    setEventState({ status: "loading", events: [] });
    const digest = selected.tradeDigest;
    const refresh = async () => {
      try {
        const events = await fetchTradeEvents(digest, controller.signal);
        setEventState({ status: "ready", events });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setEventState({ status: "error", events: [] });
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 2_000);
      }
    };
    void refresh();
    return () => { controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [selected?.tradeDigest, retryKey]);

  if (!selected) return null;

  return (
    <section id="activity" className="scroll-mt-24 border-y border-hairline bg-surface py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">CLEARING ACTIVITY</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-tight text-primary-copy md:text-5xl">
              One held trade. Every confirmed step.
            </h2>
          </div>
          <StatusChip status="LIVE" />
        </div>

        <div className="border border-hairline bg-canvas">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 font-mono text-xs md:px-5">
            <span className="text-primary-copy">TRADE / {shortId(selected.tradeDigest)}</span>
            <span className="rounded-full bg-chip px-2.5 py-1 text-muted-copy">{selected.hold.holdId}</span>
          </div>
          <div className="grid lg:grid-cols-[280px_1fr]">
            <div className="border-b border-hairline lg:border-b-0 lg:border-r">
              {trades.map((trade) => (
                <button
                  key={trade.tradeDigest}
                  type="button"
                  onClick={() => setSelectedDigest(trade.tradeDigest)}
                  className={`flex min-h-16 w-full items-center gap-3 border-b border-hairline px-4 text-left font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-active ${
                    selected.tradeDigest === trade.tradeDigest ? "bg-chip text-primary-copy" : "text-muted-copy hover:bg-chip/60"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${trade.state === "EXECUTED" ? "bg-success" : ["DENIED", "RELEASED", "EXPIRED", "FAILED"].includes(trade.state) ? "bg-refusal" : "bg-active"}`} aria-hidden="true" />
                  <span>
                    <span className="block">{trade.sequence}</span>
                    <span className="mt-1 block text-secondary-copy">{trade.instrument.symbol} · {trade.hold.units} units</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="min-h-72 p-5 md:p-6">
              {eventState.status === "loading" || eventState.status === "idle" ? (
                <div aria-label="Loading trade activity" className="space-y-3">
                  {[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse bg-chip motion-reduce:animate-none" />)}
                </div>
              ) : eventState.status === "error" ? (
                <div className="flex min-h-56 flex-col justify-center border border-hairline p-6">
                  <p className="text-lg font-medium text-primary-copy">Activity unavailable</p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-secondary-copy">The trade summary loaded, but its lifecycle events could not be confirmed.</p>
                  <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-5 min-h-10 self-start bg-action px-4 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-active">Retry activity</button>
                </div>
              ) : eventState.events.length === 0 ? (
                <div className="flex min-h-56 flex-col justify-center border border-hairline p-6">
                  <p className="text-lg font-medium text-primary-copy">No confirmed events yet</p>
                  <p className="mt-2 text-sm text-secondary-copy">This hold is waiting for its first backend-confirmed lifecycle event.</p>
                </div>
              ) : (
                <ol className="relative space-y-0 before:absolute before:bottom-5 before:left-[7px] before:top-5 before:w-px before:bg-hairline">
                  {eventState.events.map((event) => (
                    <li key={event.id} className="relative grid grid-cols-[16px_1fr_auto] gap-4 border-b border-hairline py-4 font-mono text-xs last:border-b-0">
                      <span className="relative z-10 mt-1 h-3.5 w-3.5 rounded-full border-4 border-canvas bg-active" aria-hidden="true" />
                      <span><span className="block text-primary-copy">{event.type.replaceAll("_", " ")}</span><span className="mt-1 block leading-5 text-muted-copy">{event.publicDetail}</span></span>
                      <time className="text-muted-copy" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
