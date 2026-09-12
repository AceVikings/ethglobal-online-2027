import { ArrowDown, ArrowUpRight, GitCompareArrows, ShieldCheck, Waypoints } from "lucide-react";
import type { CSSProperties } from "react";

import { DecisionCard } from "../components/DecisionCard";
import { EventStream } from "../components/EventStream";
import { decisions } from "../data/decisions";

const metrics = [
  { value: "2.4", unit: "s", label: "Median decision time" },
  { value: "06", unit: "deployments", label: "Pinned Graph sources" },
  { value: "83", unit: "%", label: "Conformance rate" },
  { value: "00", unit: "tx", label: "Submitted on refusal" },
];

const TIMING = {
  heading: "0ms",
  copy: "200ms",
  action: "400ms",
} as const;

const entranceDelay = (delay: string) => ({ "--entrance-delay": delay }) as CSSProperties;

export function HomePage() {
  return (
    <main>
      <section className="hero-cinematic relative flex min-h-[100svh] items-center justify-center overflow-hidden px-4 pb-16 pt-32 md:px-8 md:pt-28">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src="/conformance-hero-loop.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
        <div className="hero-overlay absolute inset-0" aria-hidden="true" />
        {/* Storyboard: landscape settles in, headline rises, supporting copy follows, then the primary action arrives. */}
        <div className="relative mx-auto flex w-full max-w-7xl flex-col items-center text-center">
          <h1
            className="fade-rise max-w-4xl font-display text-5xl font-normal leading-[0.95] tracking-[-2.46px] text-primary-copy md:text-[80px]"
            style={entranceDelay(TIMING.heading)}
          >
            Proof before <em className="not-italic">execution.</em>
          </h1>
          <p
            className="fade-rise mt-8 max-w-[670px] text-base leading-[1.625] text-secondary-copy md:text-lg"
            style={entranceDelay(TIMING.copy)}
          >
            Turn live Graph evidence into a signed verdict before value moves. Conformant operations execute on Hedera; refusals preserve the same complete audit trail.
          </p>
          <a
            href="#desk"
            className="fade-rise pill-action mt-12 inline-flex min-h-16 items-center gap-4 bg-action px-14 text-base font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            style={entranceDelay(TIMING.action)}
          >
            Explore the decision desk <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>

      <section id="desk" className="scroll-mt-12 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="eyebrow">THE DESK</p>
              <h2 className="mt-4 font-display text-4xl font-normal tracking-[-1px] text-primary-copy md:text-6xl">Two outcomes. Equal evidence.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-secondary-copy">
              The operation changes. The card does not. A refusal is a first-class decision, not a diminished error state.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {decisions.slice(0, 2).map((decision) => <DecisionCard key={decision.id} decision={decision} />)}
          </div>
        </div>
      </section>

      <EventStream />

      <section id="coverage" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
          <div className="mb-10">
            <p className="eyebrow">SYSTEM COVERAGE</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl font-normal tracking-[-1px] text-primary-copy md:text-6xl">The chain is the diagram.</h2>
          </div>

          <div className="grid gap-px bg-hairline md:grid-cols-3">
            <article className="min-h-80 bg-surface p-6">
              <ShieldCheck className="h-5 w-5 text-active" aria-hidden="true" />
              <p className="eyebrow mt-8">REGRESSION</p>
              <h3 className="mt-3 text-xl font-medium text-primary-copy">Five checks. One precedence.</h3>
              <div className="mt-8 space-y-3 font-mono text-xs">
                {[
                  ["CID MATCH", "PASS", "+0.0%"],
                  ["INDEXING", "PASS", "+0.0%"],
                  ["FRESHNESS", "FAIL", "+41 blk"],
                  ["SHAPE AGREEMENT", "PASS", "+0.0%"],
                  ["INVARIANTS", "PASS", "+0.0%"],
                ].map(([label, status, delta]) => (
                  <div key={label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-hairline pb-3">
                    <span className="text-secondary-copy">{label}</span>
                    <span className={status === "FAIL" ? "text-refusal" : "text-success"}>{status}</span>
                    <span className="text-muted-copy">{delta}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="min-h-80 bg-surface p-6">
              <Waypoints className="h-5 w-5 text-active" aria-hidden="true" />
              <p className="eyebrow mt-8">FAILURE CLUSTERING</p>
              <h3 className="mt-3 text-xl font-medium text-primary-copy">Find the weak surface.</h3>
              <div className="mt-8 space-y-5 font-mono text-xs">
                {[
                  ["CID DRIFT", 72], ["BLOCK LAG", 46], ["SCHEMA", 18], ["INVARIANT", 8],
                ].map(([label, width]) => (
                  <div key={label}>
                    <div className="mb-2 flex justify-between text-muted-copy"><span>{label}</span><span>{width}%</span></div>
                    <div className="h-1.5 bg-chip"><div className="h-full bg-timeline" style={{ width: `${width}%` }} /></div>
                  </div>
                ))}
              </div>
            </article>

            <article className="min-h-80 bg-surface p-6">
              <GitCompareArrows className="h-5 w-5 text-active" aria-hidden="true" />
              <p className="eyebrow mt-8">VERDICT REPLAY</p>
              <h3 className="mt-3 text-xl font-medium text-primary-copy">Recompute, don’t trust.</h3>
              <div className="mt-8 space-y-2 font-mono text-xs leading-6">
                <p className="border-l border-success pl-3 text-secondary-copy"><span className="text-success">+</span> signalHash matches</p>
                <p className="border-l border-success pl-3 text-secondary-copy"><span className="text-success">+</span> anchorDigest matches</p>
                <p className="border-l border-active pl-3 text-secondary-copy"><span className="text-active">~</span> mirror consensus 14:42:09</p>
                <p className="border-l border-success pl-3 text-secondary-copy"><span className="text-success">+</span> verdict signature valid</p>
              </div>
            </article>
          </div>

          <div className="mt-px grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="bg-canvas p-6 md:min-h-48">
                <div className="flex items-baseline gap-2 font-mono text-primary-copy">
                  <span className="text-5xl tracking-[-0.06em] md:text-6xl">{metric.value}</span>
                  <span className="text-xs text-muted-copy">{metric.unit}</span>
                </div>
                <p className="mt-6 max-w-40 font-mono text-xs leading-5 text-muted-copy">{metric.label}</p>
              </div>
            ))}
          </div>

          <a href="#desk" className="pill-action mt-10 inline-flex min-h-12 items-center gap-3 bg-action px-6 font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
            Inspect current decisions <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>
    </main>
  );
}
