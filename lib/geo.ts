// Small, dependency-free geometry helpers shared by the API routes and the map views.

export type Position = [number, number]; // [lon, lat]
export type Ring = Position[];
export type PolygonCoords = Ring[];
export type Geometry =
  | { type: "Polygon"; coordinates: PolygonCoords }
  | { type: "MultiPolygon"; coordinates: PolygonCoords[] };
export type BBox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

export interface RegionFeature {
  type: "Feature";
  id: string;
  properties: { id: string; name: string; iso?: string };
  geometry: Geometry;
}
export interface RegionCollection {
  type: "FeatureCollection";
  features: RegionFeature[];
  meta?: { iso: string; level: string; canonical?: string; source: string; license?: string; year?: string };
}

export const polygonsOf = (g: Geometry): PolygonCoords[] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

export function ringBBox(ring: Ring): BBox {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}

export function geometryBBox(g: Geometry): BBox {
  let box: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of polygonsOf(g)) box = unionBBox(box, ringBBox(poly[0]));
  return box;
}

export const unionBBox = (a: BBox, b: BBox): BBox => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lon: number, lat: number, g: Geometry): boolean {
  for (const poly of polygonsOf(g)) {
    if (!inRing(lon, lat, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(lon, lat, poly[h])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

function ringArea(ring: Ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
}

/** A point guaranteed to sit inside the largest polygon (centroid when it is inside, otherwise a scanline midpoint). */
export function representativePoint(g: Geometry): Position {
  const polys = polygonsOf(g);
  let best = polys[0], bestArea = -1;
  for (const p of polys) { const a = ringArea(p[0]); if (a > bestArea) { bestArea = a; best = p; } }
  const ring = best[0];
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  cx /= ring.length; cy /= ring.length;
  const single: Geometry = { type: "Polygon", coordinates: best };
  if (pointInGeometry(cx, cy, single)) return [cx, cy];
  // Scan the horizontal line through the centroid latitude and take the midpoint of the widest inside span.
  const [minX, minY, maxX, maxY] = ringBBox(ring);
  for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = minY + (maxY - minY) * fy;
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    let widest = 0, mid: number | null = null;
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > widest) { widest = xs[k + 1] - xs[k]; mid = (xs[k] + xs[k + 1]) / 2; }
    if (mid !== null && pointInGeometry(mid, y, single)) return [mid, y];
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Radial-distance simplification plus coordinate rounding. Keeps rings closed and at least 4 points long. */
export function simplifyGeometry(g: Geometry, tolerance: number, decimals = 3): Geometry | null {
  const f = 10 ** decimals;
  const round = (v: number) => Math.round(v * f) / f;
  const simplifyRing = (ring: Ring): Ring | null => {
    const out: Ring = [];
    let last: Position | null = null;
    for (const [x, y] of ring) {
      if (!last || Math.abs(x - last[0]) >= tolerance || Math.abs(y - last[1]) >= tolerance) {
        const p: Position = [round(x), round(y)];
        out.push(p);
        last = p;
      }
    }
    const first = out[0], end = out[out.length - 1];
    if (first && end && (first[0] !== end[0] || first[1] !== end[1])) out.push([first[0], first[1]]);
    return out.length >= 4 ? out : null;
  };
  const polys: PolygonCoords[] = [];
  for (const poly of polygonsOf(g)) {
    const outer = simplifyRing(poly[0]);
    if (!outer) continue;
    const holes = poly.slice(1).map(simplifyRing).filter((r): r is Ring => !!r);
    polys.push([outer, ...holes]);
  }
  if (!polys.length) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/* i18n */export const compass = (deg: number) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(deg / 45) % 8];/* /i18n */

export const isFiniteCoord = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
