"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

export function Field({ label, hint, ...props }: { label: ReactNode; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-base font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border-2 border-line bg-white px-4 py-3 text-lg text-black outline-none focus:border-brand"
      />
      {hint && <span className="mt-1 block text-sm text-muted">{hint}</span>}
    </label>
  );
}

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string; messageHi?: string };

/** The one place that shows saved / NOT saved. Success only appears after the server confirms. */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "saved")
    return (
      <div role="status" className="mt-4 rounded-xl bg-green-100 p-4 text-lg font-semibold text-green-900">
        ✅ {state.message}
      </div>
    );
  if (state.kind === "error")
    return (
      <div role="alert" className="mt-4 rounded-xl bg-red-100 p-4 text-lg font-semibold text-red-900">
        ❌ {state.message}
        {state.messageHi && <div className="mt-1 text-base font-normal">{state.messageHi}</div>}
      </div>
    );
  return null;
}

export function SubmitButton({ state, children }: { state: SaveState; children: ReactNode }) {
  const saving = state.kind === "saving";
  return (
    <button
      type="submit"
      disabled={saving}
      className="w-full rounded-2xl bg-brand px-4 py-4 text-xl font-bold text-white disabled:opacity-60"
    >
      {saving ? "⏳ Saving… / सेव हो रहा है…" : children}
    </button>
  );
}
