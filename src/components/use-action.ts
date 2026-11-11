"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { SaveState } from "./forms";
import { apiPost, keepKey, newEntryKey } from "@/lib/api-client";

/**
 * Posts an entry with a per-intent key, so a double tap or a retry after a Wi-Fi drop saves only once:
 * the key is kept while the outcome is unknown and renewed after a clear answer.
 * A "looks like a repeat" answer offers "Save anyway", which resends the same entry with confirmRepeat.
 */
export function useAction<T = unknown>(path: string) {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const key = useRef(newEntryKey());
  const busy = useRef(false);
  const run = async (body: Record<string, unknown>, okMsg: string | ((d: T) => string), onDone?: (d: T) => void): Promise<T | null> => {
    if (busy.current) return null; // second tap while the first is still on its way
    busy.current = true;
    setState({ kind: "saving" });
    try {
      const r = await apiPost<T>(path, body, key.current);
      if (!r.ok) {
        if (!keepKey(r.error.code)) key.current = newEntryKey();
        setState({
          kind: "error",
          message: r.error.message,
          messageHi: r.error.messageHi,
          unsure: r.error.code === "NO_CONNECTION" || r.error.code === "BAD_RESPONSE", // it may have reached the computer
          confirm: r.error.code === "POSSIBLE_REPEAT" ? () => void run({ ...body, confirmRepeat: true }, okMsg, onDone) : undefined,
        });
        return null;
      }
      key.current = newEntryKey();
      setState({ kind: "saved", message: typeof okMsg === "function" ? okMsg(r.data) : okMsg });
      onDone?.(r.data);
      router.refresh();
      return r.data;
    } finally {
      busy.current = false;
    }
  };
  return { state, run, setState };
}
