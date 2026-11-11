"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { SaveState } from "./forms";
import { apiPost, newEntryKey } from "@/lib/api-client";

/** Posts an action with a per-intent entry key (kept on connection failure, renewed after an answer). */
export function useAction<T = unknown>(path: string) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const key = useRef(newEntryKey());
  const run = async (body: unknown, okMsg: string): Promise<T | null> => {
    setState({ kind: "saving" });
    const r = await apiPost<T>(path, body, key.current);
    if (!r.ok) {
      if (r.error.code !== "NO_CONNECTION") key.current = newEntryKey();
      setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
      return null;
    }
    key.current = newEntryKey();
    setState({ kind: "saved", message: okMsg });
    router.refresh();
    return r.data;
  };
  return { state, run, setState };
}
