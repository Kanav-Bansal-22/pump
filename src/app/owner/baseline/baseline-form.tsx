"use client";

import { Field, SaveStatus, SubmitButton } from "@/components/forms";
import { useAction } from "@/components/use-action";

export function BaselineForm({ nozzleId }: { nozzleId: string }) {
  const { state, run, setState } = useAction("/api/owner/meters");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("reading") !== f.get("reading2"))
          return setState({ kind: "error", message: "The two numbers are different. Check the meter again.", messageHi: "दोनों नंबर अलग हैं। मीटर फिर देखें।" });
        run({ action: "setBaseline", nozzleId, reading: f.get("reading") }, "Starting reading saved.");
      }}
    >
      <Field label="Meter reading now / अभी की रीडिंग" name="reading" inputMode="decimal" placeholder="e.g. 1847703.80" required />
      <Field label="Type it again / दोबारा लिखें" name="reading2" inputMode="decimal" required />
      <SubmitButton state={state}>Save starting reading</SubmitButton>
      <SaveStatus state={state} />
    </form>
  );
}
