import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const navItems = [
  { label: "Desk", href: "/#desk" },
  { label: "Event stream", href: "/#stream" },
  { label: "Coverage", href: "/#coverage" },
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
    <header className="absolute inset-x-0 top-0 z-50 px-4 pt-6 md:px-8 md:pt-9 lg:px-14">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link
          to="/"
          className="inline-flex min-h-10 items-center gap-3 text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
          aria-label="Conformance Desk home"
        >
          <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
            <path d="M3 4h18l8 8v16H3V4Z" fill="none" stroke="currentColor" />
            <path d="M21 4v8h8M9 12h6M9 18h14M9 24h10" fill="none" stroke="currentColor" />
          </svg>
          <span className="text-base font-medium tracking-tight md:text-xl">Conformance Desk</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="inline-flex min-h-10 items-center text-sm text-secondary-copy transition-colors hover:text-primary-copy focus-visible:ring-2 focus-visible:ring-active"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href="/#desk"
          className="hidden min-h-10 items-center gap-2 bg-primary-copy px-3 text-sm font-medium text-button-copy transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-active focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:inline-flex"
        >
          View decision desk
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center border border-hairline text-primary-copy focus-visible:ring-2 focus-visible:ring-active md:hidden"
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
          <a href="/#desk" className="inline-flex min-h-12 items-center justify-between bg-primary-copy px-4 font-medium text-button-copy focus-visible:ring-2 focus-visible:ring-active">
            View decision desk <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </header>
  );
}
