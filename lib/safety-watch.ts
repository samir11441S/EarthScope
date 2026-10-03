// Client-side safety watch: saved places, change-based alerts and an offline safety pack.
// Everything stays in this browser (localStorage); nothing about the user's places leaves the device
// except the coordinates sent to EarthScope's own APIs to check them.
import { assessSafety, HAZARD_META, type Hazard } from "./hazards";
import { HEAT_META, type HeatDay } from "./heat";
import { makeI18n } from "./i18n";

type T = ReturnType<typeof makeI18n>["t"];
const EN: T = makeI18n("en").t;

export interface SavedPlace { id: string; name: string; lat: number; lon: number }
export interface PlaceStatus {
  place: SavedPlace;
  level: "danger" | "caution" | "clear";
  messages: string[]; // human-readable reasons, most serious first
  keys: string[]; // stable identifiers used to detect *new* alerts
}
export interface SafetyPack {
  savedAt: string;
  label: string; lat: number; lon: number;
  status: string;
  threats: string[];
  heat?: string;
  shelters: { name: string; kind: string; distanceKm: number }[];
  guidance: string[];
}

const PLACES_KEY = "terra-saved-places", SEEN_KEY = "terra-alerts-seen", PACK_KEY = "terra-safety-pack", ALERTS_KEY = "terra-alerts-on";
const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const loadSavedPlaces = () => read<SavedPlace[]>(PLACES_KEY, []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice(0, 6);
export const storeSavedPlaces = (p: SavedPlace[]) => write(PLACES_KEY, p.slice(0, 6));
export const alertsEnabled = () => read<boolean>(ALERTS_KEY, false) && typeof Notification !== "undefined" && Notification.permission === "granted";
export const setAlertsEnabled = (on: boolean) => write(ALERTS_KEY, on);
export const loadPack = () => read<SafetyPack | null>(PACK_KEY, null);
export const storePack = (p: SafetyPack) => write(PACK_KEY, p);

const timeFrom = (iso: string, t: T) => { const h = Math.round((Date.parse(iso) - Date.now()) / 3_600_000); return h < 1 ? t("within the hour") : h < 48 ? t("in ~{h} h", { h }) : t("in ~{d} days", { d: Math.round(h / 24) }); };

/** Status of one saved place against current hazards and its heat outlook (worst of the next 3 days). */
export function placeStatus(place: SavedPlace, hazards: Hazard[], heat?: HeatDay[], t: T = EN): PlaceStatus {
  const a = assessSafety(place.lat, place.lon, hazards);
  const messages: string[] = [], keys: string[] = [];
  for (const th of a.threats.slice(0, 3)) {
    const name = `${th.hazard.title} (${t(HAZARD_META[th.hazard.type].label).toLowerCase()})`;
    if (th.inside) { messages.push(t("Inside the zone of {name}.", { name })); keys.push(`in:${th.hazard.id}`); }
    else if (th.upcoming) { messages.push(t("{name} is forecast to pass {when}.", { name, when: timeFrom(th.upcoming.eta, t) })); keys.push(`fc:${th.hazard.id}`); }
    else { messages.push(t("{name} is {km} km away.", { name, km: Math.round(th.distanceKm) })); keys.push(`near:${th.hazard.id}`); }
  }
  let level = a.level;
  const worst = heat?.slice(0, 3).reduce((x, y) => (y.heatIndexMax > x.heatIndexMax ? y : x), heat[0]);
  if (worst && HEAT_META[worst.level].rank >= 3) {
    messages.push(t("Dangerous heat forecast: heat index up to {v} °C ({level}).", { v: Math.round(worst.heatIndexMax), level: t(HEAT_META[worst.level].label).toLowerCase() }));
    keys.push(`heat:${worst.date}:${worst.level}`);
    if (level === "clear") level = "caution";
  }
  return { place, level, messages, keys };
}

/** Alerts that are new since the last check (per place), and remembers them so each fires once. */
export function newAlerts(statuses: PlaceStatus[]): { place: SavedPlace; message: string }[] {
  const seen = read<Record<string, string[]>>(SEEN_KEY, {});
  const out: { place: SavedPlace; message: string }[] = [];
  const next: Record<string, string[]> = {};
  for (const s of statuses) {
    const before = new Set(seen[s.place.id] ?? []);
    s.keys.forEach((k, i) => {
      // "near" alone is informational; alert on being inside, in a forecast path, or dangerous heat.
      if (!before.has(k) && !k.startsWith("near:")) out.push({ place: s.place, message: s.messages[i] });
    });
    next[s.place.id] = s.keys;
  }
  write(SEEN_KEY, next);
  return out;
}

/** Shows a system notification through the service worker when available (works in a background tab). */
export async function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: `terra-${title}` }); return true; }
  } catch { /* fall back below */ }
  try { new Notification(title, { body, icon: "/icons/icon-192.png" }); return true; } catch { return false; }
}

/** Plain-text version of the pack, for sharing by SMS / messaging apps. */
export function packText(p: SafetyPack, t: T = EN, locale?: string) {
  return [
    `${t("EarthScope safety pack")} — ${p.label} (${p.lat.toFixed(3)}, ${p.lon.toFixed(3)})`,
    t("Saved {time}.", { time: new Date(p.savedAt).toLocaleString(locale) }),
    `${t("Status:")} ${p.status}`,
    ...p.threats.map(t => `• ${t}`),
    p.heat ? `${t("Heat:")} ${p.heat}` : "",
    p.shelters.length ? t("Nearest safer places:") : "",
    ...p.shelters.map(s => `• ${s.name} — ${t(s.kind)}, ${s.distanceKm.toFixed(1)} km`),
    t("What to do:"),
    ...p.guidance.map(g => `• ${g}`),
    t("Emergency: 999 (Bangladesh) · disaster helpline 1090 · 112 (India/EU) · 911 (USA)"),
  ].filter(Boolean).join("\n");
}
