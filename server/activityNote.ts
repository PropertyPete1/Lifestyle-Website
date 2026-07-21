/**
 * Builds the "Site activity before inquiry" note that gets attached to a
 * Follow Up Boss contact when a visitor with tracked on-site activity submits
 * any lead form.
 *
 * Privacy model: activity rows are anonymous (random first-party visitor id,
 * no personal info). They are only compiled and sent to FUB at the moment the
 * visitor voluntarily identifies themselves via a form. Visitors who never
 * submit a form never have anything forwarded.
 */
import type { VisitorActivity } from "../drizzle/schema";

type Parsed = { kind: string; data: Record<string, unknown>; at: Date };

function parseRows(rows: VisitorActivity[]): Parsed[] {
  const out: Parsed[] = [];
  for (const r of rows) {
    try {
      out.push({ kind: r.kind, data: JSON.parse(r.data) as Record<string, unknown>, at: r.createdAt });
    } catch {
      /* skip malformed rows */
    }
  }
  return out;
}

function fmtPrice(n: unknown): string {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return "";
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M` : `$${Math.round(v / 1000)}K`;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Compile activity rows into a clearly formatted FUB note body.
 * Returns null when there is nothing meaningful to report.
 */
export function buildActivityNote(rows: VisitorActivity[]): string | null {
  if (!rows.length) return null;
  const events = parseRows(rows);

  // Net favorites: favorited minus later unfavorited (keyed by slug/address)
  const favMap = new Map<string, Record<string, unknown>>();
  for (const e of events) {
    const key = str(e.data.slug) || str(e.data.address);
    if (!key) continue;
    if (e.kind === "favorite") favMap.set(key, e.data);
    else if (e.kind === "unfavorite") favMap.delete(key);
  }

  const searches = events.filter((e) => e.kind === "ai_search");
  const quizzes = events.filter((e) => e.kind === "convince_quiz");
  const cityFinder = events.filter((e) => e.kind === "city_finder");

  const lines: string[] = [];

  if (favMap.size) {
    const favs = Array.from(favMap.values()).slice(0, 10);
    const byCity = new Map<string, string[]>();
    for (const f of favs) {
      const city = str(f.city) || "TX";
      const bits = [str(f.address), fmtPrice(f.price)].filter(Boolean).join(" — ");
      (byCity.get(city) ?? byCity.set(city, []).get(city)!).push(bits);
    }
    const parts = Array.from(byCity.entries()).map(
      ([city, items]) => `${items.length} in ${city} (${items.join("; ")})`
    );
    lines.push(`• Favorited ${favs.length} listing${favs.length === 1 ? "" : "s"}: ${parts.join("; ")}`);
  }

  if (searches.length) {
    const shown = searches.slice(-5); // most recent 5
    const qs = shown.map((s) => {
      const q = str(s.data.query);
      const crit = str(s.data.criteria);
      return crit ? `"${q}" (${crit})` : `"${q}"`;
    });
    lines.push(`• Ran ${searches.length} AI home search${searches.length === 1 ? "" : "es"}: ${qs.join("; ")}`);
  }

  for (const q of quizzes.slice(-2)) {
    const picks = Array.isArray(q.data.selections) ? (q.data.selections as unknown[]).map(String).join(", ") : "";
    const city = str(q.data.city);
    const partner = str(q.data.partnerName);
    lines.push(
      `• Completed Convince Your Partner quiz${partner ? ` (for ${partner})` : ""}${picks ? ` — picks: ${picks}` : ""}${city ? ` — matched to ${city}` : ""}`
    );
  }

  for (const c of cityFinder.slice(-2)) {
    const city = str(c.data.city);
    const runner = str(c.data.runnerUp);
    if (city) lines.push(`• City Finder quiz matched them to ${city}${runner ? ` (runner-up: ${runner})` : ""}`);
  }

  if (!lines.length) return null;

  const first = events[0]?.at;
  const span =
    first && Date.now() - first.getTime() > 36 * 3600 * 1000
      ? ` (activity since ${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
      : "";

  return `Site activity before inquiry${span}:\n${lines.join("\n")}`;
}
