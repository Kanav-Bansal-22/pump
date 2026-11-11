import Link from "next/link";
import type { ReactNode } from "react";

/** "English · हिंदी" on one line, Hindi smaller. */
export function Bi({ en, hi }: { en: string; hi: string }) {
  return (
    <span>
      {en} <span className="text-[0.85em] font-normal opacity-70">· {hi}</span>
    </span>
  );
}

const NAV = [
  { href: "/", key: "register", en: "Register", hi: "रोकड़" },
  { href: "/days", key: "days", en: "Daily records", hi: "दैनिक हिसाब" },
  { href: "/customers", key: "customers", en: "Udhari customers", hi: "उधारी खाते" },
  { href: "/settings", key: "settings", en: "Settings", hi: "सेटिंग" },
] as const;

/** Top bar with the pump name, navigation and the logged-in person. */
export function Shell({
  active,
  user,
  pump,
  children,
  wide,
}: {
  active?: (typeof NAV)[number]["key"];
  user?: { name: string; role: string } | null;
  pump?: string | null;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <header className="bg-brand text-white">
        <div className={`mx-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
          <span className="font-bold">⛽ {pump ?? "Petrol Pump"}</span>
          {user && (
            <nav className="flex flex-wrap gap-1 text-[0.95rem]">
              {NAV.filter((n) => n.key !== "settings" || user.role === "OWNER").map((n) => (
                <Link
                  key={n.key}
                  href={n.href}
                  className={`rounded px-2 py-0.5 ${active === n.key ? "bg-white font-semibold text-brand" : "hover:bg-white/15"}`}
                >
                  {n.en}
                </Link>
              ))}
            </nav>
          )}
          {user && (
            <span className="ml-auto flex items-center gap-2 text-sm opacity-90">
              {user.name}
              <form action="/logout" method="post">
                <button className="rounded border border-white/40 px-2 py-0.5 text-xs hover:bg-white/15">Log out</button>
              </form>
            </span>
          )}
        </div>
      </header>
      <main className={`mx-auto w-full px-3 pb-10 pt-3 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>{children}</main>
    </>
  );
}

/** A register panel: navy title bar + white body. */
export function Panel({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-[#e8eef5] px-3 py-1.5 text-[0.95rem] font-semibold text-brand">
        <span>{title}</span>
        {right && <span className="text-sm font-normal text-muted">{right}</span>}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded border border-line bg-surface p-3 ${className}`}>{children}</section>;
}

export function BigLink({ href, children, disabled }: { href: string; children: ReactNode; disabled?: boolean }) {
  if (disabled) return <div className="rounded border border-dashed border-line p-3 text-center text-muted">{children}</div>;
  return (
    <Link href={href} className="block rounded border border-line bg-surface p-3 hover:border-accent hover:bg-soft">
      {children}
    </Link>
  );
}

export function DemoBanner({ database }: { database: string }) {
  if (database === "pump_prod") return null;
  return (
    <div className="no-print bg-orange-500 px-3 py-0.5 text-center text-xs font-semibold text-white">
      DEMO DATA: practice only, not real accounts · डेमो डेटा
    </div>
  );
}
