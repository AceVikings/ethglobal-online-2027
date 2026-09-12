import { liveMandateMessage } from "@desk/signal";
import {
  Bot, Check, CircleDollarSign, Fingerprint, LockKeyhole, Radio, ShieldCheck, Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { usePrivySession } from "../auth/PrivyAuth";
import { createLiveMandate, streamLiveClearance, type LiveResult, type LiveStage } from "../api/liveClearance";

const stageOrder: Array<{ id: LiveStage["id"]; label: string; sponsor: string }> = [
  { id: "mandate", label: "User signs the mandate", sponsor: "PRIVY" },
  { id: "issuance", label: "One fund unit is prepared", sponsor: "HEDERA ATS" },
  { id: "hold", label: "The exact unit is locked", sponsor: "HEDERA ATS" },
  { id: "payment", label: "Agent buys the verdict", sponsor: "X402 + PRIVY" },
  { id: "evidence", label: "Market evidence is checked", sponsor: "THE GRAPH" },
  { id: "settlement", label: "Escrow executes once", sponsor: "HEDERA" },
  { id: "audit", label: "Public proof is replayed", sponsor: "HCS" },
];

function short(value: string | null) {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function LiveClearanceConsole({ onComplete }: { onComplete?: () => void }) {
  const session = usePrivySession();
  const [stages, setStages] = useState<Record<string, LiveStage>>({});
  const [phase, setPhase] = useState<"idle" | "signing" | "running" | "complete" | "failed">("idle");
  const [result, setResult] = useState<LiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    if (!session.userId || !session.walletAddress) return;
    setStages({});
    setResult(null);
    setError(null);
    setPhase("signing");
    try {
      const mandate = createLiveMandate(session.userId, session.walletAddress);
      const signature = await session.signMessage(liveMandateMessage(mandate));
      const accessToken = await session.getAccessToken();
      if (!accessToken) throw new Error("Privy session expired. Sign in again.");
      setPhase("running");
      const completed = await streamLiveClearance({ mandate, signature }, accessToken, (stage) => {
        setStages((current) => ({ ...current, [stage.id]: stage }));
      });
      setResult(completed);
      setPhase("complete");
      onComplete?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live clearance stopped.");
      setPhase("failed");
    }
  };

  const button = !session.configured ? (
    <button type="button" disabled className="mt-8 min-h-14 w-full rounded-full bg-chip px-7 font-medium text-muted-copy disabled:cursor-not-allowed">Privy app ID required</button>
  ) : !session.authenticated ? (
    <button type="button" onClick={session.login} disabled={!session.ready} className="pill-action mt-8 inline-flex min-h-14 w-full items-center justify-center gap-3 bg-action px-7 font-medium text-white disabled:opacity-60">
      <Fingerprint className="h-5 w-5" aria-hidden="true" /> Sign in to create a vault
    </button>
  ) : !session.walletAddress ? (
    <button type="button" disabled className="mt-8 min-h-14 w-full rounded-full bg-chip px-7 font-medium text-muted-copy">Provisioning your Privy wallet…</button>
  ) : (
    <button type="button" onClick={() => void launch()} disabled={phase === "signing" || phase === "running"} className="pill-action mt-8 inline-flex min-h-14 w-full items-center justify-center gap-3 bg-action px-7 font-medium text-white disabled:cursor-wait disabled:opacity-60">
      <Sparkles className="h-5 w-5" aria-hidden="true" />
      {phase === "signing" ? "Approve the wallet prompt" : phase === "running" ? "Agent is clearing live…" : "Sign mandate & clear 1.0 SPCF"}
    </button>
  );

  return (
    <section id="live" className="relative scroll-mt-16 overflow-hidden bg-primary-copy py-20 text-white md:py-28">
      <div className="live-orbit live-orbit-one" aria-hidden="true" />
      <div className="live-orbit live-orbit-two" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
          <div>
            <p className="font-mono text-xs tracking-[0.18em] text-white/55">LIVE AGENT VAULT</p>
            <h2 className="mt-5 max-w-xl font-display text-5xl font-normal leading-[0.94] tracking-[-1.5px] md:text-7xl">Give the agent one job. Watch it earn the right to act.</h2>
            <p className="mt-7 max-w-xl text-base leading-7 text-white/65">Your Privy wallet signs a five-minute mandate. A separate agent wallet can spend only the quoted 0.01 USDC decision fee; Hedera escrow moves exactly one held SPCF unit only if live evidence passes.</p>

            <div className="mt-10 border border-white/15 bg-white/[0.05] p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="font-mono text-[11px] tracking-[0.14em] text-white/45">MANDATE / 001</span>
                <span className="inline-flex items-center gap-2 font-mono text-[10px] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> BOUNDED</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 font-mono text-xs">
                <div><dt className="text-white/35">OWNER</dt><dd className="mt-1 text-white/85">{short(session.userId)}</dd></div>
                <div><dt className="text-white/35">SIGNER</dt><dd className="mt-1 text-white/85">{short(session.walletAddress)}</dd></div>
                <div><dt className="text-white/35">ASSET</dt><dd className="mt-1 text-white/85">1.0 SPCF</dd></div>
                <div><dt className="text-white/35">MAX FEE</dt><dd className="mt-1 text-white/85">0.01 USDC</dd></div>
                <div><dt className="text-white/35">NETWORK</dt><dd className="mt-1 text-white/85">HEDERA TESTNET</dd></div>
                <div><dt className="text-white/35">EXPIRY</dt><dd className="mt-1 text-white/85">5 MINUTES</dd></div>
              </dl>
              {button}
              <p className="mt-4 text-center font-mono text-[10px] leading-4 text-white/35">THE USER SIGNS AUTHORITY. THE AGENT PAYS AND EXECUTES. KEYS NEVER ENTER THE BROWSER.</p>
            </div>
          </div>

          <div className="self-end border-t border-white/20">
            <div className="flex items-center justify-between py-5">
              <div className="flex items-center gap-3"><Radio className={`h-4 w-4 ${phase === "running" ? "text-emerald-300 live-radio" : "text-white/40"}`} aria-hidden="true" /><span className="font-mono text-xs tracking-[0.13em] text-white/55">EXECUTION FEED</span></div>
              <span className="font-mono text-[10px] text-white/35">{phase === "complete" ? "7 / 7 PROVED" : phase === "running" ? "LIVE" : "READY"}</span>
            </div>
            <ol>
              {stageOrder.map((item, index) => {
                const current = stages[item.id];
                const confirmed = current?.status === "confirmed";
                const running = current?.status === "running" || (item.id === "mandate" && phase === "signing");
                const failed = current?.status === "failed";
                return (
                  <li key={item.id} className={`live-stage grid grid-cols-[2.5rem_1fr_auto] gap-3 border-t border-white/10 py-5 ${running ? "is-running" : ""} ${confirmed ? "is-confirmed" : ""}`}>
                    <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border font-mono text-[10px] ${confirmed ? "border-emerald-300 bg-emerald-300 text-primary-copy" : failed ? "border-refusal bg-refusal text-primary-copy" : running ? "border-white bg-white text-primary-copy" : "border-white/20 text-white/35"}`}>
                      {confirmed ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : String(index + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${current || running ? "text-white" : "text-white/35"}`}>{current?.title ?? item.label}</p>
                      <p className="mt-1 max-w-lg text-xs leading-5 text-white/40">{current?.detail ?? "Waiting for the preceding proof."}</p>
                    </div>
                    <span className={`mt-1 font-mono text-[9px] tracking-[0.12em] ${confirmed ? "text-emerald-300" : running ? "text-white" : "text-white/25"}`}>{item.sponsor}</span>
                  </li>
                );
              })}
            </ol>
            {error ? <div role="alert" className="mt-5 border border-refusal/60 bg-refusal/10 p-4 text-sm text-red-100">{error}</div> : null}
            {result ? (
              <div className="mt-5 flex flex-col gap-4 border border-emerald-300/40 bg-emerald-300/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-emerald-300" aria-hidden="true" /><div><p className="font-medium">Public replay passed</p><p className="mt-1 font-mono text-[10px] text-white/45">{short(result.tradeDigest)}</p></div></div>
                <Link to={`/trades/${result.tradeDigest}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-medium text-primary-copy">Open proof room</Link>
              </div>
            ) : null}
            <div className="mt-6 grid grid-cols-3 gap-px bg-white/10 text-center font-mono text-[10px] text-white/40">
              <div className="bg-primary-copy py-4"><Bot className="mx-auto mb-2 h-4 w-4" />AGENT</div>
              <div className="bg-primary-copy py-4"><CircleDollarSign className="mx-auto mb-2 h-4 w-4" />PAID PROOF</div>
              <div className="bg-primary-copy py-4"><LockKeyhole className="mx-auto mb-2 h-4 w-4" />ATOMIC ESCROW</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
