"use client";

import { useRouter } from "next/navigation";
import { SaveStatus } from "@/components/forms";
import { useAction } from "@/components/use-action";

export function DatePicker({ date }: { date: string }) {
  const router = useRouter();
  return (
    <label className="mb-4 flex items-center gap-3 text-base">
      Date / तारीख
      <input
        type="date"
        defaultValue={date}
        onChange={(e) => e.target.value && router.push(`/owner/day?date=${e.target.value}`)}
        className="rounded-xl border-2 border-line bg-white px-3 py-2 text-lg text-black"
      />
    </label>
  );
}

export function ReviewForm({ flagId, zero }: { flagId: string; zero: boolean }) {
  const { state, run } = useAction("/api/owner/meters");
  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run({ action: "review", flagId, decision: zero ? "MARK_NO_SALE" : "ACCEPT_AS_IS", reason: f.get("reason") }, "Reviewed.");
      }}
    >
      <input
        name="reason"
        required
        minLength={5}
        placeholder="Reason, e.g. checked meter photo"
        className="min-w-0 flex-1 rounded-lg border-2 border-line bg-white px-3 py-2 text-base text-black"
      />
      <button type="submit" disabled={state.kind === "saving"} className="rounded-lg bg-green-700 px-3 py-2 font-semibold text-white">
        {zero ? "Confirm no sale" : "Accept as correct"}
      </button>
      <div className="w-full">
        <SaveStatus state={state} />
      </div>
    </form>
  );
}
