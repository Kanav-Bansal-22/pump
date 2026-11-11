"use client";

import { useState } from "react";
import { Field, SaveStatus, SubmitButton, type SaveState } from "@/components/forms";
import { Card } from "@/components/ui";
import { apiPost } from "@/lib/api-client";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  return (
    <Card>
      {forced && (
        <p className="mb-4 text-base">
          The owner gave you a temporary password. Choose your own now. <br />
          <span className="opacity-80">मालिक ने अस्थायी पासवर्ड दिया है। अब अपना पासवर्ड बनाएँ।</span>
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (f.get("newPassword") !== f.get("newPassword2"))
            return setState({ kind: "error", message: "The two new passwords do not match.", messageHi: "दोनों नए पासवर्ड एक जैसे नहीं हैं।" });
          setState({ kind: "saving" });
          const r = await apiPost("/api/auth/change-password", {
            oldPassword: f.get("oldPassword"),
            newPassword: f.get("newPassword"),
          });
          if (!r.ok) return setState({ kind: "error", message: r.error.message, messageHi: r.error.messageHi });
          setState({ kind: "saved", message: "Password changed. / पासवर्ड बदल गया।" });
          setTimeout(() => (window.location.href = "/"), 800);
        }}
      >
        <Field label="Current password / मौजूदा पासवर्ड" name="oldPassword" type="password" autoComplete="current-password" required />
        <Field label="New password (8+) / नया पासवर्ड" name="newPassword" type="password" autoComplete="new-password" required />
        <Field label="New password again / नया पासवर्ड दोबारा" name="newPassword2" type="password" autoComplete="new-password" required />
        <SubmitButton state={state}>Save / सेव करें</SubmitButton>
        <SaveStatus state={state} />
      </form>
    </Card>
  );
}
