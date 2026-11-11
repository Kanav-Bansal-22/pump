"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, SaveStatus, SubmitButton, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost, keepKey, newEntryKey } from "@/lib/api-client";

type U = { id: string; name: string; username: string; role: string; active: boolean; mustChange: boolean; homeView: "register" | "simple"; locked: boolean; lastLogin: string | null };

function useUserAction() {
  const router = useRouter();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  // one key per intended action; reused on retry so a double tap never runs it twice
  const key = useRef(newEntryKey());
  const run = async (body: unknown, okMsg: string) => {
    setState({ kind: "saving" });
    const r = await apiPost("/api/users", body, key.current);
    if (!r.ok) {
      if (!keepKey(r.error.code)) key.current = newEntryKey();
      return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
    }
    key.current = newEntryKey();
    setState({ kind: "saved", message: okMsg });
    router.refresh();
  };
  return { state, run };
}

export function UsersEditor({ users, meId }: { users: U[]; meId: string }) {
  return (
    <div className="space-y-4">
      <AddUser />
      {users.map((u) => (
        <UserCard key={u.id} u={u} isMe={u.id === meId} />
      ))}
    </div>
  );
}

function AddUser() {
  const { state, run } = useUserAction();
  return (
    <Card>
      <h2 className="mb-3 text-lg font-bold">Add a person / नया व्यक्ति जोड़ें</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          run(
            { action: "create", name: f.get("name"), username: f.get("username"), tempPassword: f.get("tempPassword"), role: f.get("role") },
            "Login created. Tell them the username and temporary password; they will set their own.",
          ).then(() => form.reset());
        }}
      >
        <Field label="Name / नाम" name="name" required />
        <Field label="Username / यूज़रनेम" name="username" autoCapitalize="none" hint="e.g. ramesh (small letters, no spaces)" required />
        <Field label="Temporary password (8+) / अस्थायी पासवर्ड" name="tempPassword" required />
        <label className="mb-4 block">
          <span className="mb-1 block text-base font-medium">Role / भूमिका</span>
          <select name="role" defaultValue="STAFF" className="inp w-full">
            <option value="STAFF">Staff / कर्मचारी</option>
            <option value="OWNER">Owner / मालिक</option>
          </select>
        </label>
        <SubmitButton state={state}>Create login / लॉगिन बनाएँ</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}

function UserCard({ u, isMe }: { u: U; isMe: boolean }) {
  const { state, run } = useUserAction();
  const [showReset, setShowReset] = useState(false);
  return (
    <Card className={u.active ? "" : "opacity-60"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-lg font-bold">
            {u.name} {isMe && <span className="text-sm font-normal">(you)</span>}
          </div>
          <div className="text-sm text-muted">
            {u.username} · {u.role === "OWNER" ? "Owner" : "Staff"} · {u.active ? "Active" : "Disabled"}
            {u.locked && " · Locked (wrong passwords)"}
            {u.mustChange && " · Must set own password"}
          </div>
          <div className="text-sm text-muted">Last login: {u.lastLogin ?? "never"}</div>
        </div>
        <label className="text-sm">
          <span className="mr-1 text-muted">Opens:</span>
          <select
            className="inp"
            value={u.homeView}
            onChange={(e) =>
              run(
                { action: "setHomeView", userId: u.id, view: e.target.value },
                e.target.value === "simple" ? "Will open the phone view (Udhari + My UPI)." : "Will open the full register.",
              )
            }
          >
            <option value="simple">Phone view: Udhari + My UPI</option>
            <option value="register">Full register (counter laptop)</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={() => setShowReset((x) => !x)}>
          Reset password
        </button>
        {!isMe && (
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2"
            onClick={() => run({ action: "setActive", userId: u.id, active: !u.active }, u.active ? "Login disabled and signed out." : "Login enabled.")}
          >
            {u.active ? "Disable login" : "Enable login"}
          </button>
        )}
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-2"
          onClick={() => run({ action: "logoutEverywhere", userId: u.id }, "Signed out on all phones.")}
        >
          Sign out all phones
        </button>
      </div>
      {showReset && (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: "resetPassword", userId: u.id, tempPassword: new FormData(e.currentTarget).get("tempPassword") }, "Temporary password set. They must choose a new one at next login.");
            setShowReset(false);
          }}
        >
          <Field label="New temporary password (8+)" name="tempPassword" required />
          <SubmitButton state={state}>Set temporary password</SubmitButton>
        </form>
      )}
      <SaveStatus state={state} />
    </Card>
  );
}
