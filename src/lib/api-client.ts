"use client";

export type ApiResult<T> =
  | { ok: true; data: T; replayed?: boolean }
  | { ok: false; error: { code: string; message: string; messageHi?: string } };

/** A fresh key per form fill. Reuse the SAME key when retrying the same entry (no duplicates). */
export function newEntryKey(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * POSTs JSON. Never throws: network failures come back as a clear NOT-saved result so the
 * screen can keep the typed values and offer Retry.
 */
export async function apiPost<T = unknown>(path: string, body: unknown, entryKey?: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(entryKey ? { "idempotency-key": entryKey } : {}) },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as ApiResult<T> | null;
    if (json && typeof json === "object" && "ok" in json) {
      if (!json.ok && json.error.code === "NOT_LOGGED_IN") window.location.href = "/login";
      return json;
    }
    return { ok: false, error: { code: "BAD_RESPONSE", message: `Not saved. Server replied ${res.status}.`, messageHi: "सेव नहीं हुआ।" } };
  } catch {
    return {
      ok: false,
      error: {
        code: "NO_CONNECTION",
        message: "NOT saved: no connection to the pump computer. Check Wi-Fi and press Retry.",
        messageHi: "सेव नहीं हुआ: कंप्यूटर से कनेक्शन नहीं है। Wi-Fi देखें और फिर से दबाएँ।",
      },
    };
  }
}
