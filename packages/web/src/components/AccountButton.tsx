import { Check, ChevronDown, CircleUserRound, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { usePrivySession } from "../auth/PrivyAuth";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function AccountButton({ mobile = false }: { mobile?: boolean }) {
  const { authenticated, configured, login, logout, ready, walletAddress } = usePrivySession();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!configured) {
    return (
      <div className={mobile ? "w-full" : "justify-self-end"}>
        <button
          type="button"
          disabled
          title="Set VITE_PRIVY_APP_ID to enable login"
          className={`${mobile ? "w-full justify-between" : "justify-center"} inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline bg-surface px-5 text-sm font-medium text-muted-copy disabled:cursor-not-allowed`}
        >
          <CircleUserRound className="h-4 w-4" aria-hidden="true" />
          Login not configured
        </button>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className={mobile ? "w-full" : "justify-self-end"}>
        <button
          type="button"
          onClick={login}
          disabled={!ready}
          aria-busy={!ready}
          className={`${mobile ? "w-full justify-between" : "justify-center"} pill-action inline-flex min-h-11 items-center gap-2 bg-action px-5 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-wait disabled:opacity-60`}
        >
          <CircleUserRound className="h-4 w-4" aria-hidden="true" />
          {ready ? "Sign in with Privy" : "Loading Privy…"}
        </button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={`relative ${mobile ? "w-full" : "justify-self-end"}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={menuId}
        className={`${mobile ? "w-full" : ""} inline-flex min-h-11 items-center justify-between gap-3 rounded-full border border-hairline bg-surface px-4 text-sm font-medium text-primary-copy focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`}
      >
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
          {walletAddress ? shortAddress(walletAddress) : "Wallet ready"}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="region"
          aria-label="Privy account"
          className={`${mobile ? "bottom-full mb-3 w-full" : "right-0 top-full mt-3 w-80"} absolute z-50 border border-hairline bg-surface p-5`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline pb-4">
            <div>
              <p className="font-mono text-[11px] tracking-[0.12em] text-muted-copy">USER MANDATE WALLET</p>
              <p className="mt-2 text-sm font-medium text-primary-copy">Privy embedded signer</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 font-mono text-[10px] text-success">
              <Check className="h-3 w-3" aria-hidden="true" /> READY
            </span>
          </div>
          <dl className="space-y-3 py-4 font-mono text-xs">
            <div className="flex items-center justify-between gap-4"><dt className="text-muted-copy">NETWORK</dt><dd className="text-primary-copy">HEDERA TESTNET · 296</dd></div>
            <div className="flex items-center justify-between gap-4"><dt className="text-muted-copy">ADDRESS</dt><dd className="text-primary-copy">{walletAddress ? shortAddress(walletAddress) : "PROVISIONING"}</dd></div>
            <div className="flex items-center justify-between gap-4"><dt className="text-muted-copy">AUTHORITY</dt><dd className="text-primary-copy">SIGN MANDATES</dd></div>
          </dl>
          <button
            type="button"
            onClick={() => void logout().then(() => setOpen(false))}
            className="inline-flex min-h-10 w-full items-center justify-between border-t border-hairline pt-4 text-sm font-medium text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
          >
            Sign out
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
