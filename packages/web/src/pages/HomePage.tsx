import { ArrowDown, ArrowUpRight, Bot, Braces, CircleDollarSign, LockKeyhole, ScrollText } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { fetchTrades, type TradeListResponse } from "../api/trades";
import { ClearingFlow } from "../components/ClearingFlow";
import { DecisionCard } from "../components/DecisionCard";
import { EventStream } from "../components/EventStream";

const TIMING = { heading: "0ms", copy: "200ms", action: "400ms" } as const;
const entranceDelay = (delay: string) => ({ "--entrance-delay": delay }) as CSSProperties;

type DeskState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: TradeListResponse }
  | { status: "error"; data: null };

const proofSteps = [
  { icon: LockKeyhole, eyebrow: "ATS HOLD", title: "Units lock before evaluation.", copy: "The seller names one buyer, exact units, expiry, and ClearingEscrow. Held units cannot be double-spent." },
  { icon: CircleDollarSign, eyebrow: "X402 PAYMENT", title: "The agent buys one decision.", copy: "The bounded buyer validates Hedera testnet terms and settles the quoted price through Blocky402." },
  { icon: Braces, eyebrow: "LIVE EVIDENCE", title: "Deterministic checks decide.", copy: "Verified Graph deployments produce derived evidence. Raw provider rows and credentials stay inside the service." },
  { icon: Bot, eyebrow: "AI EXPLANATION", title: "DeepSeek explains—not decides.", copy: "The model summarizes the fixed result and has no signing key, custody, issuer role, or power to override policy." },
  { icon: ScrollText, eyebrow: "FINALITY + AUDIT", title: "Execute or release exactly once.", copy: "The contract consumes the bound verdict, changes the ATS hold, then emits matching contract and HCS evidence." },
];

const proofGridClasses = [
  "lg:col-span-5",
  "lg:col-span-3",
  "lg:col-span-4",
  "lg:col-span-7",
  "lg:col-span-5",
] as const;

export function HomePage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [desk, setDesk] = useState<DeskState>({ status: "loading", data: null });

  useEffect(() => {
    const controller = new AbortController();
    setDesk({ status: "loading", data: null });
    fetchTrades(controller.signal)
      .then((data) => setDesk({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDesk({ status: "error", data: null });
      });
    return () => controller.abort();
  }, [reloadKey]);

  const metrics = desk.status === "ready" ? (() => {
    const awaitingStates = new Set(["HOLD_PENDING", "PAYMENT_REQUIRED", "PAYMENT_SETTLED", "EVALUATING"]);
    const durations = desk.data.trades.flatMap((trade) => {
      if (!trade.settlement) return [];
      const duration = new Date(trade.settlement.consensusAt).getTime() - new Date(trade.hold.createdAt).getTime();
      return duration >= 0 ? [duration] : [];
    }).sort((a, b) => a - b);
    const medianMs = durations.length ? durations[Math.floor(durations.length / 2)] : null;
    return [
      { value: desk.data.trades.filter((trade) => awaitingStates.has(trade.state)).length.toString(), unit: "trades", label: "Awaiting decision in current view" },
      { value: desk.data.trades.filter((trade) => trade.state === "EXECUTED").length.toString(), unit: "holds", label: "Executed in current view" },
      { value: desk.data.trades.filter((trade) => trade.state === "RELEASED").length.toString(), unit: "holds", label: "Released in current view" },
      { value: medianMs === null ? "—" : (medianMs / 1000).toFixed(1), unit: medianMs === null ? "" : "s", label: "Median confirmed clearing time" },
    ];
  })() : null;

  return (
    <main>
      <section className="hero-cinematic relative flex min-h-[100svh] items-center justify-center overflow-hidden px-4 pb-16 pt-32 md:px-8 md:pt-28">
        <img className="hero-still-layer absolute inset-0 h-full w-full object-cover" src="/clearing-desk-hero-v3.webp" width="1672" height="941" alt="" fetchPriority="high" aria-hidden="true" />
        <div className="hero-overlay absolute inset-0" aria-hidden="true" />
        <div className="hero-content relative mx-auto flex w-full max-w-7xl flex-col items-center text-center">
          <p className="fade-rise mb-5 font-mono text-xs uppercase tracking-[0.18em] text-secondary-copy" style={entranceDelay(TIMING.heading)}>ATS FUND-UNIT CLEARING · HEDERA TESTNET</p>
          <h1 className="fade-rise max-w-[22rem] font-display text-[42px] font-normal leading-[0.95] tracking-[-2.46px] text-primary-copy md:max-w-5xl md:text-[80px]" style={entranceDelay(TIMING.heading)}>
            Private-credit trades that clear only after proof.
          </h1>
          <p className="fade-rise mt-8 max-w-[670px] text-base leading-[1.625] text-secondary-copy md:text-lg" style={entranceDelay(TIMING.copy)}>
            A seller locks ATS fund units. A buyer agent pays for a live-data verdict. The clearing contract executes or releases that exact hold.
          </p>
          <a href="#desk" className="fade-rise pill-action mt-8 inline-flex min-h-14 items-center gap-4 bg-action px-14 text-base font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas" style={entranceDelay(TIMING.action)}>
            View clearing desk <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>

      <ClearingFlow />

      <section id="desk" className="scroll-mt-12 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
          <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div><p className="eyebrow">CLEARING DESK</p><h2 className="mt-4 max-w-3xl font-display text-4xl font-normal tracking-[-1px] text-primary-copy md:text-6xl">Held trades. Confirmed outcomes.</h2></div>
            <p className="max-w-md text-sm leading-6 text-secondary-copy">Lifecycle state stays separate from verdict: approval is not clearance until the exact ATS hold reaches finality.</p>
          </div>

          {desk.status === "loading" ? (
            <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading clearing desk">
              {[0, 1].map((item) => <div key={item} className="h-72 animate-pulse border border-hairline bg-surface motion-reduce:animate-none" />)}
            </div>
          ) : desk.status === "error" ? (
            <div className="border border-refusal/50 bg-surface p-6 md:p-8">
              <p className="eyebrow text-refusal">BACKEND UNAVAILABLE</p>
              <h3 className="mt-4 text-2xl font-medium text-primary-copy">Live trade state could not be confirmed.</h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-secondary-copy">No fixture trades are shown in place of the API. Start the clearing service or check the configured API base URL, then retry.</p>
              <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="mt-6 inline-flex min-h-11 items-center bg-action px-5 font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2">Retry connection</button>
            </div>
          ) : desk.data.trades.length === 0 ? (
            <div className="border border-hairline bg-surface p-6 md:p-8"><p className="text-xl font-medium text-primary-copy">No held trades</p><p className="mt-2 text-sm text-secondary-copy">New ATS holds will appear after the backend confirms them.</p></div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">{desk.data.trades.map((trade) => <DecisionCard key={trade.tradeDigest} trade={trade} />)}</div>
          )}
        </div>
      </section>

      {desk.status === "ready" && desk.data.trades.length > 0 ? <EventStream trades={desk.data.trades} /> : null}

      <section id="proof" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
          <div className="mb-10"><p className="eyebrow">HOW THE TRADE CLEARS</p><h2 className="mt-4 max-w-3xl font-display text-4xl font-normal tracking-[-1px] text-primary-copy md:text-6xl">Authority stays with policy and escrow.</h2></div>
          <div className="grid gap-px bg-hairline md:grid-cols-2 lg:grid-cols-12">
            {proofSteps.map(({ icon: Icon, eyebrow, title, copy }, index) => (
              <article key={eyebrow} className={`min-h-72 bg-surface p-6 ${proofGridClasses[index]}`}><Icon className="h-5 w-5 text-active" aria-hidden="true" /><p className="eyebrow mt-8">{eyebrow}</p><h3 className="mt-3 max-w-sm text-xl font-medium text-primary-copy">{title}</h3><p className="mt-4 max-w-md text-sm leading-6 text-secondary-copy">{copy}</p></article>
            ))}
          </div>

          <div className="mt-px grid gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            {desk.status === "loading" ? [0, 1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse bg-chip motion-reduce:animate-none" />) : metrics ? metrics.map((metric) => (
              <div key={metric.label} className="bg-canvas p-6 md:min-h-48"><div className="flex items-baseline gap-2 font-mono text-primary-copy"><span className="text-5xl tracking-[-0.06em] md:text-6xl">{metric.value}</span><span className="text-xs text-muted-copy">{metric.unit}</span></div><p className="mt-6 max-w-40 font-mono text-xs leading-5 text-muted-copy">{metric.label}</p></div>
            )) : <div className="col-span-full bg-canvas p-6 font-mono text-xs text-muted-copy">Proof metrics appear only when returned by the clearing API.</div>}
          </div>

          <a href="#desk" className="pill-action mt-10 inline-flex min-h-12 items-center gap-3 bg-action px-6 font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">Inspect live trades <ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>
        </div>
      </section>
    </main>
  );
}
