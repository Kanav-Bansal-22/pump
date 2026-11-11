"use client";

import { niceDate } from "@/lib/format";

/** Only shown between 8 and 11 AM, when both yesterday's closing and today are open. */
export function DayChoice({ dates, value, onChange }: { dates: { today: string; yesterday: string | null }; value: string; onChange: (d: string) => void }) {
  if (!dates.yesterday) return null;
  return (
    <select className={`inp w-40 ${value ? "" : "border-orange-500"}`} value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">Which day?</option>
      <option value={dates.yesterday}>{niceDate(dates.yesterday)} (closing)</option>
      <option value={dates.today}>{niceDate(dates.today)} (today)</option>
    </select>
  );
}
