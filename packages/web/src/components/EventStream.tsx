import { useState } from "react";

import { decisions, defaultSpans, getDecision } from "../data/decisions";
import { StatusChip } from "./StatusChip";

export function EventStream() {
  const [selectedId, setSelectedId] = useState(decisions[0].id);
  const selected = getDecision(selectedId) ?? decisions[0];
  const spans = selected.spans ?? defaultSpans;

  return (
    <section id="stream" className="scroll-mt-24 border-y border-hairline bg-surface py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="eyebrow">EVENT STREAM</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-tight text-primary-copy md:text-5xl">
              Every decision leaves a readable trail.
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusChip status="PREVIEW" />
            <span className="font-mono text-xs text-muted-copy">STATIC DATA · API PENDING</span>
          </div>
        </div>

        <div className="border border-hairline bg-canvas">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 font-mono text-xs md:px-5">
            <span className="text-primary-copy">TRACE / {selected.signalHash}</span>
            <span className="rounded-full bg-chip px-2.5 py-1 text-muted-copy">{selected.durationMs} MS</span>
          </div>
          <div className="grid lg:grid-cols-[240px_1fr]">
            <div className="border-b border-hairline lg:border-b-0 lg:border-r">
              {decisions.map((decision) => (
                <button
                  key={decision.id}
                  type="button"
                  onClick={() => setSelectedId(decision.id)}
                  className={`flex min-h-16 w-full items-center gap-3 border-b border-hairline px-4 text-left font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-active ${
                    selected.id === decision.id ? "bg-chip text-primary-copy" : "text-muted-copy hover:bg-chip/60"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${decision.verdict === "CONFORMANT" ? "bg-success" : "bg-refusal"}`} aria-hidden="true" />
                  <span>
                    <span className="block">{decision.sequence}</span>
                    <span className="mt-1 block text-secondary-copy">{decision.issuedAt}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[1fr_2fr_100px] gap-6 border-b border-hairline px-5 py-3 font-mono text-xs text-muted-copy">
                  <span>SPAN</span><span>START</span><span className="text-right">DURATION</span>
                </div>
                {spans.map((span) => (
                  <div key={span.label} className="grid min-h-16 grid-cols-[1fr_2fr_100px] items-center gap-6 border-b border-hairline px-5 font-mono text-xs last:border-b-0">
                    <span className={span.active ? "text-active" : "text-primary-copy"}>{span.label}</span>
                    <div className="relative h-1.5 w-full bg-chip" aria-label={`${span.label} timeline position`}>
                      <span
                        className={`absolute inset-y-0 ${span.active ? "bg-active" : "bg-timeline"}`}
                        style={{ left: `${span.startPercent}%`, width: `${span.widthPercent}%` }}
                      />
                    </div>
                    <span className="text-right text-muted-copy">{span.duration}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
