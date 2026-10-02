// Share links that reopen a report view: ?report=<base64url JSON>. The place is rounded to
// 2 decimals (~1 km) so a shared link never pinpoints someone's exact location.
import type { Place } from "../climate";
import type { Audience, Lang } from "./model";

export interface SharedReport { place: Place; year: number; warming: number; rainChange: number; lang: Lang; audience: Audience }

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function shareUrl(origin: string, r: SharedReport) {
  const lat = +r.place.lat.toFixed(2), lon = +r.place.lon.toFixed(2);
  const payload = { p: [lat, lon, r.place.name.slice(0, 80), r.place.country.slice(0, 80)], y: r.year, w: r.warming, r: r.rainChange, l: r.lang, a: r.audience };
  return `${origin}/?report=${b64url(JSON.stringify(payload))}`;
}

export function parseShare(param: string | null): SharedReport | null {
  if (!param || param.length > 600) return null;
  try {
    const j = JSON.parse(unb64url(param)) as { p?: unknown[]; y?: number; w?: number; r?: number; l?: string; a?: string };
    const [lat, lon, name, country] = j.p ?? [];
    if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const clean = (v: unknown) => String(v ?? "").replace(/[<>]/g, "").slice(0, 80);
    return {
      place: { id: `share-${lat.toFixed(2)}-${lon.toFixed(2)}`, name: clean(name) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, country: clean(country), lat, lon },
      year: Number.isFinite(j.y) ? Math.round(Math.min(2050, Math.max(1981, j.y!))) : 2025,
      warming: Number.isFinite(j.w) ? Math.min(4, Math.max(0, j.w!)) : 1.5,
      rainChange: Number.isFinite(j.r) ? Math.min(40, Math.max(-40, j.r!)) : -10,
      lang: j.l === "bn" ? "bn" : "en",
      audience: j.a === "student" || j.a === "planner" ? j.a : "citizen",
    };
  } catch {
    return null;
  }
}
