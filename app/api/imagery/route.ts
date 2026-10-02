// Satellite snapshots from NASA GIBS (WMS), square in kilometres around a point.
//   layer=truecolor  MODIS Terra true colour, 250 m, daily since 2000
//   layer=ndvi       MODIS Terra NDVI 8-day
//   layer=landsat    Landsat WELD annual true-colour composite, 30 m (1985, 1990, 2000 epochs)
//   layer=hls        Harmonized Landsat + Sentinel-2, 30 m, since 2013 (sensor=S30 | L30)
//   layer=landcover  MODIS MCD12Q1 IGBP land cover, 500 m, yearly 2001-2024 (date=YYYY-01-01)
//   layer=ndvi16     MODIS MOD13Q1 NDVI, 250 m, 16-day composites
//   layer=false721   MODIS Terra bands 7-2-1 false colour, 250 m, daily
const LAYERS = {
  truecolor: { name: "MODIS_Terra_CorrectedReflectance_TrueColor", format: "image/jpeg", span: 2.2 },
  ndvi: { name: "MODIS_Terra_NDVI_8Day", format: "image/png", span: 2.2 },
  landsat: { name: "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual", format: "image/jpeg", span: 0.4 },
  hls_S30: { name: "HLS_S30_Nadir_BRDF_Adjusted_Reflectance", format: "image/jpeg", span: 0.4 },
  hls_L30: { name: "HLS_L30_Nadir_BRDF_Adjusted_Reflectance", format: "image/jpeg", span: 0.4 },
  // Measured products used by the change analysis (PNG keeps their colour maps exact for decoding).
  landcover: { name: "MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual", format: "image/png", span: 0.4 }, // MCD12Q1, yearly (TIME=YYYY-01-01)
  ndvi16: { name: "MODIS_Terra_L3_NDVI_16Day", format: "image/png", span: 0.4 }, // MOD13Q1, 16-day composites
  false721: { name: "MODIS_Terra_CorrectedReflectance_Bands721", format: "image/jpeg", span: 0.8 }, // water dark blue, cities magenta
} as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, latText = params.get("lat"), lonText = params.get("lon");
  const lat = Number(latText), lon = Number(lonText), date = params.get("date") || "2025-01-20";
  const layerType = (params.get("layer") || "truecolor").toLowerCase();
  const sensor = params.get("sensor") === "L30" ? "L30" : "S30";
  const key = (layerType === "hls" ? `hls_${sensor}` : layerType) as keyof typeof LAYERS;
  const layer = LAYERS[key];
  const size = Math.round(Math.min(2048, Math.max(64, Number(params.get("size")) || 1024)));
  const spanParam = params.get("span");
  const span = spanParam === null ? null : Math.min(3, Math.max(0.05, Number(spanParam) || 0.4));

  if (!layer || !latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89 || Math.abs(lon) > 180 || !/^(19|20)\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || date > new Date().toISOString().slice(0, 10))
    return new Response("Invalid imagery layer, coordinates or date.", { status: 400 });

  let bbox: string;
  const isDhakaDefault = span === null && (key === "truecolor" || key === "ndvi") && Math.abs(lat - 23.8103) < 0.001 && Math.abs(lon - 90.4125) < 0.001;
  if (isDhakaDefault) bbox = "89.2,22.6,91.4,24.8";
  else {
    // Square in kilometres: widen longitude by 1/cos(latitude).
    const halfLat = (span ?? layer.span) / 2, halfLon = halfLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    bbox = `${Math.max(-180, lon - halfLon)},${Math.max(-90, lat - halfLat)},${Math.min(180, lon + halfLon)},${Math.min(90, lat + halfLat)}`;
  }
  const url = new URL("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi");
  url.search = new URLSearchParams({ SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: layer.name, STYLES: "", FORMAT: layer.format, SRS: "EPSG:4326", BBOX: bbox, WIDTH: String(size), HEIGHT: String(size), TIME: date }).toString();
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const contentType = result.headers.get("Content-Type") || "";
    if (!result.ok || !contentType.includes("image")) throw new Error();
    return new Response(result.body, { headers: { "Content-Type": contentType.includes("png") ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=2592000" } });
  } catch {
    return new Response("Satellite image unavailable. Try another date.", { status: 502 });
  }
}
