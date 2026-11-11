import Link from "next/link";
import type { ReactNode } from "react";

/** Bilingual label: English on top, Hindi below (smaller). */
export function Bi({ en, hi }: { en: string; hi: string }) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{en}</span>
      <span className="text-[0.8em] opacity-75">{hi}</span>
    </span>
  );
}

export function Page({ title, back, children }: { title: ReactNode; back?: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4">
      <div className="mb-4 flex items-center gap-3">
        {back && (
          <Link href={back} className="rounded-lg border border-line px-3 py-2 text-base" aria-label="Back">
            ←
          </Link>
        )}
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      {children}
    </main>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function BigLink({ href, children, disabled }: { href: string; children: ReactNode; disabled?: boolean }) {
  if (disabled)
    return (
      <div className="flex min-h-24 items-center justify-center rounded-2xl border-2 border-dashed border-line p-4 text-center text-lg text-muted">
        {children}
      </div>
    );
  return (
    <Link
      href={href}
      className="flex min-h-24 items-center justify-center rounded-2xl bg-brand p-4 text-center text-lg font-semibold text-white shadow-sm active:scale-[0.98]"
    >
      {children}
    </Link>
  );
}

export function DemoBanner({ database }: { database: string }) {
  if (database === "pump_prod") return null;
  return (
    <div className="bg-orange-500 px-4 py-2 text-center text-sm font-bold text-white">
      DEMO DATA: practice only, not real accounts · डेमो डेटा: केवल अभ्यास
    </div>
  );
}
