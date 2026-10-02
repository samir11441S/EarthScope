import { geometryBBox, pointInGeometry, representativePoint, simplifyGeometry, type Geometry, type RegionCollection, type RegionFeature } from "@/lib/geo";

// State / province (ADM1) and district (ADM2) boundaries from geoBoundaries, simplified for the web.
interface GbMeta { boundaryName: string; boundaryCanonical?: string; boundaryYearRepresented?: string; boundaryLicense?: string; simplifiedGeometryGeoJSON: string }
interface GbFeature { properties: { shapeName?: string; shapeID?: string; shapeISO?: string }; geometry: Geometry | null }

async function load(iso: string, level: string) {
  for (const release of ["gbOpen", "gbHumanitarian", "gbAuthoritative"]) {
    const metaRes = await fetch(`https://www.geoboundaries.org/api/current/${release}/${iso}/${level}/`, { signal: AbortSignal.timeout(15000) });
    if (!metaRes.ok) continue;
    const text = await metaRes.text();
    if (!text.trim().startsWith("{")) continue;
    const meta = JSON.parse(text) as GbMeta;
    const geoRes = await fetch(meta.simplifiedGeometryGeoJSON, { signal: AbortSignal.timeout(30000) });
    if (!geoRes.ok) continue;
    const geo = (await geoRes.json()) as { features: GbFeature[] };
    return { meta, release, features: geo.features.filter(f => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) };
  }
  return null;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const iso = (q.get("iso") || "").toUpperCase(), level = (q.get("level") || "ADM1").toUpperCase(), parent = q.get("parent");
  if (!/^[A-Z]{3}$/.test(iso) || !/^ADM[12]$/.test(level) || (parent !== null && !/^[\w-]{1,80}$/.test(parent)))
    return Response.json({ error: "Use a 3-letter country code and level ADM1 or ADM2." }, { status: 400 });
  try {
    const data = await load(iso, level);
    if (!data) return Response.json({ error: `No ${level === "ADM1" ? "state / province" : "district"} boundaries are published for ${iso}.` }, { status: 404 });
    let features = data.features;
    let parentName: string | undefined;
    if (parent) {
      const adm1 = await load(iso, "ADM1");
      const p = adm1?.features.find(f => f.properties.shapeID === parent);
      if (!p?.geometry) return Response.json({ error: "Parent region not found." }, { status: 404 });
      parentName = p.properties.shapeName;
      const pg = p.geometry;
      features = features.filter(f => { const [x, y] = representativePoint(f.geometry!); return pointInGeometry(x, y, pg); });
      if (!features.length) return Response.json({ error: "No districts were found inside this region." }, { status: 404 });
    }
    // Pick a simplification tolerance from the extent so large countries stay light.
    let span = 0;
    for (const f of features) { const b = geometryBBox(f.geometry!); span = Math.max(span, b[2] - b[0], b[3] - b[1]); }
    const tolerance = Math.max(0.003, Math.min(0.08, span / 900));
    const out: RegionFeature[] = [];
    features.forEach((f, i) => {
      const geometry = simplifyGeometry(f.geometry!, tolerance, span > 20 ? 2 : 3);
      if (!geometry) return;
      const id = f.properties.shapeID || `${iso}-${level}-${i}`;
      out.push({ type: "Feature", id, properties: { id, name: f.properties.shapeName || `Region ${i + 1}`, iso: f.properties.shapeISO || undefined }, geometry });
    });
    const body: RegionCollection & { parentName?: string } = {
      type: "FeatureCollection", features: out, parentName,
      meta: { iso, level, canonical: data.meta.boundaryCanonical || undefined, source: `geoBoundaries (${data.release})`, license: data.meta.boundaryLicense, year: data.meta.boundaryYearRepresented },
    };
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=2592000" } });
  } catch {
    return Response.json({ error: "Boundary service is unavailable right now." }, { status: 502 });
  }
}
