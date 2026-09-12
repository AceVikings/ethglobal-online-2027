import { ArrowDown, ArrowRight, CircleDollarSign, DatabaseZap, LockKeyhole, ShieldCheck, Undo2 } from "lucide-react";

const stages = [
  {
    number: "01",
    icon: LockKeyhole,
    label: "SELLER",
    title: "Lock exact units",
    detail: "Security · partition · buyer · amount · expiry · escrow",
  },
  {
    number: "02",
    icon: CircleDollarSign,
    label: "BUYER AGENT",
    title: "Purchase one verdict",
    detail: "Validate x402 terms, then settle through Blocky402",
  },
  {
    number: "03",
    icon: DatabaseZap,
    label: "CLEARING SERVICE",
    title: "Check live evidence",
    detail: "Deterministic policy decides; DeepSeek only explains",
  },
];

export function ClearingFlow() {
  return (
    <section id="flow" className="scroll-mt-20 border-y border-hairline bg-surface py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="grid gap-6 border-b border-hairline pb-10 md:grid-cols-[1fr_0.72fr] md:items-end">
          <div>
            <p className="eyebrow">CLEARING FLOW</p>
            <h2 className="mt-4 max-w-3xl font-display text-4xl font-normal leading-none tracking-[-1px] text-primary-copy md:text-6xl">One held trade. Two provable outcomes.</h2>
          </div>
          <p className="max-w-lg text-sm leading-6 text-secondary-copy md:justify-self-end">See where custody, payment, evidence, and finality change hands. The AI explains the decision; policy and escrow retain authority.</p>
        </div>

        <div className="pt-8" aria-label="Seller locks a trade, buyer agent purchases a verdict, deterministic checks run, then ClearingEscrow executes or releases the hold">
          <ol className="grid lg:grid-cols-[1fr_40px_1fr_40px_1fr] lg:items-stretch">
            {stages.map(({ number, icon: Icon, label, title, detail }, index) => (
              <li key={number} className="contents">
                <div className="flex min-h-48 flex-col border border-hairline bg-canvas p-5">
                  <div className="flex items-center justify-between font-mono text-xs text-muted-copy"><span>{number}</span><Icon className="h-4 w-4 text-primary-copy" aria-hidden="true" /></div>
                  <div className="mt-auto pt-8"><p className="font-mono text-xs tracking-[0.12em] text-muted-copy">{label}</p><h3 className="mt-2 text-xl font-medium text-primary-copy">{title}</h3><p className="mt-2 text-sm leading-6 text-secondary-copy">{detail}</p></div>
                </div>
                {index < stages.length - 1 ? <div className="flex h-9 items-center justify-center text-muted-copy lg:h-auto"><ArrowDown className="h-4 w-4 lg:hidden" aria-hidden="true" /><ArrowRight className="hidden h-4 w-4 lg:block" aria-hidden="true" /></div> : null}
              </li>
            ))}
          </ol>

          <div className="mx-auto flex h-12 w-px items-end bg-hairline"><span className="h-2 w-2 -translate-x-[3.5px] rounded-full bg-primary-copy" /></div>

          <div className="grid gap-px bg-hairline md:grid-cols-2">
            <article className="bg-canvas p-6 md:p-7">
              <div className="flex items-center justify-between"><p className="font-mono text-xs tracking-[0.12em] text-success">POLICY APPROVES</p><ShieldCheck className="h-5 w-5 text-success" aria-hidden="true" /></div>
              <h3 className="mt-6 text-2xl font-medium text-primary-copy">Execute the exact hold.</h3>
              <p className="mt-3 max-w-lg text-sm leading-6 text-secondary-copy">The named buyer receives precisely the held fund units. The signed nonce can be consumed once.</p>
              <div className="mt-6 flex items-center gap-3 font-mono text-xs text-muted-copy"><span className="h-2 w-2 rounded-full bg-success" /> FINAL STATE · CLEARED</div>
            </article>
            <article className="bg-canvas p-6 md:p-7">
              <div className="flex items-center justify-between"><p className="font-mono text-xs tracking-[0.12em] text-refusal">POLICY DENIES</p><Undo2 className="h-5 w-5 text-refusal" aria-hidden="true" /></div>
              <h3 className="mt-6 text-2xl font-medium text-primary-copy">Release the exact hold.</h3>
              <p className="mt-3 max-w-lg text-sm leading-6 text-secondary-copy">No units reach the buyer. The seller regains availability through an ATS lifecycle transaction.</p>
              <div className="mt-6 flex items-center gap-3 font-mono text-xs text-muted-copy"><span className="h-2 w-2 rounded-full bg-refusal" /> FINAL STATE · RELEASED</div>
            </article>
          </div>

          <div className="grid gap-px bg-hairline sm:grid-cols-3">
            {["CONTRACT EVENT", "HCS AUDIT RECORD", "MIRROR NODE FINALITY"].map((label) => <div key={label} className="bg-surface px-4 py-4 font-mono text-xs text-muted-copy">{label}</div>)}
          </div>

          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-l-2 border-primary-copy pl-4 font-mono text-xs leading-5 text-muted-copy"><span className="text-primary-copy">TRUST BOUNDARY</span><span>ATS hold prevents double-spend</span><span>ClearingEscrow is sole executor</span><span>Nonce is single-use</span></div>
        </div>
      </div>
    </section>
  );
}
