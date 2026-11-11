"use client";

import { Field, SaveStatus, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { inr } from "@/lib/format";

export function RateForm({
  fuel,
  current,
  setBy,
}: {
  fuel: { code: string; nameEn: string; nameHi: string; short: string };
  current: string | null;
  setBy: string | null;
}) {
  const { state, run } = useAction("/api/owner/meters");
  return (
    <Card>
      <h2 className="text-xl font-bold">
        {fuel.nameEn} ({fuel.short}) / {fuel.nameHi}
      </h2>
      <div className="mb-3 text-base">
        {current ? (
          <>
            Current: <b>{inr(current)}</b> per litre <span className="text-sm text-muted">· set by {setBy}</span>
          </>
        ) : (
          <span className="font-semibold text-orange-600">Not set yet for today / आज का रेट नहीं डाला</span>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run({ action: "setRate", fuelCode: fuel.code, rate: f.get("rate"), reason: f.get("reason") || null }, "Rate saved. / रेट सेव हो गया।");
        }}
      >
        <Field label="Rate ₹ per litre / रेट प्रति लीटर" name="rate" inputMode="decimal" placeholder="e.g. 95.11" required />
        {current && <Field label="Reason for change / बदलने का कारण" name="reason" hint="Needed because a rate is already set today" required />}
        <SubmitButton state={state}>Save rate / सेव</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}
