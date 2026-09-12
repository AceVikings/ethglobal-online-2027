import type { Verdict } from "../data/decisions";

type Status = Verdict | "PREVIEW";

const statusTone: Record<Status, string> = {
  CONFORMANT: "bg-success",
  PREVIEW: "bg-muted-copy",
  NON_CONFORMANT: "bg-refusal",
  STALE: "bg-refusal",
  DISAGREEMENT: "bg-refusal",
};

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-chip px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-muted-copy">
      <span className={`h-1.5 w-1.5 rounded-full ${statusTone[status]}`} aria-hidden="true" />
      {status.replace("NON_CONFORMANT", "NON-CONFORMANT")}
    </span>
  );
}
