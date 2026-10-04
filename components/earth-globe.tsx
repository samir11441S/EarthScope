"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LocateFixed, Minus, Plus, RotateCcw, Activity, Thermometer, Snowflake, Wind, ChevronDown, ChevronUp } from "lucide-react";
import { PLACES, type Layer, type Place } from "@/lib/climate";
import { useI18n } from "@/lib/i18n";
import { cloudDate } from "@/lib/clouds";
import { getNasaGlobalData, globalWarmingRate, observedRate, SEA_ICE_REFERENCE, type NasaGlobalRecord } from "@/lib/nasa-global-data";

/**
 * Arctic sea ice for a year: NSIDC September extent (million km²) → the cosine of the colatitude of an
 * ocean-only polar cap with that area. The Arctic north of ~70°N is about 62% ocean, so the ice edge sits
 * where 62% of the cap area equals the extent (Earth's half-surface is 255 M km²).
 */
const seaIceCos = (extent: number) => 1 - Math.max(0, extent) / (255 * 0.62);

/** Arctic amplification as a ratio of observed warming RATES over the whole record (not of one year's anomalies). */
const ARCTIC_RATE = observedRate("arcticTempAnomaly"), GLOBAL_RATE = globalWarmingRate();
const AMPLIFICATION = ARCTIC_RATE.perDecade / GLOBAL_RATE.perDecade;

function position(lat: number, lon: number, radius = 1) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function drawClimateTexture(
  ctx: CanvasRenderingContext2D,
  record: NasaGlobalRecord,
  layer: Layer
) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const img = ctx.createImageData(width, height);
  const data = img.data;

  for (let y = 0; y < height; y++) {
    const lat = 90 - (y / (height - 1)) * 180;

    // Monotonic cubic latitudinal temperature anomaly interpolation
    let anomaly = 0;
    if (lat >= 64) {
      const t = (lat - 64) / 26;
      anomaly = record.northMidTempAnomaly + (record.arcticTempAnomaly - record.northMidTempAnomaly) * t;
    } else if (lat >= 44) {
      const t = (lat - 44) / 20;
      anomaly = record.northSubTempAnomaly + (record.northMidTempAnomaly - record.northSubTempAnomaly) * t;
    } else if (lat >= 24) {
      const t = (lat - 24) / 20;
      anomaly = record.equTo24NTempAnomaly + (record.northSubTempAnomaly - record.equTo24NTempAnomaly) * t;
    } else if (lat >= 0) {
      const t = lat / 24;
      const eq = (record.equTo24NTempAnomaly + record.equTo24STempAnomaly) / 2;
      anomaly = eq + (record.equTo24NTempAnomaly - eq) * t;
    } else if (lat >= -24) {
      const t = (lat + 24) / 24;
      anomaly = record.southSubTempAnomaly + (record.equTo24STempAnomaly - record.southSubTempAnomaly) * t;
    } else if (lat >= -44) {
      const t = (lat + 44) / 20;
      anomaly = record.southMidTempAnomaly + (record.southSubTempAnomaly - record.southMidTempAnomaly) * t;
    } else if (lat >= -64) {
      const t = (lat + 64) / 20;
      anomaly = record.antarcticTempAnomaly + (record.southMidTempAnomaly - record.antarcticTempAnomaly) * t;
    } else {
      anomaly = record.antarcticTempAnomaly;
    }

    for (let x = 0; x < width; x++) {
      const lon = (x / width) * 360 - 180;
      const idx = (y * width + x) * 4;

      if (layer === "Temperature") {
        // Continental & Arctic thermal amplification
        let localAnomaly = anomaly;
        if (lat > 45 && lat < 76 && lon > 35 && lon < 145) {
          localAnomaly *= 1.25; // Siberian heat amplification
        } else if (lat > 45 && lat < 75 && lon > -140 && lon < -60) {
          localAnomaly *= 1.18; // North American boreal amplification
        } else if (lat < -40 && lat > -70) {
          localAnomaly *= 0.85; // Southern ocean thermal buffer
        }

        let r = 0, g = 0, b = 0, a = 150;
        if (localAnomaly <= 0) {
          r = 40; g = 95; b = 180; a = 120;
        } else if (localAnomaly < 0.8) {
          const t = localAnomaly / 0.8;
          r = Math.round(40 + (190 - 40) * t);
          g = Math.round(95 + (195 - 95) * t);
          b = Math.round(180 + (50 - 180) * t);
          a = Math.round(120 + 35 * t);
        } else if (localAnomaly < 1.8) {
          const t = (localAnomaly - 0.8) / 1.0;
          r = Math.round(190 + (240 - 190) * t);
          g = Math.round(195 + (110 - 195) * t);
          b = Math.round(50 + (20 - 50) * t);
          a = Math.round(155 + 30 * t);
        } else if (localAnomaly < 3.0) {
          const t = (localAnomaly - 1.8) / 1.2;
          r = Math.round(240 + (220 - 240) * t);
          g = Math.round(110 + (25 - 110) * t);
          b = Math.round(20 + (30 - 20) * t);
          a = Math.round(185 + 35 * t);
        } else {
          const t = Math.min(1, (localAnomaly - 3.0) / 2.2);
          r = Math.round(220 + (130 - 220) * t);
          g = Math.round(25 + (0 - 25) * t);
          b = Math.round(30 + (40 - 30) * t);
          a = Math.round(220 + 25 * t);
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      } else if (layer === "Rainfall") {
        // Equatorial ITCZ vs Subtropical dry belts
        const eqBand = Math.exp(-Math.pow((lat - 6) / 12, 2));
        const subBand = Math.exp(-Math.pow((Math.abs(lat) - 28) / 10, 2));
        // Climatological pattern only (wet ITCZ, dry subtropics); no global rainfall anomaly is implied.
        const factor = 1;

        if (eqBand > 0.25) {
          data[idx] = 14;
          data[idx + 1] = 135;
          data[idx + 2] = 210;
          data[idx + 3] = Math.round(eqBand * 190 * factor);
        } else if (subBand > 0.25) {
          data[idx] = 217;
          data[idx + 1] = 130;
          data[idx + 2] = 40;
          data[idx + 3] = Math.round(subBand * 175 * factor);
        } else {
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 0;
        }
      } else if (layer === "Vegetation") {
        // Arctic / Taiga greening vs Subtropical browning
        const greenBand = Math.exp(-Math.pow((lat - 64) / 12, 2));
        const brownBand = Math.exp(-Math.pow((Math.abs(lat) - 22) / 8, 2));
        const greenFactor = Math.min(1.5, Math.max(0.6, record.arcticTempAnomaly / 2.5));

        if (greenBand > 0.2) {
          data[idx] = 34;
          data[idx + 1] = 185;
          data[idx + 2] = 74;
          data[idx + 3] = Math.round(greenBand * 190 * greenFactor);
        } else if (brownBand > 0.2) {
          data[idx] = 180;
          data[idx + 1] = 110;
          data[idx + 2] = 35;
          data[idx + 3] = Math.round(brownBand * 160);
        } else {
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 0;
        }
      } else if (layer === "Flood exposure") {
        // Coastal low-lying delta belts
        const coastalDelta = Math.exp(-Math.pow((lat - 22) / 14, 2));
        data[idx] = 6;
        data[idx + 1] = 182;
        data[idx + 2] = 212;
        data[idx + 3] = Math.round(coastalDelta * 170);
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

export default function EarthGlobe({
  place,
  layer,
  year,
  onSelect,
}: {
  place: Place;
  layer: Layer;
  year: number;
  onSelect: (p: Place) => void;
}) {
  const { t, n, y } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const [hudOpen, setHudOpen] = useState(true);
  const [failed, setFailed] = useState(false);

  const nasaData = useMemo(() => getNasaGlobalData(year), [year]);

  const api = useRef<{
    focus: (p: Place) => void;
    zoom: (n: number) => void;
    updateData: (l: Layer, y: number) => void;
  } | null>(null);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D Earth with dynamic NASA climate telemetry. Drag to rotate. Click to explore."
    );

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.copy(position(place.lat, place.lon).multiplyScalar(3.5));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 5.5;
    controls.rotateSpeed = 0.55;
    controls.enableZoom = false;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // 1. Realistic Earth: NASA Blue Marble by day, VIIRS Black Marble city lights by night,
    //    real NOAA-20 clouds, ocean sun-glint and a blue atmospheric rim (one shader).
    const loader = new THREE.TextureLoader();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const loadTex = (url: string, srgb = true) => {
      const t = loader.load(url, undefined, undefined, () => queueMicrotask(() => setFailed(true)));
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      return t;
    };
    const dayMap = loadTex("/textures/earth-day.jpg");
    const nightMap = loadTex("/textures/earth-night.jpg");
    // Real cloud cover from two days ago, rebuilt daily on the server; the bundled map is the fallback.
    const cloudMap = loader.load(`/api/clouds?date=${cloudDate()}`, undefined, undefined, () => loader.load("/textures/earth-clouds.jpg", img => { cloudMap.image = img.image; cloudMap.needsUpdate = true; }));
    cloudMap.anisotropy = maxAniso; // cloud-only mask (data, not colour)
    const textures = [dayMap, nightMap, cloudMap];
    // Clouds drift eastward around the planet; wrap seamlessly across the date line.
    dayMap.wrapS = cloudMap.wrapS = THREE.RepeatWrapping;
    const cloudShift = { value: 0 };

    // Cloud opacity for one real day, from multi-day cloud clearing of NOAA-20 / Suomi NPP imagery
    // (scripts/build-globe-textures.mts): sea ice, snow and deserts are excluded, so only clouds drift.
    const CLOUD_GLSL = `
      float cloudAlpha(sampler2D src, sampler2D base, vec2 uv) {
        return smoothstep(0.04, 0.9, texture2D(src, uv).r);
      }`;
    const SHARED_VERT = `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`;

    const sunDir = new THREE.Vector3(-0.55, 0.35, 0.76).normalize();
    const SUN_VIEW = sunDir.clone();
    const earthUniforms = {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      cloudMap: { value: cloudMap },
      sunDir: { value: sunDir },
      dim: { value: 1 },
      cloudShadow: { value: 1 },
      shift: cloudShift,
      iceCos: { value: seaIceCos(nasaData.seaIceExtent) },
    };
    const baseMaterial = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: SHARED_VERT,
      fragmentShader: `
        uniform sampler2D dayMap, nightMap, cloudMap;
        uniform vec3 sunDir;
        uniform float dim, cloudShadow, shift, iceCos;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        ${CLOUD_GLSL}
        void main() {
          vec3 N = normalize(vNormalW), V = normalize(vViewW), L = normalize(sunDir);
          vec3 day = texture2D(dayMap, vUv).rgb;
          float ndl = dot(N, L);
          float lit = smoothstep(-0.12, 0.28, ndl);

          // Ice sheets, sea ice and snow: bright and colourless in Blue Marble. Give them the look of
          // ice — a cool blue-white with the relief shading brought out — and keep them below cloud
          // brightness, so ice and clouds never merge into the same flat white.
          float lum = dot(day, vec3(0.299, 0.587, 0.114));
          float sat = max(day.r, max(day.g, day.b)) - min(day.r, min(day.g, day.b));
          float ice = smoothstep(0.58, 0.80, lum) * (1.0 - smoothstep(0.07, 0.16, sat));
          vec3 iceCol = vec3(0.62, 0.75, 0.90) * clamp(0.82 + 3.0 * (lum - 0.86), 0.5, 1.0);
          vec3 ground = mix(day, iceCol, ice);

          // Arctic sea ice of the selected year (NSIDC September extent): pack ice over the Arctic Ocean
          // with a ragged, slightly translucent edge, so moving the year slider shows it grow or shrink.
          // Ocean, including the very dark deep basins of the bathymetry shading (bluish relative to red/green).
          float sea = max(smoothstep(0.02, 0.10, day.b - max(day.r, day.g)), step(max(day.r, day.g) * 1.35 + 0.002, day.b) * (1.0 - smoothstep(0.2, 0.4, lum)));
          float lonA = atan(N.z, -N.x);
          float wob = 0.0045 * sin(lonA * 3.0 + 1.0) + 0.003 * sin(lonA * 7.0 + 2.3) + 0.0015 * sin(lonA * 17.0 + 0.7);
          float pack = smoothstep(iceCos - 0.005 + wob, iceCos + 0.006 + wob, N.y) * sea;
          float floe = 0.9 + 0.1 * sin(lonA * 60.0 + N.y * 400.0) * sin(N.y * 900.0 + lonA * 7.0);
          ground = mix(ground, vec3(0.70, 0.79, 0.90) * floe, pack * 0.96);

          // Cloud shadows: the cloud deck floats above the ground, so a point's shadow comes from the
          // cloud toward the sun — far away near sunset, right overhead at noon.
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5, 0.0, 0.0));
          vec3 north = cross(N, east);
          float coslat = max(sqrt(1.0 - N.y * N.y), 0.2);
          float reach = 0.006 / max(ndl, 0.18); // deck height × tan(sun zenith)
          vec2 toSun = vec2(dot(L, east) * reach / (6.2832 * coslat), dot(L, north) * reach / 3.1416);
          vec2 cuv = vec2(vUv.x - shift, vUv.y) + toSun;
          float shadow = (cloudAlpha(cloudMap, dayMap, cuv) * 0.5
            + cloudAlpha(cloudMap, dayMap, cuv + vec2(0.0012, 0.0)) * 0.25
            + cloudAlpha(cloudMap, dayMap, cuv - vec2(0.0, 0.0012)) * 0.25) * cloudShadow;
          float clouds = cloudAlpha(cloudMap, dayMap, vec2(vUv.x - shift, vUv.y)) * cloudShadow;

          // Daylight: lambert + soft ambient so the night side stays readable. The ground peaks below
          // white; clouds (next shell) are brighter, so they stand out even over ice and deserts.
          vec3 color = ground * (0.05 + 1.08 * max(ndl, 0.0)) * (1.0 - 0.5 * shadow);

          // Oceans (deep blue in Blue Marble) get a sun glint.
          float ocean = smoothstep(0.02, 0.10, day.b - max(day.r, day.g)) * (1.0 - pack);
          vec3 H = normalize(L + V);
          float glint = pow(max(dot(N, H), 0.0), 70.0) * 1.4 + pow(max(dot(N, H), 0.0), 8.0) * 0.08;
          color += vec3(0.75, 0.88, 1.0) * glint * ocean * lit * (1.0 - clouds);

          // City lights on the night side (VIIRS Black Marble), suppressing the moonlit ground.
          vec3 night = texture2D(nightMap, vUv).rgb;
          float lights = smoothstep(0.18, 0.75, dot(night, vec3(0.4, 0.4, 0.2)));
          color += vec3(1.0, 0.72, 0.38) * lights * 1.6 * (1.0 - lit) * (1.0 - 0.7 * clouds);
          color += vec3(0.02, 0.05, 0.11) * (1.0 - lit); // faint earthshine blue

          // Atmospheric scattering at the limb.
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          color = mix(color, vec3(0.30, 0.62, 1.0), fres * (0.25 + 0.6 * lit));
          color += vec3(0.25, 0.55, 1.0) * fres * 0.35 * lit;

          gl_FragColor = vec4(color * dim, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 112), baseMaterial);
    scene.add(sphere);

    // Cloud shell, slightly above the ground so it catches the light first at the limb.
    const cloudUniforms = { cloudMap: { value: cloudMap }, dayMap: { value: dayMap }, sunDir: { value: sunDir }, opacity: { value: 1 }, shift: cloudShift };
    const cloudMaterial = new THREE.ShaderMaterial({
      uniforms: cloudUniforms,
      vertexShader: SHARED_VERT,
      fragmentShader: `
        uniform sampler2D cloudMap, dayMap;
        uniform vec3 sunDir;
        uniform float opacity, shift;
        varying vec2 vUv;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        ${CLOUD_GLSL}
        void main() {
          vec3 N = normalize(vNormalW), V = normalize(vViewW);
          float ndl = dot(N, normalize(sunDir));
          float a = cloudAlpha(cloudMap, dayMap, vec2(vUv.x - shift, vUv.y));
          // Thick cloud tops are bright and neutral white; thin cloud edges are greyer and more see-through,
          // which gives the deck depth and keeps it distinct from the bluish ice below.
          float thick = smoothstep(0.25, 0.95, a);
          vec3 c = mix(vec3(0.80, 0.82, 0.85), vec3(1.0, 1.0, 0.99), thick) * (0.05 + 1.35 * max(ndl, 0.0));
          // Warm light on cloud tops near sunset.
          c *= mix(vec3(1.0, 0.78, 0.6), vec3(1.0), smoothstep(0.0, 0.35, ndl));
          c = mix(c, vec3(0.55, 0.75, 1.0), pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.35);
          gl_FragColor = vec4(c, a * 0.95 * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    const cloudSphere = new THREE.Mesh(new THREE.SphereGeometry(1.008, 160, 112), cloudMaterial);
    scene.add(cloudSphere);

    // 2. NASA Climate Anomaly Heatmap Sphere Overlay
    const anomalyCanvas = document.createElement("canvas");
    anomalyCanvas.width = 512;
    anomalyCanvas.height = 256;
    const anomalyTexture = new THREE.CanvasTexture(anomalyCanvas);
    anomalyTexture.wrapS = THREE.ClampToEdgeWrapping;
    anomalyTexture.wrapT = THREE.ClampToEdgeWrapping;

    const anomalyMaterial = new THREE.MeshBasicMaterial({
      map: anomalyTexture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const anomalySphere = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 64), anomalyMaterial);
    anomalySphere.visible = layer !== "Natural color";
    scene.add(anomalySphere);

    // 3. Arctic sea ice is drawn in the ground shader (iceCos), in every layer.

    scene.add(camera);

    // 4. Atmosphere halo (scattering glow beyond the limb), brighter on the sunlit side.
    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {
        glow: { value: new THREE.Color("#3d8bff") },
        density: { value: 1 },
        sunDir: { value: sunDir },
      },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewW = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 glow, sunDir;
        uniform float density;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main() {
          float rim = dot(normalize(vNormalW), normalize(vViewW)); // negative on the back faces we draw
          float a = pow(clamp(-rim * 1.97, 0.0, 1.0), 3.0);
          float sun = 0.3 + 0.7 * smoothstep(-0.45, 0.6, dot(normalize(vNormalW), normalize(sunDir)));
          gl_FragColor = vec4(glow * 1.25, a * density * sun);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.16, 96, 64), atmosphereMaterial));

    // Starfield
    const starCount = 2600, starPos = new Float32Array(starCount * 3), starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20);
      starPos.set([v.x, v.y, v.z], i * 3);
      const b = 0.35 + Math.random() ** 3 * 0.65, tint = Math.random();
      starCol.set([b * (tint > 0.85 ? 1 : 0.82), b * 0.9, b], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    scene.add(stars);

    // Latitude & Longitude Reference Grid
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x6fb3ff, transparent: true, opacity: 0.06, toneMapped: false });
    for (let lat = -60; lat <= 60; lat += 30) {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, i) => position(lat, (i / 128) * 360 - 180, 1.007))), lineMaterial));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 65 }, (_, i) => position((i / 64) * 180 - 90, lon, 1.007))), lineMaterial));
    }

    // Place Markers & Active Indicator
    const dotGeometry = new THREE.SphereGeometry(0.009, 12, 12);
    const dotMaterial = new THREE.MeshBasicMaterial({ color: 0x8fd4ff, toneMapped: false });
    const markers = PLACES.map((p) => {
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.position.copy(position(p.lat, p.lon, 1.012));
      dot.userData.place = p;
      scene.add(dot);
      return dot;
    });

    const activeDot = new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    scene.add(activeDot);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.026, 0.031, 48),
      new THREE.MeshBasicMaterial({ color: 0x38b6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, toneMapped: false })
    );
    scene.add(ring);
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.034, 48),
      new THREE.MeshBasicMaterial({ color: 0x38b6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false })
    );
    scene.add(pulse);

    let target: THREE.Vector3 | null = null;
    let active = place;

    const focus = (p: Place) => {
      active = p;
      target = position(p.lat, p.lon).multiplyScalar(3.5);
      activeDot.position.copy(position(p.lat, p.lon, 1.018));
      ring.position.copy(position(p.lat, p.lon, 1.02));
      ring.lookAt(position(p.lat, p.lon, 2));
      pulse.position.copy(position(p.lat, p.lon, 1.021));
      pulse.lookAt(position(p.lat, p.lon, 2));
    };
    focus(place);

    // Initial texture draw
    const ctx = anomalyCanvas.getContext("2d");
    if (ctx && layer !== "Natural color") {
      drawClimateTexture(ctx, nasaData, layer);
      anomalyTexture.needsUpdate = true;
    }

    // Imperative API for real-time slider scrubbing
    const updateData = (l: Layer, y: number) => {
      const rec = getNasaGlobalData(y);

      // 1. Atmosphere density & greenhouse scattering based on CO2
      const co2Norm = Math.min(1, Math.max(0, (rec.co2Ppm - 365) / 130));
      atmosphereMaterial.uniforms.glow.value.copy(new THREE.Color("#3d8bff").lerp(new THREE.Color("#5aa9ff"), co2Norm));
      atmosphereMaterial.uniforms.density.value = 0.9 + co2Norm * 0.25;

      // 2. Arctic sea ice of that year (NSIDC September extent; projected after 2025)
      earthUniforms.iceCos.value = seaIceCos(rec.seaIceExtent);

      // 3. Thermal Anomaly Heatmap / Layer
      if (l === "Natural color") {
        anomalySphere.visible = false;
        earthUniforms.dim.value = 1;
        cloudUniforms.opacity.value = 1;
      } else {
        anomalySphere.visible = true;
        earthUniforms.dim.value = 0.7;
        cloudUniforms.opacity.value = 0.25;
        if (ctx) {
          drawClimateTexture(ctx, rec, l);
          anomalyTexture.needsUpdate = true;
        }
      }
    };

    api.current = {
      focus,
      zoom: (n) => {
        target = camera.position.clone().normalize().multiplyScalar(THREE.MathUtils.clamp(camera.position.length() + n, 2.1, 5));
      },
      updateData,
    };

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const pointer = new THREE.Vector2();
    const ray = new THREE.Raycaster();
    let down = { x: 0, y: 0 };

    const start = (event: PointerEvent) => {
      target = null;
      down = { x: event.clientX, y: event.clientY };
    };

    const click = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      ray.setFromCamera(pointer, camera);

      // Hit test only sphere and markers
      const hit = ray.intersectObjects([sphere, ...markers])[0];
      if (hit?.object.userData.place) {
        onSelectRef.current(hit.object.userData.place);
        return;
      }
      if (hit?.object === sphere) {
        const p = hit.point.normalize();
        const lat = (Math.asin(p.y) * 180) / Math.PI;
        const lon = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
        const closest = PLACES.reduce((a, b) =>
          position(a.lat, a.lon).distanceTo(p) < position(b.lat, b.lon).distanceTo(p) ? a : b
        );
        if (position(closest.lat, closest.lon).distanceTo(p) < 0.1) {
          onSelectRef.current(closest);
        } else {
          const fallbackPlace: Place = {
            id: `point-${lat.toFixed(2)}-${lon.toFixed(2)}`,
            name: "Resolving place…",
            country: `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`,
            lat: +lat.toFixed(4),
            lon: +lon.toFixed(4),
          };
          onSelectRef.current(fallbackPlace);
          fetch(`/api/places?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`)
            .then((r) => (r.ok ? (r.json() as Promise<{ place?: Place }>) : null))
            .then((data) => {
              if (data?.place) onSelectRef.current(data.place);
            })
            .catch(() => {});
        }
      }
    };

    renderer.domElement.addEventListener("pointerdown", start);
    renderer.domElement.addEventListener("pointerup", click);

    let frame = 0;
    let last = performance.now();
    const CLOUD_PERIOD = 420; // seconds for the clouds to circle the planet once
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let running = true;
    const animate = () => {
      if (!running) return;
      frame = requestAnimationFrame(animate);
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!still) {
        cloudShift.value = (cloudShift.value + dt / CLOUD_PERIOD) % 1;
        stars.rotation.y += dt * 0.004;
      }
      if (target) {
        camera.position.lerp(target, 0.055);
        if (camera.position.distanceTo(target) < 0.005) target = null;
      }
      controls.update();
      // Sun fixed relative to the viewer (upper left), so the selected place is always in daylight.
      sunDir.copy(SUN_VIEW).applyQuaternion(camera.quaternion);
      const t = (performance.now() % 2400) / 2400;
      pulse.scale.setScalar(1 + t * 1.6);
      (pulse.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
      if (label.current) {
        const point = position(active.lat, active.lon, 1.04);
        const v = point.clone().project(camera);
        const front = point.dot(camera.position.clone().sub(point)) > 0;
        label.current.style.opacity = front && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.9 ? "1" : "0";
        label.current.style.left = `${((v.x + 1) / 2) * container.clientWidth}px`;
        label.current.style.top = `${((-v.y + 1) / 2) * container.clientHeight}px`;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", start);
      renderer.domElement.removeEventListener("pointerup", click);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      textures.forEach((t) => t.dispose());
      anomalyTexture.dispose();
      starGeo.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.focus(place);
  }, [place]);

  useEffect(() => {
    api.current?.updateData(layer, year);
  }, [layer, year]);

  return (
    <div className="globe-stage">
      <div ref={host} className="globe-canvas" />

      {/* NASA Earth System Telemetry HUD */}
      {!failed && (
        <div className={`nasa-telemetry-hud ${hudOpen ? "" : "minimized"}`}>
          <div className="nasa-telemetry-header">
            <div className="telemetry-badge">
              <Activity size={12} />
              <span>{t("NASA DATA HUD")}</span>
              <span className="telemetry-year-tag">{y(year)}</span>
            </div>
            <button
              className="telemetry-toggle-btn"
              onClick={() => setHudOpen((v) => !v)}
              aria-label={hudOpen ? t("Minimize NASA telemetry") : t("Expand NASA telemetry")}
            >
              {hudOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          {hudOpen && (
            <>
              <div className="nasa-telemetry-grid">
                <div className="telemetry-item">
                  <span className="telemetry-label">
                    <Thermometer size={12} /> {t("Global Anomaly")}
                  </span>
                  <strong className={nasaData.globalTempAnomaly >= 1.5 ? "telemetry-hot" : "telemetry-warm"}>
                    +{n(nasaData.globalTempAnomaly, 2)}°C
                  </strong>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">
                    <Snowflake size={12} /> {t("Arctic Warming")}
                  </span>
                  <strong className="telemetry-arctic">
                    +{n(nasaData.arcticTempAnomaly, 2)}°C
                    <small className="amplification-badge" title={`Arctic warming rate ${ARCTIC_RATE.perDecade.toFixed(2)} vs global ${GLOBAL_RATE.perDecade.toFixed(2)} °C/decade, ${ARCTIC_RATE.from}–${ARCTIC_RATE.to}`}>
                      {t("{x}× rate", { x: n(AMPLIFICATION, 1) })}
                    </small>
                  </strong>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">
                    <Wind size={12} /> {t("Sea Ice Extent")}
                  </span>
                  <strong>
                    {n(nasaData.seaIceExtent, 2)} <small>{t("M km²")}</small>
                    <span className="telemetry-delta">
                      ({n(((nasaData.seaIceExtent - SEA_ICE_REFERENCE.extent) / SEA_ICE_REFERENCE.extent) * 100)}% {t("vs")} {y(SEA_ICE_REFERENCE.year)})
                    </span>
                  </strong>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">
                    <Activity size={12} /> {t("Atmospheric CO₂")}
                  </span>
                  <strong className="telemetry-co2">
                    {n(nasaData.co2Ppm, 1)} <small>ppm</small>
                  </strong>
                </div>
              </div>

              {layer === "Temperature" && (
                <div className="telemetry-scale">
                  <div className="scale-labels">
                    <span>-0.5°C</span>
                    <span>0.0°C</span>
                    <span>+1.0°C</span>
                    <span>+2.0°C</span>
                    <span>+4.0°C+</span>
                  </div>
                  <div className="scale-bar temperature-scale" />
                </div>
              )}

              {layer === "Rainfall" && (
                <div className="telemetry-scale">
                  <div className="scale-labels">
                    <span>{t("Dry subtropics")}</span>
                    <span>{t("Climatological pattern")}</span>
                    <span>{t("Wet tropics")}</span>
                  </div>
                  <div className="scale-bar rainfall-scale" />
                </div>
              )}

              {layer === "Vegetation" && (
                <div className="telemetry-scale">
                  <div className="scale-labels">
                    <span>{t("Arid Browning")}</span>
                    <span>{t("Baseline")}</span>
                    <span>{t("Arctic Greening")}</span>
                  </div>
                  <div className="scale-bar vegetation-scale" />
                </div>
              )}

              <div className="telemetry-source">
                <span>{nasaData.projected ? "⚠ " : ""}{t(nasaData.source)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {failed && (
        <div className="globe-fallback">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/textures/earth-day.jpg" alt={t("NASA Blue Marble Earth texture")} />
          <p>{t("Interactive 3D is unavailable on this device. Use the location picker to explore.")}</p>
        </div>
      )}

      {!failed && (
        <div className="globe-place" ref={label}>
          <span className="place-stem" />
          <div>
            <span className="pin-dot" />
            {place.name}
            <small>{place.country}</small>
          </div>
        </div>
      )}

      <div className="globe-tools">
        <button aria-label={t("Zoom in")} onClick={() => api.current?.zoom(-0.4)}>
          <Plus size={17} />
        </button>
        <button aria-label={t("Zoom out")} onClick={() => api.current?.zoom(0.4)}>
          <Minus size={17} />
        </button>
        <i />
        <button aria-label={t("Center on selected place")} onClick={() => api.current?.focus(place)}>
          <LocateFixed size={17} />
        </button>
      </div>

      <div className="globe-instructions">
        <RotateCcw size={12} /> {t("Drag to explore")} <span>·</span> {t("Click a place")}
      </div>
    </div>
  );
}
