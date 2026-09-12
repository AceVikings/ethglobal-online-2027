import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import { shortId, type Trade } from "../api/trades";
import { StatusChip } from "./StatusChip";

export function DecisionCard({ trade }: { trade: Trade }) {
  const adverse = ["DENIED", "RELEASING", "RELEASED", "EXPIRED", "FAILED"].includes(trade.state);

  return (
    <article
      data-layout="trade-card"
      className={`group flex min-h-72 flex-col justify-between border bg-surface p-5 transition-colors duration-200 md:p-6 ${
        adverse ? "border-refusal/50" : "border-hairline hover:border-active/50"
      }`}
    >
      <div>
        <div className="mb-8 flex items-start justify-between gap-4">
          <StatusChip status={trade.state} />
          <span className="font-mono text-xs text-muted-copy">{trade.sequence}</span>
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-copy">
          {trade.instrument.name} · TESTNET
        </p>
        <h3 className="mt-3 max-w-sm text-2xl font-medium tracking-tight text-primary-copy">
          {trade.hold.units} {trade.instrument.symbol}
        </h3>
        <p className="mt-4 font-mono text-xs leading-6 text-secondary-copy">
          <span aria-label={`Seller ${trade.hold.seller}`}>{shortId(trade.hold.seller)}</span>
          <span className="mx-2 text-muted-copy" aria-hidden="true">→</span>
          <span aria-label={`Buyer ${trade.hold.buyer}`}>{shortId(trade.hold.buyer)}</span>
        </p>
      </div>

      <div className="mt-8 border-t border-hairline pt-4">
        <div className="grid grid-cols-2 gap-4 font-mono text-xs md:grid-cols-3">
          <div>
            <p className="text-muted-copy">HOLD</p>
            <p className="mt-1 text-primary-copy">{trade.hold.holdId}</p>
          </div>
          <div>
            <p className="text-muted-copy">EXPIRES</p>
            <p className="mt-1 text-primary-copy">{new Date(trade.hold.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className="text-muted-copy">DECISION PRICE</p>
            <p className="mt-1 text-primary-copy">{trade.payment ? `${trade.payment.amount} ${trade.payment.asset}` : "Not quoted"}</p>
          </div>
        </div>
        <Link
          to={`/trades/${trade.tradeDigest}`}
          className="mt-5 inline-flex min-h-10 items-center gap-2 font-mono text-xs uppercase tracking-wide text-primary-copy focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Inspect trade
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
