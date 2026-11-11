"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border border-line px-3 py-2 print:hidden">
      🖨 Print / PDF
    </button>
  );
}
