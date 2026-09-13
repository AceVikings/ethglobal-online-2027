import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { AccountButton } from "./AccountButton";

const navItems = [
  { label: "Overview", to: "/" },
  { label: "My vault", to: "/?section=live" },
  { label: "Flow", to: "/?section=flow" },
  { label: "Trades", to: "/?section=desk" },
  { label: "Activity", to: "/?section=activity" },
  { label: "Proof", to: "/?section=proof" },
];

export function AppHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="absolute inset-x-0 top-0 z-50 px-4 py-6 md:px-8">
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center md:grid-cols-3">
        <Link
          to="/"
          className="inline-flex min-h-10 items-center font-display text-[30px] leading-none tracking-[-1px] text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
          aria-label="AI Clearing Desk home"
        >
          Clearing<sup className="ml-1 self-start font-sans text-[9px] font-medium leading-none">AI</sup>
        </Link>

        <nav className="hidden items-center justify-center gap-8 md:flex" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className="inline-flex min-h-10 items-center text-sm font-medium text-primary-copy transition-opacity duration-200 hover:opacity-60 focus-visible:ring-2 focus-visible:ring-active"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center justify-self-end gap-3 md:flex">
          <Link
            to="/?section=desk"
            className="hidden min-h-10 items-center gap-1.5 px-2 text-sm font-medium text-primary-copy focus-visible:ring-2 focus-visible:ring-active xl:inline-flex"
          >
            Open desk <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <AccountButton />
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center justify-self-end rounded-full border border-primary-copy/30 text-primary-copy focus-visible:ring-2 focus-visible:ring-active md:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>

      {open ? (
        <div id="mobile-navigation" className="fixed inset-0 -z-10 flex flex-col bg-canvas px-6 pb-8 pt-28 md:hidden">
          <nav className="flex flex-1 flex-col gap-2" aria-label="Mobile navigation">
            {navItems.map((item, index) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => setOpen(false)}
                className="flex min-h-16 items-center justify-between border-b border-hairline text-2xl text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
              >
                {item.label}
                <span className="font-mono text-xs text-muted-copy">0{index + 1}</span>
              </Link>
            ))}
          </nav>
          <div className="space-y-3">
            <Link
              to="/?section=desk"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-12 w-full items-center justify-between rounded-full border border-hairline bg-surface px-6 font-medium text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
            >
              Open clearing desk <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <AccountButton mobile />
          </div>
        </div>
      ) : null}
    </header>
  );
}
