// Finding the user's location robustly (client-side).
//
// Browsers fail to locate for very different reasons — permission denied, OS location services off,
// no GPS on a laptop (timeout), insecure page, or an embedding iframe that is not allowed to ask.
// We try a fast network-based fix first, then refine with GPS, and report the real reason so the UI
// can offer the right fix (or fall back to approximate IP-based location, or a typed place name).

export interface Located { lat: number; lon: number; accuracyM: number | null; source: "gps" | "network" | "ip"; label: string }

export type LocateFailure = "unsupported" | "insecure" | "blocked-frame" | "denied" | "unavailable" | "timeout";

export class LocateError extends Error {
  constructor(public reason: LocateFailure) { super(reason); }
}

export const LOCATE_HELP: Record<LocateFailure, { title: string; fix: string }> = {
  unsupported: { title: "This browser can't share its location.", fix: "Use approximate location, search for your area, or pick a spot on the map." },
  insecure: { title: "Location only works on a secure (https) page.", fix: "Open EarthScope over https, or use approximate location / search instead." },
  "blocked-frame": { title: "This page is embedded in another site that doesn't allow location.", fix: "Open EarthScope in its own tab, or use approximate location / search instead." },
  denied: { title: "Location permission is blocked for this site.", fix: "Click the lock or tune icon left of the address bar → Site settings → Location → Allow, then try again. Or use approximate location / search." },
  unavailable: { title: "Your device couldn't determine its location.", fix: "Turn on location services (Windows: Settings → Privacy & security → Location; phones: Location in quick settings) and try again, or use approximate location / search." },
  timeout: { title: "Finding your location took too long.", fix: "Try again near a window or with Wi-Fi on, or use approximate location / search." },
};

function once(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

const reasonOf = (e: unknown): LocateFailure => {
  const code = (e as GeolocationPositionError | undefined)?.code;
  return code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable";
};

/** Current permission state, when the browser can tell us without prompting. */
export async function permissionState(): Promise<PermissionState | "unknown"> {
  try { return (await navigator.permissions.query({ name: "geolocation" as PermissionName })).state; } catch { return "unknown"; }
}

/**
 * Browser location. Attempt 1: network/Wi-Fi fix (fast, works on laptops without GPS, accepts a
 * fix up to 5 minutes old). Attempt 2 (only if 1 timed out or was unavailable): GPS with a longer wait.
 */
export async function locateWithBrowser(): Promise<Located> {
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new LocateError("unsupported");
  if (!window.isSecureContext) throw new LocateError("insecure");
  const toLocated = (p: GeolocationPosition): Located => ({
    lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
    source: p.coords.accuracy <= 100 ? "gps" : "network", label: "Your location",
  });
  try {
    return toLocated(await once({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }));
  } catch (first) {
    const r = reasonOf(first);
    if (r === "denied") {
      // A cross-origin iframe without allow="geolocation" reports "denied" without ever prompting.
      const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
      throw new LocateError(framed ? "blocked-frame" : "denied");
    }
    try {
      return toLocated(await once({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }));
    } catch (second) {
      const r2 = reasonOf(second);
      // "unavailable" from either attempt means the device has no location source (services off),
      // which is more useful to report than the GPS retry's timeout.
      throw new LocateError(r2 === "denied" ? "denied" : r === "unavailable" || r2 === "unavailable" ? "unavailable" : "timeout");
    }
  }
}

/** Approximate (city-level) location from the network connection, via EarthScope's own API. */
export async function locateApproximately(): Promise<Located> {
  const r = await fetch("/api/locate", { cache: "no-store" });
  const j = (await r.json()) as { lat?: number; lon?: number; city?: string; country?: string; error?: string };
  if (!r.ok || !Number.isFinite(j.lat) || !Number.isFinite(j.lon)) throw new Error(j.error || "Approximate location is unavailable.");
  const where = [j.city, j.country].filter(Boolean).join(", ");
  return { lat: j.lat!, lon: j.lon!, accuracyM: 25_000, source: "ip", label: where ? `Approximately ${where}` : "Approximate location" };
}
