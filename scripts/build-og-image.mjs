// Builds public/og.png (1200×630), the link preview for social media and chat apps, from the globe's
// own NASA textures: a night-side planet limb with real city lights and clouds under a navy sky.
//   node scripts/build-og-image.mjs
import sharp from "sharp";

const W = 1200, H = 630, R = 900; // planet radius; centre below and right of the frame
const cx = 980, cy = 1080;

// Planet disc: Blue Marble day side blended with Black Marble lights and the cloud mask, cropped over South Asia.
const crop = { left: 2800, top: 450, width: 1100, height: 600 }; // 4096×2048 equirectangular: 66°E–163°E, 50°N–3°N
const day = await sharp("public/textures/earth-day.jpg").extract(crop).resize(R * 2, R * 2, { fit: "fill" }).modulate({ brightness: 0.75, saturation: 1.15 }).toBuffer();
const lights = await sharp("public/textures/earth-night.jpg").extract(crop).resize(R * 2, R * 2, { fit: "fill" }).toBuffer();
const clouds = await sharp("public/textures/earth-clouds.jpg").extract({ left: crop.left / 2, top: crop.top / 2, width: crop.width / 2, height: crop.height / 2 }).resize(R * 2, R * 2, { fit: "fill" }).toBuffer();
const disc = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${R * 2}" height="${R * 2}"><circle cx="${R}" cy="${R}" r="${R}" fill="#fff"/></svg>`);
const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${R * 2}" height="${R * 2}">
  <defs><radialGradient id="g" cx="0.62" cy="0.7" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#020a1f" stop-opacity="0.85"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/></svg>`);
const planet = await sharp(day)
  .composite([{ input: lights, blend: "screen" }, { input: await sharp(clouds).linear(0.55, 0).toBuffer(), blend: "screen" }, { input: shade }, { input: disc, blend: "dest-in" }])
  .png().toBuffer()
  .then(b => sharp(b).extract({ left: 0, top: 0, width: W - (cx - R), height: H - (cy - R) }).toBuffer()); // only the part inside the frame

const stars = Array.from({ length: 140 }, (_, i) => {
  const x = (i * 7919) % W, y = (i * 104729) % 420, r = ((i * 31) % 10) / 10 + 0.3;
  return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#cfe3ff" opacity="${(0.25 + ((i * 13) % 10) / 16).toFixed(2)}"/>`;
}).join("");

const sky = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#030817"/><stop offset="1" stop-color="#071a3d"/></linearGradient>
    <radialGradient id="glow" cx="${cx}" cy="${cy}" r="${R + 90}" gradientUnits="userSpaceOnUse"><stop offset="${(R - 8) / (R + 90)}" stop-color="#3aa0ff" stop-opacity="0.9"/><stop offset="${(R + 6) / (R + 90)}" stop-color="#2f8cff" stop-opacity="0.45"/><stop offset="1" stop-color="#2f8cff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>${stars}
  <circle cx="${cx}" cy="${cy}" r="${R + 90}" fill="url(#glow)"/>
</svg>`);

const font = "Segoe UI, Inter, Arial, sans-serif";
const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g font-family="${font}">
    <text x="72" y="118" fill="#5cc2ff" font-size="22" font-weight="600" letter-spacing="4">NASA SPACE APPS 2026 · DHAKA</text>
    <text x="70" y="206" fill="#ffffff" font-size="84" font-weight="700" letter-spacing="-1">Earth<tspan fill="#38b6ff">Scope</tspan></text>
    <text x="72" y="256" fill="#cfe0f5" font-size="34" font-weight="500">Climate Time Machine</text>
    <text x="72" y="330" fill="#9db4d3" font-size="24">45 years of NASA climate data · live disasters</text>
    <text x="72" y="364" fill="#9db4d3" font-size="24">satellite change · sea level · air quality</text>
    <text x="72" y="410" fill="#9db4d3" font-size="24" font-family="Nirmala UI, Noto Sans Bengali, ${font}">English · বাংলা</text>
  </g>
  <rect x="72" y="462" width="300" height="52" rx="26" fill="#2f8cff"/>
  <text x="222" y="496" fill="#fff" font-family="${font}" font-size="21" font-weight="600" text-anchor="middle">Explore your planet →</text>
</svg>`);

await sharp(sky)
  .composite([{ input: planet, left: cx - R, top: cy - R }, { input: text }])
  .png({ compressionLevel: 9, palette: false })
  .toFile("public/og.png");
const meta = await sharp("public/og.png").metadata();
console.log(`public/og.png ${meta.width}×${meta.height}`);
