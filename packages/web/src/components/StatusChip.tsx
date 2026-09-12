import type { TradeState } from "../api/trades";

type Status = TradeState | "LIVE";

const statusTone: Record<Status, string> = {
  LIVE: "bg-active",
  HOLD_PENDING: "bg-muted-copy",
  PAYMENT_REQUIRED: "bg-muted-copy",
  PAYMENT_SETTLED: "bg-active",
  EVALUATING: "bg-active",
  APPROVED: "bg-active",
  DENIED: "bg-refusal",
  EXECUTING: "bg-active",
  RELEASING: "bg-refusal",
  EXECUTED: "bg-success",
  RELEASED: "bg-refusal",
  EXPIRED: "bg-refusal",
  FAILED: "bg-refusal",
};

const statusLabel: Record<Status, string> = {
  LIVE: "Live API",
  HOLD_PENDING: "Held · awaiting agent",
  PAYMENT_REQUIRED: "Decision payment required",
  PAYMENT_SETTLED: "Decision purchased",
  EVALUATING: "Checking live evidence",
  APPROVED: "Approved · awaiting execution",
  DENIED: "Denied · awaiting release",
  EXECUTING: "Executing hold",
  RELEASING: "Releasing hold",
  EXECUTED: "Cleared",
  RELEASED: "Released",
  EXPIRED: "Hold expired",
  FAILED: "Action required",
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-chip px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-muted-copy">
      <span className={`h-1.5 w-1.5 rounded-full ${statusTone[status]}`} aria-hidden="true" />
      {statusLabel[status]}
    </span>
  );
}
