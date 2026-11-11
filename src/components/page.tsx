import Link from "next/link";
import type { ReactNode } from "react";
import { q } from "@/server/db";
import { currentUser } from "@/server/session";
import { Shell } from "./ui";

/** Server wrapper for the smaller pages: same top bar as the register, a title and an optional back link. */
export async function Page({ title, back, children, active, wide }: { title: ReactNode; back?: string; children: ReactNode; active?: "register" | "days" | "customers" | "settings"; wide?: boolean }) {
  const user = await currentUser();
  const pump = user ? ((await q<{ name: string }>("SELECT name FROM sites WHERE active LIMIT 1"))[0]?.name ?? null) : null;
  return (
    <Shell user={user && !user.mustChangePassword ? user : null} pump={pump} active={active} wide={wide}>
      <div className="mb-3 flex items-center gap-2">
        {back && (
          <Link href={back} className="btn-light inline-flex items-center" aria-label="Back">
            ←
          </Link>
        )}
        <h1 className="text-lg font-bold">{title}</h1>
      </div>
      {children}
    </Shell>
  );
}
