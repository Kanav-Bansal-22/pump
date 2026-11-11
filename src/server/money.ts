import Decimal from "decimal.js";

/** Exact decimal arithmetic for money and litres. Never use JS number for these. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Parses a typed rupee amount ("1,80,000" or "550.5"). Throws on anything else. Result > 0. */
export function parseAmount(raw: string): string {
  const s = String(raw).replace(/[,\s₹]/g, "");
  if (!AMOUNT_RE.test(s)) throw new Error("INVALID_AMOUNT");
  const d = new D(s);
  if (d.lte(0)) throw new Error("INVALID_AMOUNT");
  return d.toFixed(2);
}

/** Rounds to paise, half-up (rule L18). */
export function round2(x: Dec | string): string {
  return new D(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Indian digit grouping: 1380181 -> "13,80,181.00". */
export function formatINR(value: string | Dec, withSymbol = true): string {
  const d = new D(value);
  const neg = d.isNeg();
  const [int, frac] = d.abs().toFixed(2).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}${withSymbol ? "₹" : ""}${grouped}.${frac}`;
}
