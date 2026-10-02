import type { SafePlace, SafePlaceKind } from "@/lib/hazards";

// Emergency-relevant facilities from OpenStreetMap (via Overpass) around a point. Server-only module
// shared by /api/safe-places and the Ask Earth assistant.

const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];

// Facilities change slowly; cache per ~100 m cell for an hour so repeated checks don't hit Overpass rate limits.
const cache = new Map<string, { until: number; value: Promise<SafePlace[]> }>();

interface OsmElement { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

function classify(t: Record<string, string>): SafePlaceKind | null {
  if (t.emergency === "assembly_point") return "assembly";
  if (t.amenity === "shelter" || t.social_facility === "shelter" || /cyclone|flood|emergency|evacuation/i.test(t.shelter_type ?? "") || t.building === "cyclone_shelter") {
    if (/public_transport|picnic_shelter|lean_to|field_shelter|basic_hut|weather_shelter/.test(t.shelter_type ?? "")) return null;
    return "shelter";
  }
  if (t.amenity === "hospital" || t.healthcare === "hospital") return "hospital";
  if (t.amenity === "fire_station") return "fire";
  if (t.amenity === "community_centre") return "community";
  return null;
}

const LABEL: Record<SafePlaceKind, string> = { shelter: "Emergency shelter", assembly: "Assembly point", hospital: "Hospital", fire: "Fire station", community: "Community centre" };

export const SAFE_PLACES_SOURCE = "OpenStreetMap contributors (ODbL) via Overpass API";

/** Shelters, assembly points, hospitals, fire stations and community centres within radiusKm. Throws if every mirror fails. */
export function findSafePlaces(lat: number, lon: number, radiusKm: number): Promise<SafePlace[]> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${radiusKm}`, hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = queryOverpass(lat, lon, radiusKm);
  cache.set(key, { until: Date.now() + 3_600_000, value });
  value.catch(() => cache.delete(key));
  return value;
}

async function queryOverpass(lat: number, lon: number, radiusKm: number): Promise<SafePlace[]> {
  const r = Math.round(radiusKm * 1000), at = `${r},${lat.toFixed(5)},${lon.toFixed(5)}`;
  const query = `[out:json][timeout:25];(
    nwr["amenity"="shelter"](around:${at});
    nwr["shelter_type"~"cyclone|flood|emergency|evacuation",i](around:${at});
    nwr["building"="cyclone_shelter"](around:${at});
    nwr["social_facility"="shelter"](around:${at});
    nwr["emergency"="assembly_point"](around:${at});
    nwr["amenity"="hospital"](around:${at});
    nwr["amenity"="fire_station"](around:${at});
    nwr["amenity"="community_centre"](around:${at});
  );out center tags 400;`;
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "earthscope-climate-time-machine/1.0 (NASA Space Apps Challenge)" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(28000),
      });
      if (!res.ok || !(res.headers.get("Content-Type") || "").includes("json")) continue;
      const data = (await res.json()) as { elements: OsmElement[] };
      const seen = new Set<string>();
      const places: SafePlace[] = [];
      for (const e of data.elements) {
        const kind = classify(e.tags ?? {});
        const plat = e.lat ?? e.center?.lat, plon = e.lon ?? e.center?.lon;
        if (!kind || plat === undefined || plon === undefined) continue;
        const name = e.tags?.name || e.tags?.["name:en"] || LABEL[kind];
        const key = `${kind}:${name}:${plat.toFixed(3)}:${plon.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        places.push({ id: `${e.type}/${e.id}`, name, kind, lat: plat, lon: plon });
      }
      return places;
    } catch {
      // try next mirror
    }
  }
  throw new Error("Emergency facility search is unavailable right now.");
}
