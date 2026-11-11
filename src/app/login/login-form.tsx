"use client";

import { useState } from "react";
import { Field, SaveStatus, SubmitButton, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost } from "@/lib/api-client";

export function LoginForm() {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setState({ kind: "saving" });
          const r = await apiPost<{ mustChangePassword: boolean }>("/api/auth/login", {
            username: f.get("username"),
            password: f.get("password"),
          });
          if (!r.ok) return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
          window.location.href = r.data.mustChangePassword ? "/change-password" : "/";
        }}
      >
        <Field label="Username / यूज़रनेम" name="username" autoComplete="username" autoCapitalize="none" required />
        <Field label="Password / पासवर्ड" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton state={state}>Log in / लॉगिन</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}
