"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, SaveStatus, SubmitButton, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import type { Layout } from "@/server/config/service";

function useSave() {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const save = async (body: unknown, okMsg: string) => {
    setState({ kind: "saving" });
    const r = await apiPost("/api/config", body);
    if (!r.ok) return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    setState({ kind: "saved", message: okMsg });
    router.refresh();
  };
  return { state, save };
}

export function SetupEditor({ layout }: { layout: Layout }) {
  if (!layout.site) return <CreateLayout />;
  return (
    <div className="space-y-4">
      <SiteForm site={layout.site} />
      {layout.stations.map((s) => (
        <StationCard key={s.id} station={s} />
      ))}
      <Card>
        <p className="text-sm text-muted">
          Business day starts at <b>{layout.site.dayCutover}</b> (daily rate change). Confirm with the developer if the
          daily reading is taken at a different time.
        </p>
      </Card>
    </div>
  );
}

function CreateLayout() {
  const { state, save } = useSave();
  return (
    <Card>
      <h2 className="mb-2 text-lg font-bold">Create the pump layout / पंप लेआउट बनाएँ</h2>
      <ul className="mb-4 list-disc pl-6 text-base">
        <li>Station 1 Diesel: HSD A1, HSD A2</li>
        <li>Station 2 Diesel: HSD A1, HSD A2</li>
        <li>Station 3 Petrol: MS A1, MS A2</li>
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ action: "createLayout", siteName: new FormData(e.currentTarget).get("siteName") }, "Layout created. / लेआउट बन गया।");
        }}
      >
        <Field label="Petrol pump name / पंप का नाम" name="siteName" required />
        <SubmitButton state={state}>Create / बनाएँ</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}

function SiteForm({ site }: { site: NonNullable<Layout["site"]> }) {
  const { state, save } = useSave();
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({ action: "updateSite", name: f.get("name"), address: f.get("address") || null }, "Saved. / सेव हो गया।");
        }}
      >
        <Field label="Pump name / पंप का नाम" name="name" defaultValue={site.name} required />
        <Field label="Address (optional) / पता" name="address" defaultValue={site.address ?? ""} />
        <SubmitButton state={state}>Save / सेव करें</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}

function StationCard({ station }: { station: Layout["stations"][number] }) {
  const { state, save } = useSave();
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({ action: "updateStation", id: station.id, name: f.get("name"), active: f.get("active") === "on" }, "Station saved. / सेव हो गया।");
        }}
      >
        <Field label={`Station ${station.code} name`} name="name" defaultValue={station.name} required />
        <label className="mb-3 flex items-center gap-3 text-base">
          <input type="checkbox" name="active" defaultChecked={station.active} className="h-6 w-6" /> In use / चालू
        </label>
        <SubmitButton state={state}>Save station / सेव</SubmitButton>
        <SaveStatus state={state} />
      </form>
      <div className="mt-4 space-y-3">
        {station.nozzles.map((n) => (
          <NozzleRow key={n.id} nozzle={n} />
        ))}
      </div>
    </Card>
  );
}

function NozzleRow({ nozzle }: { nozzle: Layout["stations"][number]["nozzles"][number] }) {
  const { state, save } = useSave();
  return (
    <form
      className="rounded border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({ action: "updateNozzle", id: nozzle.id, label: f.get("label"), active: f.get("active") === "on" }, "Nozzle saved.");
      }}
    >
      <div className="mb-1 text-sm text-muted">
        Nozzle {nozzle.number} · {nozzle.fuelCode === "PETROL" ? "Petrol / पेट्रोल" : "Diesel / डीज़ल"}
      </div>
      <div className="flex items-center gap-2">
        <input
          name="label"
          defaultValue={nozzle.label}
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-lg text-black"
        />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="active" defaultChecked={nozzle.active} className="h-5 w-5" /> On
        </label>
        <button type="submit" disabled={state.kind === "saving"} className="rounded-lg bg-brand px-3 py-2 text-white">
          {state.kind === "saving" ? "…" : "Save"}
        </button>
      </div>
      <SaveStatus state={state} />
    </form>
  );
}
