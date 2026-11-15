"use client";

import { useState } from "react";
import { niceDate } from "@/lib/format";

/**
 * Which day an entry goes to. Between 8 and 11 AM both yesterday's closing and today are open.
 * With `earliest` (owner, udhari only) an earlier day can also be picked, e.g. to catch up the days
 * after the old balances were imported.
 */
export function DayChoice({
  dates,
  value,
  onChange,
  earliest,
}: {
  dates: { today: string; yesterday: string | null };
  value: string;
  onChange: (d: string) => void;
  earliest?: string | null;
}) {
  const canEarlier = !!earliest && earliest < dates.today;
  const [picking, setPicking] = useState(false);
  if (!dates.yesterday && !canEarlier) return null;
  const other = picking || (!!value && value !== dates.today && value !== dates.yesterday);
  return (
    <span className="flex flex-wrap gap-1">
      <select
        className={`inp w-40 ${value || other ? "" : "border-orange-500"}`}
        value={other ? "OTHER" : value}
        onChange={(e) => {
          const v = e.target.value;
          setPicking(v === "OTHER");
          onChange(v === "OTHER" ? "" : v);
        }}
        required
      >
        {dates.yesterday && <option value="">Which day?</option>}
        {dates.yesterday && <option value={dates.yesterday}>{niceDate(dates.yesterday)} (closing)</option>}
        <option value={dates.today}>{niceDate(dates.today)} (today)</option>
        {canEarlier && <option value="OTHER">Earlier day…</option>}
      </select>
      {other && (
        <input
          type="date"
          className={`inp w-40 ${value ? "" : "border-orange-500"}`}
          min={earliest ?? undefined}
          max={dates.today}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title={`From ${niceDate(earliest!)} to today`}
          required
        />
      )}
    </span>
  );
}
