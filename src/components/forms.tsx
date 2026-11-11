"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

export function Field({ label, hint, ...props }: { label: ReactNode; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-0.5 block text-sm font-medium text-muted">{label}</span>
      <input {...props} className="inp w-full" />
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
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
      <div role="status" className="mt-2 rounded border border-green-300 bg-green-50 px-2 py-1 text-sm font-medium text-green-900">
        ✓ {state.message}
      </div>
    );
  if (state.kind === "error")
    return (
      <div role="alert" className="mt-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-sm font-medium text-red-900">
        ✗ NOT saved: {state.message}
        {state.messageHi && <span className="ml-1 font-normal opacity-80">{state.messageHi}</span>}
      </div>
    );
  return null;
}

export function SubmitButton({ state, children }: { state: SaveState; children: ReactNode }) {
  return (
    <button type="submit" disabled={state.kind === "saving"} className="btn w-full">
      {state.kind === "saving" ? "Saving…" : children}
    </button>
  );
}
