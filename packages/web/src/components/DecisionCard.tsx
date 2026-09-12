import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

import type { Decision } from "../data/decisions";
import { StatusChip } from "./StatusChip";

export function DecisionCard({ decision }: { decision: Decision }) {
  const refused = decision.verdict !== "CONFORMANT";

  return (
    <article
      data-layout="decision-card"
      className={`group flex min-h-72 flex-col justify-between border bg-surface p-5 transition-colors duration-200 md:p-6 ${
        refused ? "border-refusal/50" : "border-hairline hover:border-active/50"
      }`}
    >
      <div>
        <div className="mb-8 flex items-start justify-between gap-4">
          <StatusChip status={decision.verdict} />
          <span className="font-mono text-xs text-muted-copy">{decision.sequence}</span>
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-copy">
          {decision.protocol} · {decision.network}
        </p>
        <h3 className="mt-3 max-w-sm text-2xl font-medium tracking-tight text-primary-copy">
          {decision.operation}
        </h3>
      </div>

      <div className="mt-8 border-t border-hairline pt-4">
        <div className="grid grid-cols-2 gap-4 font-mono text-xs">
          <div>
            <p className="text-muted-copy">CHECKS</p>
            <p className="mt-1 text-primary-copy">
              {decision.checksPassed}/{decision.checksTotal}
            </p>
          </div>
          <div>
            <p className="text-muted-copy">SETTLEMENT</p>
            <p className={`mt-1 ${refused ? "text-refusal" : "text-primary-copy"}`}>
              {decision.transactionId ? "CONFIRMED" : "No Hedera transaction"}
            </p>
          </div>
        </div>
        <Link
          to={`/decisions/${decision.id}`}
          className="mt-5 inline-flex min-h-10 items-center gap-2 font-mono text-xs uppercase tracking-wide text-primary-copy focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Inspect decision
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
