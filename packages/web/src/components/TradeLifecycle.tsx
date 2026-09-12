import { Check, Circle } from "lucide-react";

import type { TradeEvent } from "../api/trades";

const stages = [
  { label: "Hold", types: ["HOLD_CREATED"] },
  { label: "Payment", types: ["PAYMENT_CHALLENGED", "PAYMENT_SETTLED"] },
  { label: "Evidence", types: ["EVIDENCE_EVALUATED"] },
  { label: "Verdict", types: ["VERDICT_SIGNED"] },
  { label: "ATS action", types: ["HOLD_EXECUTED", "HOLD_RELEASED", "HOLD_EXPIRED"] },
  { label: "Audit", types: ["AUDIT_ANCHORED"] },
] as const;

export function TradeLifecycle({ events }: { events: TradeEvent[] }) {
  const stageEvents = stages.map((stage) => events.find((candidate) => stage.types.some((type) => type === candidate.type)));

  return (
    <ol className="grid gap-0 border border-hairline bg-surface sm:grid-cols-3 lg:grid-cols-6" aria-label="Confirmed trade lifecycle">
      {stages.map((stage, index) => {
        const event = stageEvents[index];
        const connectorConfirmed = Boolean(event && stageEvents[index + 1]);
        const connectorId = index < stages.length - 1 ? `${stage.label}-${stages[index + 1].label}`.toLowerCase().replaceAll(" ", "-") : null;
        return (
          <li key={stage.label} aria-label={`${stage.label} ${event ? "confirmed" : "unconfirmed"}`} className={`trade-lifecycle-stage relative min-h-28 border-b border-hairline p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:[&:nth-child(3)]:border-r-0 lg:[&:nth-child(3)]:border-r lg:last:border-r-0 ${event ? "is-confirmed" : ""}`}>
            {connectorId ? <span data-testid={`lifecycle-connector-${connectorId}`} data-confirmed={connectorConfirmed} className={`trade-lifecycle-line absolute left-8 top-[31px] hidden h-px w-[calc(100%-2rem)] bg-hairline lg:block ${connectorConfirmed ? "is-confirmed" : ""}`} aria-hidden="true" /> : null}
            <span className={`trade-lifecycle-marker relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border ${event ? "border-success bg-success text-white" : "border-hairline bg-surface text-muted-copy"}`}>
              {event ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Circle className="h-2.5 w-2.5" aria-hidden="true" />}
            </span>
            <p className="mt-4 font-mono text-xs text-primary-copy">{stage.label.toUpperCase()}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-copy">{event ? new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "UNCONFIRMED"}</p>
          </li>
        );
      })}
    </ol>
  );
}
