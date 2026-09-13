import { ArrowUpRight, Bot, Check, CircleAlert, Clipboard, Clock3, Link2, LoaderCircle, LockKeyhole, Radio, ShieldCheck, Terminal, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { activateVault, createConnectionToken, decideApproval, fetchVaultDashboard, previewVaultDraft, watchRunEvents, type ApprovalRequest, type ConnectionToken, type RunEvent, type VaultDraftInput, type VaultDraftPreview, type VaultRun } from "../api/vaults";
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
  const [action, setAction] = useState<"idle" | "previewing" | "signing" | "generating" | "approving" | "rejecting">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);
  const [connectionToken, setConnectionToken] = useState<ConnectionToken | null>(null);
  const [copied, setCopied] = useState<"config" | "command" | null>(null);

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
  const runPrincipal = latestRun?.snapshot?.liveMandate?.units && latestRun.snapshot.offering?.unitPrice
    ? `${(Number(latestRun.snapshot.liveMandate.units) * Number(latestRun.snapshot.offering.unitPrice)).toFixed(2)} ${latestRun.snapshot.offering.currency ?? "USDC"}`
    : "Awaiting run snapshot";

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
      if (!session.signTypedData) throw new Error("This wallet cannot sign the exact EIP-712 vault mandate.");
      const signature = await session.signTypedData(preview.typedData);
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

  const generateConnection = async () => {
    setAction("generating"); setActionError(null); setConnectionToken(null);
    try { setConnectionToken(await withToken(createConnectionToken)); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Connection generation failed."); }
    finally { setAction("idle"); }
  };

  const copy = async (kind: "config" | "command", value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(kind); }
    catch { setActionError("Clipboard access was denied. Select and copy the value manually."); }
  };

  if (!session.authenticated) return (
    <section id="live" className="vault-room scroll-mt-16 bg-primary-copy pb-20 pt-32 text-white md:pb-28 md:pt-40">
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
            <div className="flex items-center justify-between"><div><p className="vault-kicker">01 · CONFIGURE</p><h3 className="mt-2 text-2xl">Exact mandate bounds</h3></div><ShieldCheck className="text-emerald-300"/></div>
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
            {preview ? <div className="mt-5 border border-emerald-300/30 bg-emerald-300/[0.06] p-4"><p className="vault-kicker text-emerald-300">02 · EIP-712 SIGNATURE</p><div className="mt-3 flex flex-wrap gap-6 font-mono text-xs"><span>Principal <b>{preview.preview.principal}</b></span><span>Policy <b>{short(preview.preview.policyHash)}</b></span></div><p className="mt-3 text-xs leading-5 text-white/45">Privy displays the exact typed mandate. Signing activates policy; it does not transfer funds.</p><button type="button" onClick={() => void signAndActivate()} disabled={action !== "idle"} className="vault-primary mt-5">{action === "signing" ? "Waiting for Privy…" : "Sign EIP-712 & activate"}</button></div> : <button type="button" onClick={() => void previewMandate()} disabled={!draftInput || action !== "idle"} className="vault-primary mt-6">{action === "previewing" ? <><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none"/>Loading exact fields…</> : <><LockKeyhole className="h-4 w-4"/>Preview exact mandate</>}</button>}
            {actionError ? <p role="alert" className="mt-4 text-sm text-red-200">{actionError}</p> : null}
          </div>

          <aside className="bg-[#0c1526] p-5 md:p-8"><p className="vault-kicker">EXECUTOR READINESS</p><h3 className="mt-2 text-2xl">Separate identities, visible limits.</h3><div className="mt-6 space-y-3"><Readiness icon={WalletCards} label="Receiver wallet" value={short(activeVault?.receiver ?? session.walletAddress ?? "Unavailable")} state="Receives ATS units"/><Readiness icon={Bot} label="Vault executor" value={activeVault?.executor.address ?? "Created after signature"} state={activeVault?.executor.status === "ready" ? `${activeVault.executor.hbarBalance} HBAR · ${activeVault.executor.usdcBalance} USDC ready` : "Funding check pending"}/></div><p className="mt-5 text-xs leading-5 text-white/40">Balances and readiness are projections returned by the authenticated service. The browser never receives signing keys.</p></aside>
        </div>

        <div className="mt-px grid gap-px bg-white/10 lg:grid-cols-2">
          <Panel kicker="03 · CREATE ONE-TIME CONNECTION" title="Connect your terminal agent" icon={Link2}>
            <p className="text-sm leading-6 text-white/45">Generate a short-lived, account-bound bearer only when you are ready to connect. The token is never embedded in this site.</p>
            <button type="button" className="vault-primary mt-5" disabled={action !== "idle"} onClick={() => void generateConnection()}>{action === "generating" ? <><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none"/>Generating…</> : <><Link2 className="h-4 w-4"/>Generate connection</>}</button>
            {connectionToken ? <ConnectionInstructions connection={connectionToken} copied={copied} onCopy={copy}/> : null}
            {load.data.connections.map((item)=><div key={item.id} className="vault-list-row"><div><b>{item.name}</b><p>{item.scopes.join(" · ")}</p></div><Status value={item.status}/></div>)}
          </Panel>
          <Panel kicker="04 · TERMINAL REQUEST" title="Ask the agent to request a run" icon={Terminal}><div className="border border-white/10 bg-black/20 p-4 font-mono text-xs leading-6 text-white/65"><span className="text-emerald-300">agent ›</span> Request a run for my active vault.<br/><span className="text-white/30">expected ›</span> approval_required</div><p className="mt-4 text-sm leading-6 text-white/40">The agent can request, but cannot approve. Refresh after the terminal reports an approval request.</p><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="vault-secondary mt-4">Refresh approval inbox</button></Panel>
          <Panel kicker="05 · APPROVAL" title="Human authority stays visible" icon={Clock3}>{pendingApproval ? <div className="vault-approval"><p className="font-medium">{pendingApproval.summary}</p><p className="mt-2 text-xs text-white/40">{pendingApproval.clientName} · {formatDate(pendingApproval.requestedAt)}</p><div className="mt-5 flex gap-2"><button type="button" className="vault-primary flex-1" disabled={action !== "idle"} onClick={() => void actOnApproval(pendingApproval,"approve")}>{action === "approving" ? "Signing…" : "Sign approval"}</button><button type="button" className="vault-secondary" disabled={action !== "idle"} onClick={() => void actOnApproval(pendingApproval,"reject")}>Reject</button></div></div> : <Empty text="No run is waiting for approval. The inbox changes only after a real agent request."/>}</Panel>
          <Panel kicker="07 · PERSONAL HISTORY" title="Every run keeps its provenance" icon={Radio}>{load.data.runs.length ? load.data.runs.map((item)=><RunSummary key={item.id} run={item}/>) : <Empty text="Runs appear here after the service admits them."/>}</Panel>
        </div>

        <div className="mt-px bg-[#111b2e] p-5 md:p-8"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="vault-kicker">06 · REAL SSE HEDERA TIMELINE</p><h3 className="mt-2 text-2xl">Backend-confirmed run evidence</h3></div>{latestRun ? <div className="font-mono text-[10px] text-white/45"><p>Run {latestRun.id}</p><p className="mt-1">Triggered by {latestRun.triggeredBy}</p></div> : null}</div>{latestRun ? <><div className="vault-evidence mt-7"><Evidence label="Transaction principal" value={runPrincipal}/><Evidence label="x402 fee ceiling" value={latestRun.snapshot?.liveMandate?.maxDecisionFee ?? "Awaiting run snapshot"}/><Evidence label="Run ID" value={latestRun.id}/><Evidence label="Hedera chain references" value={latestRun.proofDigest ? "Open public proof" : "Pending backend proof"} link={latestRun.proofDigest ? `/trades/${latestRun.proofDigest}` : undefined}/></div><ol className="mt-px grid gap-px bg-white/10 md:grid-cols-2 lg:grid-cols-4">{liveEvents.map((event)=><li key={event.id} className={`vault-event is-${event.status}`}><span className="vault-event-mark">{event.status === "confirmed" ? <Check/> : event.status === "running" ? <LoaderCircle/> : <Radio/>}</span><p className="mt-4 font-medium">{event.label}</p><p className="mt-2 text-xs leading-5 text-white/40">{event.detail}</p><time className="mt-4 block font-mono text-[9px] text-white/25">{formatDate(event.occurredAt)}</time></li>)}</ol></> : <Empty text="No event stream yet. Confirmed motion begins only after the service publishes a run event."/>}</div>
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
function Evidence({label,value,link}:{label:string;value:string;link?:string}) { return <div><p>{label}</p>{link ? <Link to={link} className="mt-2 inline-flex items-center gap-2 text-emerald-300">{value}<ArrowUpRight className="h-4 w-4"/></Link> : <strong>{value}</strong>}</div>; }
function ConnectionInstructions({connection,copied,onCopy}:{connection:ConnectionToken;copied:"config"|"command"|null;onCopy:(kind:"config"|"command",value:string)=>void}) {
  const command = `export CONFORMANCE_MCP_TOKEN='${connection.token}'\ncodex mcp add conformance-desk --url "${connection.mcpUrl}" --bearer-token-env-var CONFORMANCE_MCP_TOKEN`;
  const config = JSON.stringify({ mcpServers: { "conformance-desk": { url: connection.mcpUrl, headers: { Authorization: `Bearer ${connection.token}` } } } }, null, 2);
  return <div className="mt-5 border border-amber-200/25 bg-amber-100/[0.05] p-4"><p className="font-mono text-[10px] tracking-wider text-amber-100">SHOWN ONCE · EXPIRES IN {Math.round(connection.expiresIn / 60)} MIN</p><CopyBlock label="Terminal command" value={command} copied={copied === "command"} onCopy={() => void onCopy("command",command)}/><CopyBlock label="MCP config" value={config} copied={copied === "config"} onCopy={() => void onCopy("config",config)}/></div>;
}
function CopyBlock({label,value,copied,onCopy}:{label:string;value:string;copied:boolean;onCopy:()=>void}) { return <div className="mt-4"><div className="mb-2 flex items-center justify-between"><span className="text-xs text-white/45">{label}</span><button type="button" onClick={onCopy} className="inline-flex items-center gap-1 text-xs text-emerald-300"><Clipboard className="h-3 w-3"/>{copied ? "Copied" : "Copy"}</button></div><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all bg-black/30 p-3 font-mono text-[10px] leading-5 text-white/65">{value}</pre></div>; }
