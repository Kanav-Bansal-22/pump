"use client";

import { useState } from "react";
import { Field, SaveStatus, SubmitButton, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost } from "@/lib/api-client";

export function SetupForm() {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (f.get("password") !== f.get("password2"))
            return setState({ kind: "error", message: "The two passwords do not match.", messageHi: "दोनों पासवर्ड एक जैसे नहीं हैं।" });
          setState({ kind: "saving" });
          const r = await apiPost("/api/auth/setup-owner", {
            name: f.get("name"),
            username: f.get("username"),
            password: f.get("password"),
          });
          if (!r.ok) return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
          window.location.href = "/owner/setup";
        }}
      >
        <Field label="Owner's name / मालिक का नाम" name="name" required />
        <Field
          label="Username / यूज़रनेम"
          name="username"
          autoCapitalize="none"
          hint="Small letters/numbers, no spaces, e.g. owner"
          required
        />
        <Field label="Password (8+ letters) / पासवर्ड" name="password" type="password" autoComplete="new-password" required />
        <Field label="Password again / पासवर्ड दोबारा" name="password2" type="password" autoComplete="new-password" required />
        <SubmitButton state={state}>Create owner / मालिक बनाएँ</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}
