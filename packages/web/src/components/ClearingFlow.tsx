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
import { useState } from "react";
import type { CSSProperties } from "react";

type FlowStep = {
  id: string;
  number: string;
  icon: LucideIcon;
  label: string;
  title: string;
  change: string;
  detail: string;
  payload: string;
};

const stages: FlowStep[] = [
  {
    id: "hold", number: "01", icon: LockKeyhole, label: "ATS HOLD", title: "Lock exact units", change: "Custody changes here",
    detail: "The seller binds one security, partition, buyer, unit amount, expiry, and ClearingEscrow. The held units cannot be double-spent.", payload: "EXACT UNITS → LOCKED",
  },
  {
    id: "payment", number: "02", icon: CircleDollarSign, label: "X402 PAYMENT", title: "Purchase one verdict", change: "Payment changes here",
    detail: "The buyer agent validates the quoted Hedera testnet terms before Blocky402 settles one bounded decision fee.", payload: "QUOTED FEE → SETTLED",
  },
  {
    id: "evidence", number: "03", icon: DatabaseZap, label: "GRAPH EVIDENCE", title: "Check live evidence", change: "Knowledge changes here",
    detail: "Verified Graph deployments produce public, derived inputs. Deterministic policy evaluates those inputs; provider credentials remain private.", payload: "DERIVED SIGNALS → PASS / FAIL",
  },
  {
    id: "verdict", number: "04", icon: Fingerprint, label: "SIGNED VERDICT", title: "Bind the decision", change: "Authority changes here",
    detail: "A signature binds the verdict to this trade digest, policy hash, evidence hash, expiry, and single-use nonce. DeepSeek may explain it, never decide it.", payload: "TRADE DIGEST + NONCE → SIGNED",
  },
];

const outcomes: FlowStep[] = [
  {
    id: "execute", number: "05A", icon: ShieldCheck, label: "POLICY APPROVES", title: "Execute the exact hold.", change: "Units move to the buyer",
    detail: "ClearingEscrow consumes the signed nonce and delivers precisely the held fund units to the named buyer.", payload: "EXACT UNITS → NAMED BUYER",
  },
  {
    id: "release", number: "05B", icon: Undo2, label: "POLICY DENIES", title: "Release the exact hold.", change: "Units return to the seller",
    detail: "No units reach the buyer. ClearingEscrow releases the hold so those exact units become available to the seller again.", payload: "EXACT UNITS → SELLER AVAILABLE",
  },
];

export function ClearingFlow() {
  const allSteps = [...stages, ...outcomes];
  const [activeId, setActiveId] = useState(stages[0].id);
  const active = allSteps.find((step) => step.id === activeId) ?? stages[0];
  const ActiveIcon = active.icon;

  return (
    <section id="flow" className="scroll-mt-20 border-y border-hairline bg-surface py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="grid gap-6 border-b border-hairline pb-10 md:grid-cols-[1fr_0.72fr] md:items-end">
          <div>
            <p className="eyebrow">INTERACTIVE CLEARING FLOW</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl font-normal leading-none tracking-[-1px] text-primary-copy md:text-6xl">One held trade. Two provable outcomes.</h2>
          </div>
          <p className="max-w-lg text-sm leading-6 text-secondary-copy md:justify-self-end">Follow the signal from custody to finality. Select any node to see exactly what changes—and what does not.</p>
        </div>

        <div className="mt-8 overflow-hidden border border-hairline bg-canvas" aria-label="Seller locks a trade, buyer agent purchases a verdict, deterministic checks run, then ClearingEscrow executes or releases the hold">
          <div className="grid lg:grid-cols-[1fr_0.42fr]">
            <div className="relative overflow-hidden border-b border-hairline p-4 md:p-7 lg:border-b-0 lg:border-r">
              <div className="flow-grid" aria-hidden="true" />
              <div className="relative">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-copy">
                  <span>Protocol map · illustrative sequence</span>
                  <span className="inline-flex items-center gap-2"><span className="flow-live-dot h-2 w-2 rounded-full bg-active" /> Select a node</span>
                </div>

                <ol className="flow-stage-grid">
                  {stages.map(({ id, number, icon: Icon, label, title }, index) => {
                    const selected = activeId === id;
                    return (
                      <li key={id} className="contents">
                        <button type="button" aria-label={`Inspect ${label}`} aria-pressed={selected} onClick={() => setActiveId(id)} className={`flow-node group relative min-h-36 border p-4 text-left focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${selected ? "flow-node-active border-active bg-surface" : "border-hairline bg-canvas/90"}`}>
                          <span className="flex items-center justify-between font-mono text-[11px] text-muted-copy"><span>{number}</span><Icon className="h-4 w-4" aria-hidden="true" /></span>
                          <span className="mt-8 block font-mono text-[10px] tracking-[0.12em] text-muted-copy">{label}</span>
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
                      <button key={id} type="button" aria-label={`Inspect ${id} branch`} aria-pressed={selected} onClick={() => setActiveId(id)} className={`flow-outcome group min-h-36 border p-4 text-left focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${selected ? "bg-surface" : "bg-canvas/90"} ${approve ? "border-success/50" : "border-refusal/50"}`}>
                        <span className={`flex items-center justify-between font-mono text-[11px] ${approve ? "text-success" : "text-refusal-copy"}`}><span>{number} · {label}</span><Icon className="h-4 w-4" aria-hidden="true" /></span>
                        <span className="mt-8 block text-lg font-medium text-primary-copy">{title}</span>
                        <span className="mt-2 flex items-center gap-2 font-mono text-[10px] text-muted-copy"><Check className="h-3 w-3" aria-hidden="true" /> EXACT UNITS · ONCE</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flow-audit-join">
                  <span aria-hidden="true" />
                  <div><Radio className="h-4 w-4" aria-hidden="true" /><strong>Both branches attempt an HCS audit anchor</strong><small>Audit status follows settlement</small></div>
                  <span aria-hidden="true" />
                </div>
              </div>
            </div>

            <aside className="relative flex min-h-80 flex-col justify-between bg-primary-copy p-6 text-white md:p-8" aria-live="polite">
              <div>
                <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.12em] text-white/60"><span>INSPECTING {active.number}</span><ActiveIcon className="h-5 w-5 text-white" aria-hidden="true" /></div>
                <p className="mt-12 font-mono text-xs tracking-[0.12em] text-white/60">{active.label}</p>
                <h3 className="mt-3 font-display text-4xl font-normal leading-none">{active.change}</h3>
                <p className="mt-6 text-sm leading-6 text-white/75">{active.detail}</p>
              </div>
              <div className="mt-10 border-t border-white/20 pt-5">
                <p className="font-mono text-[10px] tracking-[0.12em] text-white/50">BOUND PAYLOAD</p>
                <p className="mt-2 font-mono text-sm text-white">{active.payload}</p>
              </div>
            </aside>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-l-2 border-primary-copy pl-4 font-mono text-xs leading-5 text-muted-copy"><span className="text-primary-copy">TRUST BOUNDARY</span><span>ATS hold prevents double-spend</span><span>ClearingEscrow is sole executor</span><span>Nonce is single-use</span></div>
      </div>
    </section>
  );
}
