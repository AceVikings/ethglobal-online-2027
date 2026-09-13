import { ArrowUpRight, Bot, Check, CircleAlert, Clock3, Link2, LoaderCircle, LockKeyhole, Radio, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { activateVault, decideApproval, fetchVaultDashboard, previewVaultDraft, watchRunEvents, type ApprovalRequest, type RunEvent, type VaultDraftInput, type VaultDraftPreview, type VaultRun } from "../api/vaults";
import { usePrivySession } from "../auth/PrivyAuth";

type Dashboard = Awaited<ReturnType<typeof fetchVaultDashboard>>;
type LoadState = { status: "idle" | "loading" | "ready" | "error"; data: Dashboard | null; message?: string };

const expiryTomorrow = () => new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 16);
const short = (value: string) => value.length > 22 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function VaultControlRoom() {
  const session = usePrivySession();
  const [reloadKey, setReloadKey] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: "idle", data: null });
  const [selectedOfferingId, setSelectedOfferingId] = useState("");
  const [form, setForm] = useState({ name: "My bounded vault", units: "1", maxPrice: "13.00", maxEvidenceFee: "0.01", maxUtilization: 72, maxEvidenceAgeMinutes: 15, expiresAt: expiryTomorrow() });
  const [preview, setPreview] = useState<VaultDraftPreview | null>(null);
  const [action, setAction] = useState<"idle" | "previewing" | "signing" | "approving" | "rejecting">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);

  useEffect(() => {
    if (!session.authenticated) { setLoad({ status: "idle", data: null }); return; }
    const controller = new AbortController();
    setLoad({ status: "loading", data: null });
    void session.getAccessToken().then((token) => {
      if (!token) throw new Error("Your Privy session expired. Sign in again.");
      return fetchVaultDashboard(token);
    }).then((data) => {
      if (controller.signal.aborted) return;
      setLoad({ status: "ready", data });
      setSelectedOfferingId((current) => current || data.vaults[0]?.offeringId || data.offerings[0]?.id || "");
      const first = data.vaults[0];
      if (first) setForm({ name: first.name, ...first.policy, expiresAt: first.policy.expiresAt.slice(0, 16) });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setLoad({ status: "error", data: null, message: cause instanceof Error ? cause.message : "Unknown API error" });
    });
    return () => controller.abort();
  }, [reloadKey, session.authenticated]);

  const selectedOffering = load.data?.offerings.find((item) => item.id === selectedOfferingId) ?? null;
  const activeVault = load.data?.vaults.find((item) => item.offeringId === selectedOfferingId) ?? load.data?.vaults[0] ?? null;
  const latestRun = load.data?.runs[0] ?? null;
  const pendingApproval = load.data?.approvals.find((item) => item.status === "pending") ?? null;
  const principal = selectedOffering ? (Number(selectedOffering.unitPrice) * Number(form.units || 0)).toFixed(2) : "0.00";

  useEffect(() => {
    if (!latestRun) { setLiveEvents([]); return; }
    setLiveEvents(latestRun.events);
    if (["AUDITED", "EXECUTED", "RELEASED", "BLOCKED", "CANCELLED"].includes(latestRun.state)) return;
    const controller = new AbortController();
    void session.getAccessToken().then((token) => {
      if (!token) throw new Error("Your Privy session expired. Sign in again.");
      const lastId = latestRun.events.at(-1)?.id ?? null;
      return watchRunEvents(latestRun.id, token, lastId, (event) => {
        setLiveEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
      }, controller.signal);
    }).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) console.warn("Run event stream disconnected", cause);
    });
    return () => controller.abort();
  }, [latestRun?.id]);

  const draftInput = useMemo<VaultDraftInput | null>(() => {
    const expiry = new Date(form.expiresAt);
    if (!session.walletAddress || !selectedOfferingId || !form.name.trim() || !form.units || Number.isNaN(expiry.getTime())) return null;
    return {
    offeringId: selectedOfferingId,
    receiver: session.walletAddress,
    name: form.name,
    units: form.units,
    maxPrice: form.maxPrice,
    maxEvidenceFee: form.maxEvidenceFee,
    maxUtilization: form.maxUtilization,
    maxEvidenceAgeMinutes: form.maxEvidenceAgeMinutes,
      expiresAt: expiry.toISOString(),
    };
  }, [form, selectedOfferingId, session.walletAddress]);

  const withToken = async <T,>(operation: (token: string) => Promise<T>) => {
    const token = await session.getAccessToken();
    if (!token) throw new Error("Your Privy session expired. Sign in again.");
    return operation(token);
  };

  const previewMandate = async () => {
    if (!draftInput) return;
    setAction("previewing"); setActionError(null); setPreview(null);
    try { setPreview(await withToken((token) => previewVaultDraft(token, draftInput))); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "The mandate preview failed."); }
    finally { setAction("idle"); }
  };

  const signAndActivate = async () => {
    if (!preview) return;
    setAction("signing"); setActionError(null);
    try {
      const signature = await session.signMessage(preview.mandateMessage);
      await withToken((token) => activateVault(token, preview.draftId, signature));
      setPreview(null); setReloadKey((value) => value + 1);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Vault activation failed."); }
    finally { setAction("idle"); }
  };

  const actOnApproval = async (approval: ApprovalRequest, decision: "approve" | "reject") => {
    setAction(decision === "approve" ? "approving" : "rejecting"); setActionError(null);
    try {
      const signature = decision === "approve" ? await session.signMessage(approval.mandateMessage) : undefined;
      await withToken((token) => decideApproval(token, approval.id, decision, signature));
      setReloadKey((value) => value + 1);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Approval update failed."); }
    finally { setAction("idle"); }
  };

  if (!session.authenticated) return (
    <section id="live" className="vault-room scroll-mt-16 bg-primary-copy py-20 text-white md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14"><p className="font-mono text-xs tracking-[0.18em] text-white/50">PERSONAL AGENT VAULTS</p><h2 className="mt-5 max-w-3xl font-display text-5xl md:text-7xl">Build a vault your agent cannot outgrow.</h2><p className="mt-6 max-w-xl text-white/60">Sign in to load your private vaults, mandates, agent grants, and run history. Public proof rooms stay available without login.</p><button type="button" onClick={session.login} disabled={!session.ready || !session.configured} className="vault-primary mt-8">Sign in with Privy</button></div>
    </section>
  );

  if (load.status === "loading" || load.status === "idle") return <section id="live" className="vault-room min-h-[42rem] bg-primary-copy py-24 text-white" aria-label="Loading personal vault"><div className="mx-auto max-w-7xl animate-pulse px-4 motion-reduce:animate-none md:px-8"><div className="h-4 w-40 bg-white/15"/><div className="mt-6 h-16 max-w-2xl bg-white/10"/><div className="mt-12 grid gap-4 md:grid-cols-3">{[1,2,3].map((item)=><div key={item} className="h-44 bg-white/[0.07]"/>)}</div></div></section>;

  if (load.status === "error" || !load.data) return <section id="live" className="vault-room bg-primary-copy py-24 text-white"><div className="mx-auto max-w-7xl px-4 md:px-8"><div role="alert" className="border border-red-300/50 bg-red-300/10 p-6"><CircleAlert className="h-5 w-5 text-red-200"/><h2 className="mt-4 text-2xl">Personal vault data is unavailable</h2><p className="mt-2 text-sm text-white/55">{load.message}</p><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="vault-secondary mt-5">Retry private data</button></div></div></section>;

  return (
    <section id="live" className="vault-room scroll-mt-16 bg-primary-copy py-20 text-white md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-8 lg:px-14">
        <div className="grid gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-end"><div><p className="font-mono text-xs tracking-[0.18em] text-emerald-300">SIGNED IN · HEDERA TESTNET</p><h2 className="mt-5 max-w-3xl font-display text-5xl leading-[.95] md:text-7xl">Build a vault your agent cannot outgrow.</h2><p className="mt-6 max-w-2xl text-base leading-7 text-white/60">Choose the asset and exact bounds. Your receiver owns the units; a separate, minimally funded executor can act only inside the signed mandate.</p></div><div className="grid grid-cols-2 gap-px bg-white/10 font-mono text-[10px]"><Identity label="Receiver wallet" value={short(session.walletAddress ?? "Unavailable")}/><Identity label="Vault executor" value={activeVault?.executor.address ?? "Provision after signing"}/></div></div>

        <div className="mt-12 grid gap-px bg-white/10 lg:grid-cols-[1.15fr_.85fr]">
          <div className="bg-[#111b2e] p-5 md:p-8">
            <div className="flex items-center justify-between"><div><p className="vault-kicker">01 · DEFINE AUTHORITY</p><h3 className="mt-2 text-2xl">Exact mandate bounds</h3></div><ShieldCheck className="text-emerald-300"/></div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {load.data.offerings.map((offering) => <button key={offering.id} type="button" aria-pressed={selectedOfferingId === offering.id} onClick={() => { setSelectedOfferingId(offering.id); setPreview(null); }} className={`vault-offering ${selectedOfferingId === offering.id ? "is-selected" : ""}`}><span className="font-mono text-[10px] text-emerald-300">{offering.symbol} · {offering.currency} {offering.unitPrice}</span><strong>{offering.name}</strong><small>{offering.description}</small></button>)}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Vault name"><input value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})}/></Field>
              <Field label="Investment units"><input type="number" min="1" step="1" value={form.units} onChange={(event)=>setForm({...form,units:event.target.value})}/></Field>
              <Field label="Maximum unit price"><input inputMode="decimal" value={form.maxPrice} onChange={(event)=>setForm({...form,maxPrice:event.target.value})}/></Field>
              <Field label="Evidence fee ceiling"><input inputMode="decimal" value={form.maxEvidenceFee} onChange={(event)=>setForm({...form,maxEvidenceFee:event.target.value})}/></Field>
              <Field label={`Maximum utilization · ${form.maxUtilization}%`}><input type="range" min="1" max="100" value={form.maxUtilization} onChange={(event)=>setForm({...form,maxUtilization:Number(event.target.value)})}/></Field>
              <Field label="Mandate expiry"><input type="datetime-local" value={form.expiresAt} onChange={(event)=>setForm({...form,expiresAt:event.target.value})}/></Field>
            </div>
            <div className="mt-6 grid gap-3 border-y border-white/10 py-5 font-mono text-xs sm:grid-cols-3"><span><b className="block text-white/35">PRINCIPAL</b>{principal} {selectedOffering?.currency}</span><span><b className="block text-white/35">MAX FEE</b>{form.maxEvidenceFee} USDC</span><span><b className="block text-white/35">FRESHNESS</b>{form.maxEvidenceAgeMinutes} minutes</span></div>
            {preview ? <div className="mt-5 border border-emerald-300/30 bg-emerald-300/[0.06] p-4"><p className="vault-kicker text-emerald-300">EXACT SIGNATURE PREVIEW</p><div className="mt-3 flex flex-wrap gap-6 font-mono text-xs"><span>Principal <b>{preview.preview.principal}</b></span><span>Policy <b>{short(preview.preview.policyHash)}</b></span></div><button type="button" onClick={() => void signAndActivate()} disabled={action !== "idle"} className="vault-primary mt-5">{action === "signing" ? "Waiting for Privy…" : "Sign & activate vault"}</button></div> : <button type="button" onClick={() => void previewMandate()} disabled={!draftInput || action !== "idle"} className="vault-primary mt-6">{action === "previewing" ? <><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none"/>Loading exact fields…</> : <><LockKeyhole className="h-4 w-4"/>Preview exact mandate</>}</button>}
            {actionError ? <p role="alert" className="mt-4 text-sm text-red-200">{actionError}</p> : null}
          </div>

          <aside className="bg-[#0c1526] p-5 md:p-8"><p className="vault-kicker">02 · FUNDING READINESS</p><h3 className="mt-2 text-2xl">Separate identities, visible limits.</h3><div className="mt-6 space-y-3"><Readiness icon={WalletCards} label="Receiver wallet" value={short(activeVault?.receiver ?? session.walletAddress ?? "Unavailable")} state="Receives ATS units"/><Readiness icon={Bot} label="Vault executor" value={activeVault?.executor.address ?? "Created after signature"} state={activeVault?.executor.status === "ready" ? `${activeVault.executor.hbarBalance} HBAR · ${activeVault.executor.usdcBalance} USDC ready` : "Funding check pending"}/></div><p className="mt-5 text-xs leading-5 text-white/40">Balances and readiness are projections returned by the authenticated service. The browser never receives signing keys.</p></aside>
        </div>

        <div className="mt-px grid gap-px bg-white/10 lg:grid-cols-3">
          <Panel kicker="03 · AGENT CONNECTION" title="Account-bound MCP access" icon={Link2}>{load.data.connections.length ? load.data.connections.map((item)=><div key={item.id} className="vault-list-row"><div><b>{item.name}</b><p>{item.scopes.join(" · ")}</p></div><Status value={item.status}/></div>) : <Empty text="No agent is connected. Open the remote MCP URL and complete browser OAuth."/>}</Panel>
          <Panel kicker="04 · APPROVAL INBOX" title="Human authority stays visible" icon={Clock3}>{pendingApproval ? <div className="vault-approval"><p className="font-medium">{pendingApproval.summary}</p><p className="mt-2 text-xs text-white/40">{pendingApproval.clientName} · {formatDate(pendingApproval.requestedAt)}</p><div className="mt-5 flex gap-2"><button type="button" className="vault-primary flex-1" disabled={action !== "idle"} onClick={() => void actOnApproval(pendingApproval,"approve")}>{action === "approving" ? "Signing…" : "Review & approve"}</button><button type="button" className="vault-secondary" disabled={action !== "idle"} onClick={() => void actOnApproval(pendingApproval,"reject")}>Reject</button></div></div> : <Empty text="No run is waiting for approval."/>}</Panel>
          <Panel kicker="05 · PERSONAL HISTORY" title="Every run keeps its provenance" icon={Radio}>{load.data.runs.length ? load.data.runs.map((item)=><RunSummary key={item.id} run={item}/>) : <Empty text="Runs appear here after the service admits them."/>}</Panel>
        </div>

        <div className="mt-px bg-[#111b2e] p-5 md:p-8"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="vault-kicker">LIVE CONTROL ROOM</p><h3 className="mt-2 text-2xl">Backend-confirmed run timeline</h3></div>{latestRun ? <div className="font-mono text-[10px] text-white/45"><p>{latestRun.id}</p><p className="mt-1">Triggered by {latestRun.triggeredBy}</p></div> : null}</div>{latestRun ? <ol className="mt-7 grid gap-px bg-white/10 md:grid-cols-2 lg:grid-cols-4">{liveEvents.map((event)=><li key={event.id} className={`vault-event is-${event.status}`}><span className="vault-event-mark">{event.status === "confirmed" ? <Check/> : event.status === "running" ? <LoaderCircle/> : <Radio/>}</span><p className="mt-4 font-medium">{event.label}</p><p className="mt-2 text-xs leading-5 text-white/40">{event.detail}</p><time className="mt-4 block font-mono text-[9px] text-white/25">{formatDate(event.occurredAt)}</time></li>)}</ol> : <Empty text="No event stream yet. Confirmed motion begins only after the service publishes a run event."/>}</div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactElement<{ id?: string; className?: string }> }) { const id = `vault-${label.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`; return <label htmlFor={id} className="vault-field"><span>{label}</span>{<children.type {...children.props} id={id} className="vault-input"/>}</label>; }
function Identity({label,value}:{label:string;value:string}) { return <div className="bg-[#111b2e] p-4"><span className="text-white/35">{label}</span><strong className="mt-2 block text-white/85">{value}</strong></div>; }
function Readiness({icon:Icon,label,value,state}:{icon:typeof WalletCards;label:string;value:string;state:string}) { return <div className="flex gap-3 border border-white/10 p-4"><Icon className="h-4 w-4 text-emerald-300"/><div><p className="text-xs text-white/40">{label}</p><p className="mt-1 font-mono text-xs">{value}</p><p className="mt-2 text-xs text-emerald-300">{state}</p></div></div>; }
function Panel({kicker,title,icon:Icon,children}:{kicker:string;title:string;icon:typeof Bot;children:ReactNode}) { return <article className="bg-[#0c1526] p-5 md:p-7"><div className="flex items-start justify-between"><div><p className="vault-kicker">{kicker}</p><h3 className="mt-2 text-xl">{title}</h3></div><Icon className="h-5 w-5 text-white/35"/></div><div className="mt-6">{children}</div></article>; }
function Status({value}:{value:string}) { return <span className="rounded-full border border-emerald-300/30 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{value}</span>; }
function Empty({text}:{text:string}) { return <p className="border border-dashed border-white/15 p-4 text-sm leading-6 text-white/40">{text}</p>; }
function RunSummary({run}:{run:VaultRun}) { return <div className="vault-list-row"><div><b>{run.offeringSymbol} · {run.id}</b><p>{formatDate(run.createdAt)} · {run.triggeredBy}</p></div>{run.proofDigest ? <Link to={`/trades/${run.proofDigest}`} aria-label={`Open proof for ${run.id}`} className="text-emerald-300"><ArrowUpRight className="h-4 w-4"/></Link> : <Status value={run.state}/>}</div>; }
