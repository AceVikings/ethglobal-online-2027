import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const navItems = [
  { label: "Overview", href: "/" },
  { label: "Trades", href: "/#desk" },
  { label: "Activity", href: "/#activity" },
  { label: "Proof", href: "/#proof" },
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

        <nav className="hidden items-center justify-center gap-10 md:flex" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="inline-flex min-h-10 items-center text-sm font-medium text-primary-copy transition-opacity duration-200 hover:opacity-60 focus-visible:ring-2 focus-visible:ring-active"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href="/#desk"
          className="pill-action hidden min-h-10 items-center justify-self-end gap-2 bg-action px-6 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:inline-flex"
        >
          View clearing desk
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>

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
              <a
                key={item.label}
                href={item.href}
                className="flex min-h-16 items-center justify-between border-b border-hairline text-2xl text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
              >
                {item.label}
                <span className="font-mono text-xs text-muted-copy">0{index + 1}</span>
              </a>
            ))}
          </nav>
          <a href="/#desk" className="pill-action inline-flex min-h-12 items-center justify-between bg-action px-6 font-medium text-white focus-visible:ring-2 focus-visible:ring-active">
            View clearing desk <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </header>
  );
}
