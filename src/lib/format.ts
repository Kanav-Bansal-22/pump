/** Display helpers usable on server and client. Inputs are exact decimal strings from the server. */

export function inr(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const neg = value.startsWith("-");
  const [i, f = "00"] = value.replace("-", "").split(".");
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${neg ? "-" : ""}₹${grouped}.${(f + "00").slice(0, 2)}`;
}

/** Indian grouping for meter readings / litres without the rupee sign: 8496290.94 -> 84,96,290.94 */
export function num(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return inr(value).replace("₹", "");
}

export function niceDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function niceTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
