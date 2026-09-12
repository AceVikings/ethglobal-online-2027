import { ArrowLeft, ArrowUpRight, CircleAlert, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { fetchTrade, fetchTradeEvents, safeTestnetLink, shortId, type Trade, type TradeEvent } from "../api/trades";
import { StatusChip } from "../components/StatusChip";

type PageState =
  | { status: "loading"; trade: null; events: TradeEvent[] }
  | { status: "ready"; trade: Trade; events: TradeEvent[] }
  | { status: "error"; trade: null; events: TradeEvent[] };

function CopyValue({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <button type="button" onClick={onCopy} className="inline-flex min-h-10 w-full items-center justify-between gap-3 border-b border-hairline py-2 text-left font-mono text-xs text-primary-copy last:border-b-0 focus-visible:ring-2 focus-visible:ring-active">
      <span><span className="block text-muted-copy">{label}</span><span className="mt-1 block" aria-label={`${label} ${value}`}>{shortId(value)}</span></span>
      <span className="inline-flex items-center gap-2 text-muted-copy">{copied ? "Copied" : "Copy"}<Copy className="h-3.5 w-3.5" aria-hidden="true" /></span>
    </button>
  );
}

export function DecisionPage() {
  const { tradeDigest } = useParams();
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState<PageState>({ status: "loading", trade: null, events: [] });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!tradeDigest) {
      setPage({ status: "error", trade: null, events: [] });
      return;
    }
    const controller = new AbortController();
    setPage({ status: "loading", trade: null, events: [] });
    Promise.all([fetchTrade(tradeDigest, controller.signal), fetchTradeEvents(tradeDigest, controller.signal)])
      .then(([trade, events]) => setPage({ status: "ready", trade, events }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPage({ status: "error", trade: null, events: [] });
      });
    return () => controller.abort();
  }, [tradeDigest, reloadKey]);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };

  if (page.status === "loading") {
    return <main className="min-h-[100svh] px-4 pb-20 pt-32 md:px-8 md:pt-40 lg:px-14"><div className="mx-auto max-w-7xl" aria-label="Loading trade detail"><div className="h-10 w-40 animate-pulse bg-chip motion-reduce:animate-none" /><div className="mt-12 h-40 animate-pulse bg-chip motion-reduce:animate-none" /><div className="mt-px grid gap-px bg-hairline lg:grid-cols-2"><div className="h-96 animate-pulse bg-surface motion-reduce:animate-none" /><div className="h-96 animate-pulse bg-surface motion-reduce:animate-none" /></div></div></main>;
  }

  if (page.status === "error") {
    return (
      <main className="flex min-h-[100svh] items-center px-4 pt-24 md:px-8 lg:px-14">
        <div className="mx-auto w-full max-w-7xl border border-refusal/50 bg-surface p-8"><CircleAlert className="h-6 w-6 text-refusal" aria-hidden="true" /><h1 className="mt-6 text-3xl font-medium text-primary-copy">Trade unavailable</h1><p className="mt-3 max-w-lg text-secondary-copy">This trade could not be reconstructed from the clearing API. No fixture state has been substituted.</p><div className="mt-8 flex flex-wrap gap-3"><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="inline-flex min-h-11 items-center bg-action px-5 font-medium text-white focus-visible:ring-2 focus-visible:ring-active">Retry</button><Link to="/" className="inline-flex min-h-11 items-center border border-hairline px-5 font-medium text-primary-copy focus-visible:ring-2 focus-visible:ring-active">Return to desk</Link></div></div>
      </main>
    );
  }

  const { trade, events } = page;
  const verificationLinks = [
    ["ATS security", safeTestnetLink(trade.links.security)],
    ["ClearingEscrow", safeTestnetLink(trade.links.escrow)],
    ["x402 payment", safeTestnetLink(trade.links.payment)],
    [trade.settlement?.action === "RELEASE" ? "ATS release" : "ATS execution", safeTestnetLink(trade.links.settlement)],
    ["HCS audit", safeTestnetLink(trade.links.hcsTopic)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <main className="min-h-[100svh] px-4 pb-20 pt-32 md:px-8 md:pt-40 lg:px-14">
      <div className="mx-auto max-w-7xl">
        <Link to="/" className="inline-flex min-h-10 items-center gap-2 font-mono text-xs uppercase tracking-wide text-secondary-copy hover:text-primary-copy focus-visible:ring-2 focus-visible:ring-active"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to clearing desk</Link>

        <div className="mt-10 grid gap-10 border-b border-hairline pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><div className="flex flex-wrap items-center gap-3"><StatusChip status={trade.state} /><span className="font-mono text-xs text-muted-copy">{trade.instrument.network.replace("-", " ").toUpperCase()}</span></div><p className="eyebrow mt-7">{trade.sequence}</p><h1 className="mt-3 max-w-4xl font-display text-4xl font-normal leading-tight tracking-[-0.04em] text-primary-copy md:text-6xl">{trade.instrument.name}</h1><p className="mt-5 font-mono text-sm text-secondary-copy"><span aria-label={`Seller ${trade.hold.seller}`}>{shortId(trade.hold.seller)}</span><span className="mx-3 text-muted-copy">→</span><span aria-label={`Buyer ${trade.hold.buyer}`}>{shortId(trade.hold.buyer)}</span><span className="mx-3 text-muted-copy">·</span>{trade.hold.units} {trade.instrument.symbol}</p></div>
          <div className="font-mono text-xs leading-6 text-muted-copy lg:text-right"><p>HOLD {trade.hold.holdId}</p><p>CREATED {new Date(trade.hold.createdAt).toLocaleString()}</p><p>EXPIRES {new Date(trade.hold.expiresAt).toLocaleString()}</p></div>
        </div>

        <div className="grid gap-px bg-hairline lg:grid-cols-[1.15fr_0.85fr]">
          <section className="bg-canvas py-10 lg:pr-10">
            <p className="eyebrow">AUTHORITATIVE DECISION</p>
            {trade.decision ? <><div className="mt-5 flex items-baseline justify-between gap-4"><h2 className={`text-3xl font-medium ${trade.verdict === "DENY" ? "text-refusal" : "text-primary-copy"}`}>{trade.verdict === "APPROVE" ? "Approved" : "Denied"}</h2><span className="font-mono text-xs text-muted-copy">NONCE {trade.decision.nonceConsumed ? "CONSUMED" : "OPEN"}</span></div><p className="mt-2 font-mono text-xs text-muted-copy">Issued {new Date(trade.decision.issuedAt).toLocaleString()} · expires {new Date(trade.decision.expiresAt).toLocaleString()}</p><div className="mt-8 border border-hairline">{trade.decision.checks.map((check) => <div key={check.code} className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-4 border-b border-hairline px-4 font-mono text-xs last:border-b-0 md:grid-cols-[1fr_80px_1fr]"><span className="text-primary-copy">{check.label}</span><span className={check.result === "FAIL" ? "text-refusal" : "text-success"}>{check.result}</span><span className="hidden text-right text-muted-copy md:block">{check.publicValue}</span></div>)}</div></> : <div className="mt-6 border border-hairline p-6"><h2 className="text-xl font-medium text-primary-copy">No signed verdict yet</h2><p className="mt-2 text-sm text-secondary-copy">The current lifecycle state is {trade.state.toLowerCase().replaceAll("_", " ")}.</p></div>}

            <div className="mt-10"><p className="eyebrow">LIFECYCLE</p><ol className="mt-5 space-y-0">{events.length ? events.map((event) => <li key={event.id} className="grid grid-cols-[1fr_auto] gap-4 border-b border-hairline py-4 font-mono text-xs"><span><span className="block text-primary-copy">{event.type.replaceAll("_", " ")}</span><span className="mt-1 block text-muted-copy">{event.publicDetail}</span></span><time className="text-muted-copy" dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString()}</time></li>) : <li className="border border-hairline p-5 text-sm text-secondary-copy">No confirmed lifecycle events.</li>}</ol></div>

            {trade.decision?.explanation ? <aside className="mt-10 border-l border-hairline pl-5"><p className="eyebrow">AI EXPLANATION · NOT USED TO DETERMINE OUTCOME</p><p className="mt-3 max-w-2xl text-sm leading-6 text-secondary-copy">{trade.decision.explanation}</p><p className="mt-3 font-mono text-xs text-muted-copy">Provider: {trade.decision.explanationProvider ?? "Unavailable"}</p></aside> : null}
          </section>

          <aside className="bg-canvas py-10 lg:pl-10">
            <p className="eyebrow">TRADE BINDING</p><div className="mt-5 border border-hairline p-5 font-mono text-xs leading-6 text-secondary-copy"><p>SECURITY <span className="float-right text-primary-copy">{shortId(trade.instrument.securityAddress)}</span></p><p>PARTITION <span className="float-right text-primary-copy">{shortId(trade.instrument.partition)}</span></p><p>ESCROW <span className="float-right text-primary-copy">{shortId(trade.hold.escrow)}</span></p></div>

            <p className="eyebrow mt-10">X402 PAYMENT</p><div className="mt-5 border border-hairline p-5"><p className="text-2xl text-primary-copy">{trade.payment ? `${trade.payment.amount} ${trade.payment.asset}` : "Not requested"}</p><p className="mt-2 font-mono text-xs text-muted-copy">{trade.payment ? `${trade.payment.status} · ${trade.payment.facilitator}` : "No payment state"}</p>{trade.payment?.transactionId ? <p className="mt-4 font-mono text-xs text-secondary-copy">TX {shortId(trade.payment.transactionId)}</p> : null}</div>

            <p className="eyebrow mt-10">ATS SETTLEMENT</p><div className={`mt-5 border p-5 ${trade.settlement?.action === "RELEASE" ? "border-refusal/50" : "border-hairline"}`}><p className="text-2xl text-primary-copy">{trade.settlement ? (trade.settlement.action === "EXECUTE" ? "Exact hold executed" : "Exact hold released") : "Awaiting confirmed action"}</p><p className="mt-2 font-mono text-xs leading-6 text-muted-copy">{trade.settlement ? `TX ${shortId(trade.settlement.transactionId)}` : "No ATS settlement transaction yet"}</p>{trade.settlement?.action === "RELEASE" ? <p className="mt-3 text-sm text-refusal">No units reached the buyer.</p> : null}</div>

            <div className="mt-10"><p className="eyebrow">COPY EVIDENCE</p><div className="mt-3 border border-hairline px-4"><CopyValue label="Trade digest" value={trade.tradeDigest} copied={copied === "trade"} onCopy={() => copy("trade", trade.tradeDigest)} />{trade.decision ? <CopyValue label="Evidence hash" value={trade.decision.evidenceHash} copied={copied === "evidence"} onCopy={() => copy("evidence", trade.decision!.evidenceHash)} /> : null}{trade.payment?.transactionId ? <CopyValue label="Payment transaction" value={trade.payment.transactionId} copied={copied === "payment"} onCopy={() => copy("payment", trade.payment!.transactionId!)} /> : null}{trade.settlement ? <CopyValue label="ATS transaction" value={trade.settlement.transactionId} copied={copied === "settlement"} onCopy={() => copy("settlement", trade.settlement!.transactionId)} /> : null}</div></div>

            {verificationLinks.length ? <div className="mt-10"><p className="eyebrow">VERIFY ON HEDERA TESTNET</p><div className="mt-3 space-y-2">{verificationLinks.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-between border border-hairline px-4 text-sm font-medium text-primary-copy hover:bg-chip focus-visible:ring-2 focus-visible:ring-active">{label}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>)}</div></div> : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
