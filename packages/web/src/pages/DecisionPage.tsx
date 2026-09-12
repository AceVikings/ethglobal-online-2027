import { ArrowLeft, ArrowUpRight, CircleAlert, Copy } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { StatusChip } from "../components/StatusChip";
import { getDecision } from "../data/decisions";

export function DecisionPage() {
  const { id } = useParams();
  const decision = getDecision(id);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  if (!decision) {
    return (
      <main className="flex min-h-[100svh] items-center px-4 pt-32 md:px-8 lg:px-14">
        <div className="mx-auto w-full max-w-7xl border border-refusal/50 bg-surface p-8">
          <CircleAlert className="h-6 w-6 text-refusal" aria-hidden="true" />
          <h1 className="mt-6 text-3xl font-medium text-primary-copy">Decision not found</h1>
          <p className="mt-3 max-w-md text-secondary-copy">This decision ID is not in the current event stream.</p>
          <Link to="/" className="mt-8 inline-flex min-h-11 items-center gap-2 bg-primary-copy px-4 font-medium text-button-copy focus-visible:ring-2 focus-visible:ring-active">
            Return to desk
          </Link>
        </div>
      </main>
    );
  }

  const refused = decision.verdict !== "CONFORMANT";
  const copySignalHash = async () => {
    try {
      await navigator.clipboard.writeText(decision.signalHash);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <main className="min-h-[100svh] px-4 pb-20 pt-32 md:px-8 md:pt-40 lg:px-14">
      <div className="mx-auto max-w-7xl">
        <Link to="/" className="inline-flex min-h-10 items-center gap-2 font-mono text-xs uppercase tracking-wide text-secondary-copy hover:text-primary-copy focus-visible:ring-2 focus-visible:ring-active">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to desk
        </Link>

        <div className="mt-12 grid gap-12 border-b border-hairline pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <StatusChip status={decision.verdict} />
            <h1 className="mt-6 max-w-4xl text-4xl font-medium leading-tight tracking-[-0.04em] text-primary-copy md:text-6xl">{decision.operation}</h1>
          </div>
          <div className="font-mono text-xs leading-6 text-muted-copy lg:text-right">
            <p>{decision.sequence}</p><p>{decision.issuedAt} UTC</p><p>{decision.durationMs} MS TOTAL</p>
          </div>
        </div>

        <div className="grid gap-px bg-hairline lg:grid-cols-[1.2fr_0.8fr]">
          <section className="bg-canvas py-10 lg:pr-10">
            <p className="eyebrow">VERIFICATION</p>
            <h2 className="mt-3 text-2xl font-medium text-primary-copy">Policy checks</h2>
            <p className="mt-2 font-mono text-xs text-muted-copy">{decision.policy ?? "Operator policy · 50 block freshness bound"}</p>
            <div className="mt-8 border border-hairline">
              {(decision.checks ?? []).map((check) => (
                <div key={check.label} className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-4 border-b border-hairline px-4 font-mono text-xs last:border-b-0 md:grid-cols-[1fr_90px_1fr]">
                  <span className="text-primary-copy">{check.label}</span>
                  <span className={check.result === "FAIL" ? "text-refusal" : "text-success"}>{check.result}</span>
                  <span className="hidden text-right text-muted-copy md:block">{check.value}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="bg-canvas py-10 lg:pl-10">
            <p className="eyebrow">SETTLEMENT</p>
            <div className={`mt-6 border p-5 ${refused ? "border-refusal/50" : "border-hairline"}`}>
              <p className="font-mono text-xs text-muted-copy">PAYMENT</p>
              <p className="mt-2 text-2xl text-primary-copy">{decision.payment}</p>
              <div className="my-5 h-px bg-hairline" />
              <p className="font-mono text-xs text-muted-copy">HEDERA OPERATION</p>
              <p className={`mt-2 font-mono text-xs leading-6 ${refused ? "text-refusal" : "text-success"}`}>
                {decision.transactionId ?? "No transaction submitted"}
              </p>
            </div>
            <button type="button" onClick={copySignalHash} className="mt-4 inline-flex min-h-11 w-full items-center justify-between border border-hairline px-4 font-mono text-xs text-primary-copy hover:bg-chip focus-visible:ring-2 focus-visible:ring-active">
              {copyState === "copied" ? "Signal hash copied" : copyState === "error" ? "Copy failed — retry" : "Copy signal hash"}
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
            {decision.transactionId ? (
              <a href="https://hashscan.io/testnet" target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 w-full items-center justify-between bg-primary-copy px-4 font-medium text-button-copy focus-visible:ring-2 focus-visible:ring-active">
                Open in HashScan <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
