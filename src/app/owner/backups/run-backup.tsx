"use client";

import { SaveStatus } from "@/components/forms";
import { useAction } from "@/components/use-action";

export function RunBackup() {
  const { state, run } = useAction("/api/owner/backups");
  return (
    <div>
      <button
        type="button"
        disabled={state.kind === "saving"}
        onClick={() => run({ action: "run" }, "Backup taken and checked. You can download it below.")}
        className="w-full rounded bg-brand px-3 py-2 text-base font-bold text-white disabled:opacity-60"
      >
        {state.kind === "saving" ? "⏳ Backing up…" : "Back up now / अभी बैकअप लें"}
      </button>
      <SaveStatus state={state} />
    </div>
  );
}
