import {
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  CircleDollarSign,
  DatabaseZap,
  Fingerprint,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

import { shortId, type Trade } from "../api/trades";

type FlowStep = {
  id: string;
  number: string;
  icon: LucideIcon;
  label: string;
  title: string;
  change: string;
  detail: string;
  payload: string;
  source: string;
};

const stages: FlowStep[] = [
  {
    id: "hold", number: "01", icon: LockKeyhole, label: "HEDERA ATS", title: "Lock exact units", change: "The fund units become unavailable",
    detail: "The seller binds one security, partition, buyer, unit amount, expiry, and ClearingEscrow. The held units cannot be double-spent.", payload: "EXACT UNITS → LOCKED",
    source: "Asset Tokenization Studio",
  },
  {
    id: "payment", number: "02", icon: CircleDollarSign, label: "PRIVY + X402", title: "Purchase one verdict", change: "The agent pays before it receives the verdict",
    detail: "Privy signs each Hedera transaction body remotely. The buyer validates the quoted testnet asset, payee, fee payer, and spend cap before Blocky402 settles one fee.", payload: "QUOTED FEE → SETTLED",
    source: "Privy embedded wallet · Blocky402",
  },
  {
    id: "evidence", number: "03", icon: DatabaseZap, label: "THE GRAPH", title: "Check live evidence", change: "Six deployments become one decision input",
    detail: "Verified Graph deployments produce public, derived inputs. Deterministic policy evaluates those inputs; provider credentials remain private.", payload: "DERIVED SIGNALS → PASS / FAIL",
    source: "Graph Gateway · Subgraph MCP",
  },
  {
    id: "verdict", number: "04", icon: Fingerprint, label: "SIGNED POLICY", title: "Bind the decision", change: "The decision becomes trade-specific authority",
    detail: "A signature binds the verdict to this trade digest, policy hash, evidence hash, expiry, and single-use nonce. DeepSeek may explain it, never decide it.", payload: "TRADE DIGEST + NONCE → SIGNED",
    source: "Deterministic policy · EIP-712",
  },
];

const outcomes: FlowStep[] = [
  {
    id: "execute", number: "05A", icon: ShieldCheck, label: "HEDERA ESCROW", title: "Execute the exact hold.", change: "The named buyer receives the units",
    detail: "ClearingEscrow consumes the signed nonce and delivers precisely the held fund units to the named buyer.", payload: "EXACT UNITS → NAMED BUYER",
    source: "ClearingEscrow · ATS execute hold",
  },
  {
    id: "release", number: "05B", icon: Undo2, label: "HEDERA ESCROW", title: "Release the exact hold.", change: "The seller regains the units",
    detail: "No units reach the buyer. ClearingEscrow releases the hold so those exact units become available to the seller again.", payload: "EXACT UNITS → SELLER AVAILABLE",
    source: "ClearingEscrow · ATS release hold",
  },
];

const auditStage: FlowStep = {
  id: "audit", number: "06", icon: Radio, label: "HEDERA HCS", title: "Replay public evidence", change: "Anyone can independently verify the path",
  detail: "A restricted HCS topic anchors the trade digest, payment, action, lifecycle, and settlement. Replay recomputes every binding against public chain state.",
  payload: "SIGNED DECISION → PUBLIC AUDIT",
  source: "Hedera Consensus Service · Mirror Node",
};

function confirmed(stepId: string, trade?: Trade | null) {
  if (!trade) return false;
  if (stepId === "hold") return Boolean(trade.hold.creationTransactionId && trade.hold.balances);
  if (stepId === "payment") return trade.payment?.status === "SETTLED";
  if (stepId === "evidence") return Boolean(trade.decision?.checks.length);
  if (stepId === "verdict") return Boolean(trade.decision);
  if (stepId === "execute") return trade.settlement?.action === "EXECUTE" && trade.state === "EXECUTED";
  if (stepId === "release") return trade.settlement?.action === "RELEASE" && trade.state === "RELEASED";
  if (stepId === "audit") return trade.settlement?.auditStatus === "ANCHORED" && trade.verification?.failed === 0;
  return false;
}

function livePayload(step: FlowStep, trade?: Trade | null) {
  if (!trade) return step.payload;
  if (step.id === "hold") return `${trade.hold.units} ${trade.instrument.symbol} · HOLD ${trade.hold.holdId} · ${shortId(trade.hold.creationTransactionId ?? "CHAIN CONFIRMED")}`;
  if (step.id === "payment" && trade.payment) return `${trade.payment.amount} ${trade.payment.asset} · ${trade.payment.provenance?.payerProvider === "privy" ? "PRIVY PAYER" : "HEDERA PAYER"} · ${shortId(trade.payment.transactionId ?? trade.payment.reference ?? "SETTLED")}`;
  if (step.id === "evidence" && trade.decision) return `${trade.decision.evidence.deploymentsCompared ?? "—"} DEPLOYMENTS · ${trade.decision.checks.filter((check) => check.result === "PASS").length}/${trade.decision.checks.length} CHECKS PASS · BLOCK ${trade.decision.evidence.block ?? "—"}`;
  if (step.id === "verdict" && trade.decision) return `${trade.verdict} · NONCE ${trade.decision.nonceConsumed ? "CONSUMED" : "OPEN"}`;
  if ((step.id === "execute" || step.id === "release") && trade.settlement) return `${trade.settlement.contractEvent} · BUYER ${trade.settlement.balances?.before.buyer ?? "—"} → ${trade.settlement.balances?.after.buyer ?? "—"} · ${shortId(trade.settlement.transactionId)}`;
  if (step.id === "audit" && trade.settlement?.hcsSequenceNumber != null) return `TOPIC ${trade.settlement.hcsTopicId} · SEQUENCE ${trade.settlement.hcsSequenceNumber} · REPLAY ${trade.verification ? `${Object.values(trade.verification.checks).filter(Boolean).length}/${Object.keys(trade.verification.checks).length}` : "PENDING"}`;
  return step.payload;
}

function liveFacts(stepId: string, trade?: Trade | null) {
  if (!trade) return [];
  if (stepId === "payment" && trade.payment?.provenance) return [
    `Payer ${trade.payment.provenance.payerAccountId}`,
    `Canonical USDC ${trade.payment.provenance.tokenId}`,
    `Payee ${trade.payment.provenance.payTo} · fee payer ${trade.payment.provenance.feePayer}`,
  ];
  if (stepId === "evidence" && trade.decision) return [
    `${trade.decision.evidence.standard} · ${trade.decision.evidence.protocol}/${trade.decision.evidence.network}`,
    `Deployment ${shortId(trade.decision.evidence.deploymentId ?? "unavailable")}`,
    `Query ${shortId(trade.decision.evidence.queryHash ?? "unavailable")}`,
  ];
  if ((stepId === "execute" || stepId === "release") && trade.settlement?.balances) return [
    `Seller ${trade.settlement.balances.before.seller} → ${trade.settlement.balances.after.seller}`,
    `Buyer ${trade.settlement.balances.before.buyer} → ${trade.settlement.balances.after.buyer}`,
  ];
  if (stepId === "audit") return [
    `HCS ${trade.settlement?.auditStatus ?? "DISABLED"}`,
    trade.verification ? `${trade.verification.passed}/${trade.verification.checked} anchored messages passed independent replay` : "Independent replay pending",
  ];
  return [];
}

function motionAllowed() {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ClearingFlow({ trade = null }: { trade?: Trade | null }) {
  const allSteps = useMemo(() => [...stages, ...outcomes, auditStage], []);
  const [activeId, setActiveId] = useState(stages[0].id);
  const [autoPlay, setAutoPlay] = useState(motionAllowed);
  const active = allSteps.find((step) => step.id === activeId) ?? stages[0];
  const ActiveIcon = active.icon;
  const outcomeId = trade?.settlement?.action === "RELEASE" ? "release" : "execute";
  const guideIds = useMemo(() => ["hold", "payment", "evidence", "verdict", outcomeId, "audit"], [outcomeId]);
  const activeIndex = Math.max(0, guideIds.indexOf(activeId));
  const isLive = confirmed(active.id, trade);

  useEffect(() => {
    if (!trade?.tradeDigest) return;
    setActiveId("hold");
    setAutoPlay(motionAllowed());
  }, [trade?.tradeDigest]);

  useEffect(() => {
    if (!trade || !autoPlay) return;
    const timer = window.setInterval(() => {
      setActiveId((current) => guideIds[(Math.max(0, guideIds.indexOf(current)) + 1) % guideIds.length]);
    }, 3_200);
    return () => window.clearInterval(timer);
  }, [autoPlay, guideIds, trade?.tradeDigest]);

  const inspect = (id: string) => {
    if (trade && (id === "execute" || id === "release") && id !== outcomeId) return;
    setActiveId(id);
    setAutoPlay(false);
  };

  const move = (direction: -1 | 1) => {
    const next = (activeIndex + direction + guideIds.length) % guideIds.length;
    setActiveId(guideIds[next]);
    setAutoPlay(false);
  };

  return (
    <section id="flow" className="scroll-mt-20 border-y border-hairline bg-surface py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="grid gap-6 border-b border-hairline pb-10 md:grid-cols-[1fr_0.72fr] md:items-end">
          <div>
            <p className="eyebrow">{trade ? `LIVE TRACE · ${trade.sequence}` : "INTERACTIVE CLEARING FLOW"}</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl font-normal leading-none tracking-[-1px] text-primary-copy md:text-6xl">{trade ? "Follow the completed trade, step by step." : "One held trade. Two provable outcomes."}</h2>
          </div>
          <div className="max-w-lg md:justify-self-end"><p className="text-sm leading-6 text-secondary-copy">Follow the signal from custody to finality. Select any node to see what changed, which system proved it, and the exact live evidence.</p>{trade ? <Link to={`/trades/${trade.tradeDigest}`} className="mt-4 inline-flex min-h-10 items-center border-b border-primary-copy font-mono text-xs uppercase tracking-wide text-primary-copy">Open full evidence</Link> : null}</div>
        </div>

        <div className="mt-8 overflow-hidden border border-hairline bg-canvas" aria-label="Seller locks a trade, buyer agent purchases a verdict, deterministic checks run, then ClearingEscrow executes or releases the hold">
          <div className="grid lg:grid-cols-[1fr_0.42fr]">
            <div className="relative overflow-hidden border-b border-hairline p-4 md:p-7 lg:border-b-0 lg:border-r">
              <div className="flow-grid" aria-hidden="true" />
              <div className="relative">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-copy">
                  <span>{trade ? `${trade.instrument.name} · ${trade.hold.units} ${trade.instrument.symbol}` : "Protocol map · illustrative sequence"}</span>
                  <span className="inline-flex items-center gap-2"><span className="flow-live-dot h-2 w-2 rounded-full bg-active" /> {trade ? "Chain-confirmed trace" : "Select a node"}</span>
                </div>

                <ol className="flow-stage-grid">
                  {stages.map(({ id, number, icon: Icon, label, title }, index) => {
                    const selected = activeId === id;
                    const displayedLabel = id === "payment" && trade?.payment?.provenance?.payerProvider !== "privy" ? "X402 PAYMENT" : label;
                    return (
                      <li key={id} className="contents">
                        <button type="button" aria-label={`Inspect ${displayedLabel}`} aria-pressed={selected} onClick={() => inspect(id)} className={`flow-node group relative min-h-36 border p-4 text-left focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${selected ? "flow-node-active border-active bg-surface" : "border-hairline bg-canvas/90"}`}>
                          <span className="flex items-center justify-between font-mono text-[11px] text-muted-copy"><span>{number}{confirmed(id, trade) ? " · CONFIRMED" : ""}</span><Icon className="h-4 w-4" aria-hidden="true" /></span>
                          <span className="mt-8 block font-mono text-[10px] tracking-[0.12em] text-muted-copy">{displayedLabel}</span>
                          <span className="mt-2 block text-base font-medium text-primary-copy">{title}</span>
                          {selected ? <span className="flow-node-pulse absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-active" aria-hidden="true" /> : null}
                        </button>
                        {index < stages.length - 1 ? <span data-testid="flow-connector" className="flow-connector" style={{ "--packet-delay": `${index * 200}ms` } as CSSProperties} aria-hidden="true"><ArrowDown className="h-4 w-4 md:hidden" /><ArrowRight className="hidden h-4 w-4 md:block" /><span className="flow-packet" /></span> : null}
                      </li>
                    );
                  })}
                </ol>

                <div className="flow-fork" aria-hidden="true"><span /><Braces className="h-5 w-5" /><span /></div>

                <div className="grid gap-3 md:grid-cols-2">
                  {outcomes.map(({ id, number, icon: Icon, label, title }) => {
                    const selected = activeId === id;
                    const approve = id === "execute";
                    return (
                      <button key={id} type="button" aria-label={`Inspect ${id} branch${trade && id !== outcomeId ? " (counterfactual)" : ""}`} aria-pressed={selected} disabled={Boolean(trade && id !== outcomeId)} onClick={() => inspect(id)} className={`flow-outcome group min-h-36 border p-4 text-left focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "bg-surface" : "bg-canvas/90"} ${approve ? "border-success/50" : "border-refusal/50"}`}>
                        <span className={`flex items-center justify-between font-mono text-[11px] ${approve ? "text-success" : "text-refusal-copy"}`}><span>{number} · {confirmed(id, trade) ? "CHOSEN" : label}</span><Icon className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="mt-8 block text-lg font-medium text-primary-copy">{title}</span>
                        <span className="mt-2 flex items-center gap-2 font-mono text-[10px] text-muted-copy"><Check className="h-3 w-3" aria-hidden="true" /> EXACT UNITS · ONCE</span>
                      </button>
                    );
                  })}
                </div>

                <button type="button" aria-label="Inspect Hedera HCS audit" aria-pressed={activeId === "audit"} onClick={() => inspect("audit")} className="flow-audit-join w-full focus-visible:ring-2 focus-visible:ring-active">
                  <span aria-hidden="true" />
                  <div><Radio className="h-4 w-4" aria-hidden="true" /><strong>{trade?.settlement?.auditStatus === "ANCHORED" ? `HCS AUDIT ANCHORED · SEQUENCE ${trade.settlement.hcsSequenceNumber}` : "Both branches attempt an HCS audit anchor"}</strong><small>{trade ? (confirmed("audit", trade) ? "Independent replay passed every public check" : "Anchor confirmed; independent replay pending") : "Audit status follows settlement"}</small></div>
                  <span aria-hidden="true" />
                </button>
              </div>
            </div>

            <aside className="relative flex min-h-80 flex-col justify-between bg-primary-copy p-6 text-white md:p-8" aria-live="polite">
              <div>
                <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.12em] text-white/60"><span>STEP {activeIndex + 1} OF {guideIds.length} · {isLive ? "LIVE CONFIRMED" : "GUIDE"}</span><ActiveIcon className="h-5 w-5 text-white" aria-hidden="true" /></div>
                <div className="mt-5 h-px overflow-hidden bg-white/20"><span className="flow-guide-progress block h-full origin-left bg-white" style={{ transform: `scaleX(${(activeIndex + 1) / guideIds.length})` }} /></div>
                <p className="mt-12 font-mono text-xs tracking-[0.12em] text-white/60">{active.id === "payment" && trade?.payment?.provenance?.payerProvider !== "privy" ? "X402 PAYMENT" : active.label}</p>
                <h3 className="mt-3 font-display text-4xl font-normal leading-none">{active.change}</h3>
                <p className="mt-6 text-sm leading-6 text-white/75">{active.detail}</p>
              </div>
              <div className="mt-10 border-t border-white/20 pt-5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-white/50">PROOF SOURCE · {active.source}</p>
                <p className="mt-2 font-mono text-sm text-white">{livePayload(active, trade)}</p>
                {liveFacts(active.id, trade).length ? <ul className="mt-4 space-y-1 border-l border-white/20 pl-3 font-mono text-[10px] leading-5 text-white/60">{liveFacts(active.id, trade).map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}
                {trade ? <div className="mt-6 grid grid-cols-3 gap-2"><button type="button" onClick={() => move(-1)} className="min-h-10 border border-white/20 font-mono text-[10px] uppercase text-white/75 active:translate-y-px">Previous</button><button type="button" onClick={() => setAutoPlay((value) => !value)} className="min-h-10 border border-white/20 font-mono text-[10px] uppercase text-white/75 active:translate-y-px">{autoPlay ? "Pause" : "Play"}</button><button type="button" onClick={() => move(1)} className="min-h-10 border border-white/20 font-mono text-[10px] uppercase text-white/75 active:translate-y-px">Next</button></div> : null}
              </div>
            </aside>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-l-2 border-primary-copy pl-4 font-mono text-xs leading-5 text-muted-copy"><span className="text-primary-copy">TRUST BOUNDARY</span><span>ATS hold prevents double-spend</span><span>ClearingEscrow is sole executor</span><span>Nonce is single-use</span></div>
      </div>
    </section>
  );
}
