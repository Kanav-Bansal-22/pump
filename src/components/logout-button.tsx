"use client";

import { apiPost } from "@/lib/api-client";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="w-full rounded-xl border-2 border-line px-4 py-3 text-base"
      onClick={async () => {
        await apiPost("/api/auth/logout", {});
        window.location.href = "/login";
      }}
    >
      Log out / लॉग आउट
    </button>
  );
}
