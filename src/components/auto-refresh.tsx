"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Keeps the page up to date with what others enter (owner's laptop shows staff entries without reloading).
 * Refreshes the server data every `seconds` while the tab is visible and nobody is typing in a box.
 * Typed values are kept: a refresh only re-reads the server figures.
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  const [last, setLast] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA")) return; // don't disturb typing
      router.refresh();
      setLast(new Date());
    };
    const id = setInterval(tick, seconds * 1000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);
  return (
    <span className="text-xs text-muted" title="This page updates by itself" suppressHydrationWarning>
      ⟳ {last.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
    </span>
  );
}
