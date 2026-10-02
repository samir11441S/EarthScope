import { calculateTrend, climateStory, observation, periodDelta, periodLabels, RECORD_END, RECORD_START, SCENARIO_END, signed, trendSummary, trendVerdict, type ClimateData, type Place } from "@/lib/climate";
import { AR6_SSP245, CO2_REFERENCE, getNasaGlobalData, GLOBAL_LAST, globalWarmingRate, observedRate, SEA_ICE_REFERENCE } from "@/lib/nasa-global-data";

export interface AskInput { question: string; place: Place; data: ClimateData; year: number; warming: number; rainChange: number }
export interface AskAnswer { answer: string; followUps: string[]; citations: string[] }

/** Deterministic answers from the selected place's record and the global record. */
function staticAnswer({ question, place, data, year, warming, rainChange }: AskInput): AskAnswer {
  const q = question.toLowerCase().trim();
  const delta = periodDelta(data);
  const periods = periodLabels(data);
  const lastYear = periods.last;
  const currentObs = observation(data, Math.min(year, lastYear), warming, rainChange);
  const future = observation(data, SCENARIO_END, warming, rainChange);
  const trend = calculateTrend(data.annual);
  const globalNasa = getNasaGlobalData(year);
  const globalRate = globalWarmingRate();
  const projectedNote = globalNasa.projected ? `\n\n*${year} is after the last observation (${GLOBAL_LAST}); global values for it are a trend extrapolation, not a measurement.*` : "";
  const breakLine = periods.breakNote ? `\n\n> **Data quality check:** ${periods.breakNote}` : "";
  const tempDeltaLine = delta.temperature === null
    ? "* **Decade comparison**: fewer than 20 consistent years — not enough for a fair first-decade vs last-decade comparison."
    : `* **Decade comparison**: ${periods.recent} averaged **${signed(delta.temperature, 2)}°C** relative to ${periods.base}.`;
  const rainDeltaLine = delta.rainfall === null
    ? "* **Decade comparison**: fewer than 20 consistent years of rainfall — not enough for a fair comparison."
    : `* **Decade comparison**: ${periods.rainRecent} rainfall was **${signed(delta.rainfall, 1)}%** relative to ${periods.rainBase}.`;
  const tempTrendLine = `* **Temperature trend (${trend.years[0]}–${trend.years[1]})**: **${trendVerdict(trend)}** — ${trendSummary(trend)}.`;
  const rainTrendLine = `* **Rainfall trend (${trend.rainYears[0]}–${trend.rainYears[1]})**: **${trend.rainDirection === "no clear trend" ? "No clear trend" : `Significantly ${trend.rainDirection}`}** — ${trendSummary(trend, "rain")}.`;

  let answer: string;
  let followUps: string[] = [];
  const citations = [
    "NASA POWER / MERRA-2 Gridded Reanalysis (power.larc.nasa.gov)",
    "NASA GISTEMP v4 Surface Temperature Analysis (data.giss.nasa.gov/gistemp)",
    "NSIDC Sea Ice Index v4 (nsidc.org/data/seaice_index)",
    "NOAA Global Monitoring Laboratory CO2 Record (gml.noaa.gov/ccgg/trends)",
    AR6_SSP245.source,
  ];

  // 1. Trend Detective & Statistical Analysis
  if (/trend|detective|rate|slope|decade|how fast|statist|r2|rsquared|signal|significan|evidence|really|is .* warming|উষ্ণ/.test(q)) {
    answer = `### 🔍 Trend Detective Report: ${place.name}

Examining the ${data.source} record (**${periods.span}** used for temperature):

${tempTrendLine}
${rainTrendLine}
${tempDeltaLine}
* **Method**: least-squares trend with a two-sided t-test. Because one year resembles the next, the effective sample size is reduced for autocorrelation (effective n = ${trend.nEff.toFixed(0)} of ${trend.years[1] - trend.years[0] + 1} years). A trend counts only if p < 0.05.${breakLine}

**Detective's takeaway**: ${trend.tempSignificant ? `the ${trend.direction} signal is larger than the year-to-year noise, so it is unlikely to be chance.` : "the year-to-year swings are larger than any steady change so far. That is not evidence of no change — just not enough evidence of one in this record."}`;

    followUps = [
      `How does ${place.name} compare to global warming?`,
      `Are heavy rain events increasing in ${place.name}?`,
      `What could ${place.name} look like in ${SCENARIO_END}?`,
    ];
  }

  // 2. Arctic Amplification & Cryosphere (NSIDC / NASA)
  else if (/arctic|ice|sea ice|polar|glacier|cryosphere|north pole|nsidc|amplif/.test(q)) {
    const arcticRate = observedRate("arcticTempAnomaly"), iceRate = observedRate("seaIceExtent");
    const amplification = arcticRate.perDecade / globalRate.perDecade;
    const iceChange = ((globalNasa.seaIceExtent - SEA_ICE_REFERENCE.extent) / SEA_ICE_REFERENCE.extent) * 100;

    answer = `### ❄️ Arctic Amplification & Sea Ice

* **Arctic temperature anomaly (${year})**: **${signed(globalNasa.arcticTempAnomaly, 2)}°C** relative to 1951–1980 (NASA GISTEMP v4, 64°N–90°N band).
* **Arctic amplification**: over ${arcticRate.from}–${arcticRate.to} the Arctic warmed at **${signed(arcticRate.perDecade, 2)}°C/decade** versus **${signed(globalRate.perDecade, 2)}°C/decade** globally — about **${amplification.toFixed(1)}× faster**.
* **Arctic September sea-ice extent (${year})**: **${globalNasa.seaIceExtent.toFixed(2)} million km²** (NSIDC Sea Ice Index v4), **${signed(iceChange, 0)}%** compared with ${SEA_ICE_REFERENCE.year} (${SEA_ICE_REFERENCE.extent.toFixed(2)} million km²).
* **Observed decline**: **${signed(iceRate.perDecade, 2)} million km² per decade** since ${iceRate.from}.

**Physical mechanism — ice-albedo feedback**: sea ice reflects roughly 50–85% of sunlight (more when snow-covered), while open ocean reflects only about 6% and absorbs the rest. Less ice means more absorbed heat, which melts more ice — a self-reinforcing loop that is one reason the Arctic warms faster than the global average.${projectedNote}`;

    followUps = [
      "What is the current atmospheric CO2 concentration?",
      `How does ${place.name}'s warming rate compare to global trends?`,
      "How does NASA track Earth's climate from space?",
    ];
  }

  // 3. Global vs. Local Comparison
  else if (/global|vs global|compare.*global|whole world|entire planet/.test(q)) {
    const local = trend.tempCi95, glob = globalRate.ci95;
    const overlap = local[0] <= glob[1] && glob[0] <= local[1];
    const comparison = !trend.tempEnough
      ? `There are fewer than 15 consistent years at ${place.name}, so no local rate can be compared.`
      : !trend.tempSignificant
      ? `${place.name} has **no statistically clear local trend** (${trendSummary(trend)}), so its rate cannot be meaningfully ranked against the global one.`
      : overlap
      ? `The local and global 95% confidence intervals overlap, so ${place.name} is warming **at a rate statistically indistinguishable from the global average**.`
      : trend.tempSlopePerDecade > globalRate.perDecade
      ? `${place.name} is warming **faster than the global average** (confidence intervals do not overlap) — land generally warms faster than the ocean-dominated global mean.`
      : `${place.name} is warming **more slowly than the global average** (confidence intervals do not overlap); maritime air, aerosols or irrigation can damp local warming.`;

    answer = `### 🌍 Global vs. Local: ${place.name}

* **Global temperature anomaly (${year})**: **${signed(globalNasa.globalTempAnomaly, 2)}°C** relative to NASA's 1951–1980 baseline (GISTEMP v4).
* **Global rate (${globalRate.from}–${globalRate.to})**: **${signed(globalRate.perDecade, 2)}°C/decade** (95% CI ${signed(glob[0], 2)} to ${signed(glob[1], 2)}).
* **Local rate (${trend.years[0]}–${trend.years[1]})**: ${trend.tempEnough ? `**${signed(trend.tempSlopePerDecade, 2)}°C/decade** (95% CI ${signed(local[0], 2)} to ${signed(local[1], 2)})` : "not available"}.
* **Verdict**: ${comparison}

The global mean includes the oceans, which absorb about 90% of the excess heat and warm more slowly; people live on land, where warming is usually faster.${breakLine}${projectedNote}`;

    followUps = [
      "Why is the Arctic warming faster than everywhere else?",
      `What is the warming trend per decade in ${place.name}?`,
      "What is happening to Arctic sea ice and CO2?",
    ];
  }

  // 4. Atmospheric CO2 & Greenhouse Gases (NOAA Mauna Loa)
  else if (/co2|carbon|greenhouse|gas|ppm|mauna loa|emissions|atmosphere/.test(q)) {
    const recentGrowth = observedRate("co2Ppm", GLOBAL_LAST - 9).perDecade / 10;
    answer = `### 🔬 Atmospheric CO₂ (NOAA Mauna Loa)

* **CO₂ in ${year}**: **${globalNasa.co2Ppm.toFixed(1)} ppm**.
* **Change since ${CO2_REFERENCE.year}**: **${signed(globalNasa.co2Ppm - CO2_REFERENCE.ppm, 1)} ppm** (from ${CO2_REFERENCE.ppm.toFixed(1)} ppm).
* **Recent growth (${GLOBAL_LAST - 9}–${GLOBAL_LAST})**: about **${recentGrowth.toFixed(1)} ppm per year**.
* **Pre-industrial level**: about 280 ppm. Today's concentration is higher than at any time in at least 800,000 years of ice-core records.

**Physical mechanism**: CO₂ absorbs and re-emits the infrared radiation that Earth's surface gives off, so more CO₂ means more heat retained in the lower atmosphere.${projectedNote}`;

    followUps = [
      "Why is the Arctic warming faster than everywhere else?",
      `What could ${place.name} look like in ${SCENARIO_END}?`,
      `How can ${place.name} adapt to climate change?`,
    ];
  }

  // 5. Extreme Heat & Urban Heat Island
  else if (/why|hotter|heat|warm|extreme|temperature|island/.test(q)) {
    answer = `### 🌡️ Temperature & Urban Heat: ${place.name}

In this **${data.source}** record:
* **Annual mean (${Math.min(year, lastYear)})**: **${currentObs.temperature.toFixed(2)}°C**.
${tempDeltaLine}
${tempTrendLine}${breakLine}

**Why cities feel hotter than these grid values (urban heat island)**: NASA POWER cells are about 50 km wide, so they average city and countryside. Inside dense cities:
1. **Thermal mass** — concrete and asphalt store heat by day and release it at night.
2. **Less evaporative cooling** — lost trees, soil and wetlands.
3. **Waste heat** — air conditioners, traffic and industry.

**Priority heat actions**: continuous tree canopy and shade on walking routes, reflective "cool roofs", and community cooling centres linked to heat-health warnings.`;

    followUps = [
      `What is the warming trend per decade in ${place.name}?`,
      `How can ${place.name} adapt to rising heat?`,
      `What could ${SCENARIO_END} look like for ${place.name}?`,
    ];
  }

  // 6. Floods, Heavy Rainfall & Storms
  else if (/flood|rain|water|monsoon|storm|precipitation|downpour/.test(q)) {
    answer = `### 🌧️ Rainfall & Flood Dynamics: ${place.name}

In the **${data.source}** record:
* **Annual precipitation (${Math.min(year, lastYear)})**: **${Math.round(currentObs.rainfall).toLocaleString()} mm**.
${rainDeltaLine}
${rainTrendLine}${breakLine}

**Why extreme rain can grow even when totals do not (Clausius–Clapeyron)**: warmer air holds about **7% more water vapour per 1 °C**, so rain tends to fall in more intense bursts. Annual totals cannot show this — daily extremes are needed.

**Flood risk beyond rainfall**: topography, river discharge, tides and storm surge, soil saturation and drainage capacity. Protecting wetlands, keeping drains clear and following official flood warnings are the most effective local actions.`;

    followUps = [
      `How can ${place.name} improve flood resilience?`,
      `What is the warming trend per decade in ${place.name}?`,
      `What could ${place.name} look like in ${SCENARIO_END}?`,
    ];
  }

  // 7. Drought, Water Stress & Dry Spells
  else if (/drought|dry|water supply|aquifer|groundwater|arid/.test(q)) {
    answer = `### 🏜️ Drought & Water Security: ${place.name}

* **Annual rainfall (${Math.min(year, lastYear)})**: **${Math.round(currentObs.rainfall).toLocaleString()} mm**.
${rainDeltaLine}
${rainTrendLine}${breakLine}

**Compound drought**: drought is not only a lack of rain — warmer air raises evaporative demand, drying soils, crops and reservoirs faster.

**Water resilience priorities**:
1. Rainwater harvesting and managed aquifer recharge.
2. Leak reduction in municipal supply networks.
3. Drought-tolerant native trees and mulching to keep soil moisture.`;

    followUps = [
      `Is ${place.name} at risk of crop loss?`,
      `What are practical adaptation steps for ${place.name}?`,
      `What could ${SCENARIO_END} look like for ${place.name}?`,
    ];
  }

  // 8. Agriculture & Crop Viability
  else if (/farm|crop|agricult|rice|wheat|yield|harvest|soil|salin/.test(q)) {
    answer = `### 🌾 Agriculture & Food Systems: ${place.name}

* **Observed climate (${Math.min(year, lastYear)})**: **${currentObs.temperature.toFixed(1)}°C** annual mean; **${Math.round(currentObs.rainfall).toLocaleString()} mm** annual precipitation.
* **Your ${SCENARIO_END} what-if**: **${future.temperature.toFixed(1)}°C** and **${Math.round(future.rainfall).toLocaleString()} mm** (user-selected change, not a forecast).

**Key agronomic considerations**:
* **Heat during flowering**: daytime peaks above ~35 °C at flowering can cause spikelet sterility in rice and wheat even when the annual mean looks moderate.
* **Salinity**: coastal areas such as Khulna and Batiaghata face saltwater intrusion in dry seasons; saline-tolerant varieties help.
* **Monsoon timing**: shifts in onset disrupt sowing and transplanting calendars.

*Consult regional agricultural extension services for variety choices and planting calendars.*`;

    followUps = [
      `How can farmers in ${place.name} adapt to climate shifts?`,
      `What could ${SCENARIO_END} look like for ${place.name}?`,
      `What is the warming trend per decade in ${place.name}?`,
    ];
  }

  // 9. Future Scenarios & 2050 Outlook
  else if (/2050|future|scenario|tomorrow|projection|what if|outlook/.test(q)) {
    answer = `### 🔮 Scenario Lab (${SCENARIO_END}): ${place.name}

With your settings (**${signed(warming, 1)}°C** warming and **${signed(rainChange, 0)}%** rainfall by ${SCENARIO_END}, applied to the ${lastYear} observation):

* **${SCENARIO_END} temperature**: **${future.temperature.toFixed(2)}°C** (${signed(future.temperature - currentObs.temperature, 2)}°C vs ${lastYear}).
* **${SCENARIO_END} precipitation**: **${Math.round(future.rainfall).toLocaleString()} mm**.

**Scientific reference — IPCC AR6, SSP2-4.5 (intermediate emissions)**, global warming relative to 1850–1900:
* ${AR6_SSP245.near.period}: **${AR6_SSP245.near.best.toFixed(1)} °C** (very likely ${AR6_SSP245.near.range[0].toFixed(1)}–${AR6_SSP245.near.range[1].toFixed(1)} °C)
* ${AR6_SSP245.mid.period}: **${AR6_SSP245.mid.best.toFixed(1)} °C** (very likely ${AR6_SSP245.mid.range[0].toFixed(1)}–${AR6_SSP245.mid.range[1].toFixed(1)} °C)

**Educational note**: your scenario is a simple sensitivity test, not a downscaled climate projection. Local outcomes depend on global emissions, land use and adaptation.`;

    followUps = [
      `How can ${place.name} prepare for a ${signed(warming, 1)}°C warmer future?`,
      `How does ${place.name} compare to global warming?`,
      `What is the warming trend per decade in ${place.name}?`,
    ];
  }

  // 10. Community Adaptation & Practical Actions
  else if (/adapt|action|help|community|solution|prepare|protect|tree|green|shade/.test(q)) {
    answer = `### 🛡️ Climate Adaptation Playbook for ${place.name}

1. **Urban canopy & nature-based cooling**
   * Plant native shade trees along walking routes, schoolyards and markets; well-shaded streets can be several °C cooler at the surface.
   * Reflective or vegetated "cool roofs" on public and commercial buildings.

2. **Sponge infrastructure for water**
   * Restore ponds, canals and floodplains that absorb heavy downpours.
   * Permeable paving and bioswales to reduce urban flash flooding.

3. **Early warning & protection**
   * Connect vulnerable neighbourhoods to official heatwave, cyclone and flood warnings.
   * Cooling centres for children, older people and outdoor workers during heat extremes.

4. **Resilient homes & livelihoods**
   * Raised plinths in flood-prone areas and rainwater harvesting for freshwater security.`;

    followUps = [
      `What is the warming trend per decade in ${place.name}?`,
      `Are heavy rain events increasing in ${place.name}?`,
      `What could ${SCENARIO_END} look like for ${place.name}?`,
    ];
  }

  // 11. NASA Satellites & Observation Technology
  else if (/satellite|modis|terra|instrument|orbit|sensor|gibs|merra|how.*measure|remote sensing/.test(q)) {
    answer = `### 🛰️ How NASA Tracks Earth's Climate From Orbit

* **Terra & MODIS**: Terra (launched December 1999) carries MODIS, which images the whole Earth every 1–2 days in 36 spectral bands — surface temperature, fires, clouds and vegetation (NDVI).
* **Landsat & Sentinel-2 (HLS)**: NASA's Harmonized Landsat Sentinel-2 product gives 30 m views every few days — used here for the sharp satellite comparison.
* **NASA GIBS**: serves imagery from Terra, Aqua, Suomi NPP and NOAA-20, typically within a few hours of the satellite pass.
* **NASA POWER & MERRA-2**: MERRA-2 combines satellite and ground observations with NASA's GEOS model to give consistent gridded temperature and rainfall from 1980 onward. When the set of assimilated observations changes, a reanalysis can show artificial jumps — which is why Terra tests every series for breaks.`;

    followUps = [
      `What is the warming trend per decade in ${place.name}?`,
      "Why is the Arctic warming faster than everywhere else?",
      "What is happening to Arctic sea ice and CO2?",
    ];
  }

  // 12. Data Accuracy & Integrity
  else if (/source|data|accur|reliab|ai|model|where.*from/.test(q)) {
    answer = `### 📊 Data Integrity & Provenance

* **Local climate**: NASA POWER / MERRA-2 reanalysis, ${RECORD_START}–${RECORD_END}, 0.5° × 0.625° grid (about 50 km) — a regional estimate, not a single weather station.
* **Quality control**: each local series is tested for abrupt non-climatic steps (two-phase regression, Lund & Reeves 2002, 99% level); years before a break are excluded from trends.
* **Trend statistics**: least-squares slope, autocorrelation-corrected t-test, 95% confidence intervals.
* **Global temperature**: NASA GISTEMP v4, relative to 1951–1980.
* **Sea ice**: NSIDC Sea Ice Index v4. **CO₂**: NOAA GML Mauna Loa.
* **How this guide works**: rule-based answers computed from those numbers — no generative AI model is involved.${breakLine}`;

    followUps = [
      `What is the warming trend per decade in ${place.name}?`,
      `How does ${place.name} compare to global warming?`,
      `What could ${SCENARIO_END} look like for ${place.name}?`,
    ];
  }

  // 13. General History & Change
  else if (/change|history|past|story|record|journey/.test(q)) {
    answer = climateStory(place, data, Math.min(year, lastYear), warming, rainChange);
    followUps = [
      `What is the warming trend per decade in ${place.name}?`,
      `How does ${place.name} compare to global warming?`,
      `What are practical adaptation steps for ${place.name}?`,
    ];
  }

  // 14. Default / Fallback Guide
  else {
    answer = `### 🌍 Earth Guide for ${place.name} (${year})

I can analyse the climate record for **${place.name}** and connect it to global Earth-system data:

* **Latest record**: ${currentObs.temperature.toFixed(1)}°C annual mean, ${Math.round(currentObs.rainfall).toLocaleString()} mm precipitation.
${tempTrendLine}
* **Global context (${year})**: ${signed(globalNasa.globalTempAnomaly, 2)}°C globally and ${signed(globalNasa.arcticTempAnomaly, 2)}°C in the Arctic (vs 1951–1980); CO₂ ${globalNasa.co2Ppm.toFixed(1)} ppm.${projectedNote}

Choose a suggested question below, or ask about temperature trends, rainfall, Arctic sea ice, future scenarios or adaptation.`;

    followUps = [
      `What is the warming trend per decade in ${place.name}?`,
      `How does ${place.name} compare to global warming?`,
      "What is happening to Arctic sea ice and CO2?",
      `How can ${place.name} adapt to rising heat?`,
    ];
  }

  return { answer, followUps, citations };
}

// ---------------------------------------------------------------------------
// Live answers for the offline guide: reuse the same verified tools the AI uses.

const BANGLA = /[ঀ-৿]/;
const BANGLA_NOTE = "> অফলাইন গাইড ইংরেজিতে উত্তর দেয়। AI মোড চালু থাকলে বাংলায় উত্তর পাবেন।";

interface ClimateSummary { place: string; data_quality: string; temperature_trend: { period: string; verdict: string; detail: string }; rainfall_trend: { period: string; verdict: string; detail: string }; decade_change: { temperature: string; rainfall: string }; latest_year: { year: number; mean_temperature_c: number; rainfall_mm: number } }
interface HazardResult { point_status: string; feed_updated_utc: string; events_within_radius: { title: string; type: string; alert: string; phase: string; distance_km: number; point_inside_current_footprint: boolean; forecast_passes_point_at_utc: string | null }[]; total_active_events_worldwide: number }
interface SafeResult { safe_places_outside_hazard_zones: { name: string; kind: string; distance_km: number }[]; source: string }

async function liveAnswer({ question, place, data }: AskInput): Promise<AskAnswer | null> {
  const q = question.toLowerCase();
  const { runTool, summarizeRecord } = await import("./ask-ai");
  const at = { latitude: place.lat, longitude: place.lon };

  // Heat forecast for the selected place
  if (/heat ?wave|heatwave|heat index|too hot|hot this week|heat stroke|heat forecast|তাপপ্রবাহ|গরম/.test(q)) {
    const r = (await runTool("get_heat_outlook", at)) as { days: { date: string; max_temperature_c: number; heat_index_max_c: number; category: string; bmd_heatwave: string }[]; source: string };
    const worst = r.days.slice(0, 3).reduce((a, b) => (b.heat_index_max_c > a.heat_index_max_c ? b : a));
    return {
      answer: `### 🌡️ Heat outlook for ${place.name}

* **Next 3 days**: **${worst.category}** — heat index up to **${Math.round(worst.heat_index_max_c)} °C** (max temperature ${worst.max_temperature_c.toFixed(1)} °C, ${worst.bmd_heatwave.toLowerCase()}).
${r.days.map(d => `* ${new Date(d.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: feels like ${Math.round(d.heat_index_max_c)} °C (${d.category.toLowerCase()})`).join("\n")}

**Stay safe in humid heat**: avoid outdoor work 11:00–16:00, drink water often, check on older people and children, and treat confusion or hot dry skin as heat stroke — call 999.
> Heat index combines temperature and humidity (NOAA NWS); heatwave classes follow BMD. Forecast: ${r.source.split(";")[0]}.${BANGLA.test(question) ? "\n" + BANGLA_NOTE : ""}`,
      followUps: [`Is ${place.name} really warming?`, `Where are cooling places or hospitals in ${place.name}?`, "Are there any active disasters near me?"],
      citations: [r.source],
    };
  }

  // Live hazards near the selected place
  if (/disaster|hazard|cyclone|earthquake|danger|alert|warning|right now|currently|active|wildfire|volcano|দুর্যোগ|ঘূর্ণিঝড়|বন্যা/.test(q) && !/history|trend|decade/.test(q)) {
    const r = (await runTool("get_live_hazards", { ...at, radius_km: 1500 })) as HazardResult;
    const ev = r.events_within_radius.slice(0, 6);
    const lines = ev.map(e => `* **${e.title}** — ${e.type}, ${e.alert}, ${e.phase}, ${e.distance_km.toLocaleString("en-US")} km away${e.point_inside_current_footprint ? ` · **${place.name} is inside its current footprint**` : ""}${e.forecast_passes_point_at_utc ? ` · forecast to pass around ${new Date(e.forecast_passes_point_at_utc).toUTCString().slice(5, 22)} UTC` : ""}`);
    return {
      answer: `### 🚨 Live hazards near ${place.name}

* **Status for ${place.name}**: ${r.point_status}.
${ev.length ? lines.join("\n") : `* No active events reported within 1,500 km (of ${r.total_active_events_worldwide} active worldwide).`}

Sources: NASA EONET, GDACS and USGS, updated ${new Date(r.feed_updated_utc).toUTCString().slice(17, 22)} UTC. Open **Live disasters** for the map, forecast tracks and the "Am I safe?" check.
> EarthScope is not an official warning service. Follow the Department of Disaster Management and Bangladesh Meteorological Department; in an emergency call 999.${BANGLA.test(question) ? "\n" + BANGLA_NOTE : ""}`,
      followUps: [`Where are the nearest safe shelters in ${place.name}?`, `What should I do during a cyclone?`, `Is ${place.name} really warming?`],
      citations: ["NASA EONET · GDACS · USGS live feeds"],
    };
  }

  // Safe places near the selected place
  if (/shelter|safe place|safe places|hospital|evacuat|where (can|should) i go|assembly point|আশ্রয়|হাসপাতাল/.test(q)) {
    const r = (await runTool("find_safe_places", at)) as SafeResult;
    const list = r.safe_places_outside_hazard_zones;
    return {
      answer: `### 🛡️ Safer places near ${place.name}

${list.length ? list.map(p => `* **${p.name}** — ${p.kind}, ${p.distance_km} km`).join("\n") : "* No mapped shelters, hospitals or assembly points were found within 12 km."}

Distances are from the centre of ${place.name}. For your exact location, open **Live disasters → Am I safe?** and use "Use my location" — it also gives walking routes and excludes facilities inside hazard zones.
> Community-mapped data (${r.source}); facilities may be missing or closed. Always follow official evacuation orders.${BANGLA.test(question) ? "\n" + BANGLA_NOTE : ""}`,
      followUps: [`Are there any active disasters near ${place.name}?`, "What should I pack in an emergency kit?", `How can ${place.name} adapt to floods?`],
      citations: [r.source],
    };
  }

  // Compare with another named place
  const cmp = question.match(/compare\s+.+?\s+(?:with|to|and|vs\.?)\s+(.+?)[?.!]*$/i);
  if (cmp) {
    const other = cmp[1].trim();
    // The selected place uses the record already on screen (same grid cell as the rest of the app).
    const a = summarizeRecord(place, data) as ClimateSummary;
    const b = (await runTool("get_climate_record", { place: other })) as ClimateSummary;
    const row = (s: ClimateSummary) => `* **${s.place}** — ${s.latest_year.mean_temperature_c} °C and ${s.latest_year.rainfall_mm.toLocaleString("en-US")} mm in ${s.latest_year.year}; temperature: **${s.temperature_trend.verdict}** (${s.temperature_trend.detail}, ${s.temperature_trend.period}); rainfall: ${s.rainfall_trend.verdict} (${s.rainfall_trend.detail}).`;
    const notes = [a, b].filter(s => !s.data_quality.startsWith("No abrupt")).map(s => `> ${s.place.split(" (")[0]}: ${s.data_quality}`);
    return {
      answer: `### ⚖️ ${a.place.split(" (")[0]} vs ${b.place.split(" (")[0]}

${row(a)}
${row(b)}

Trends use only each record's consistent years and count only when statistically significant (p < 0.05).
${notes.join("\n")}${BANGLA.test(question) ? "\n" + BANGLA_NOTE : ""}`,
      followUps: [`How does ${place.name} compare with global warming?`, `Is rainfall changing in ${other}?`, `What could ${place.name} be like by 2050?`],
      citations: ["NASA POWER / MERRA-2 (power.larc.nasa.gov)"],
    };
  }
  return null;
}

/**
 * Offline Ask Earth engine: deterministic answers computed from EarthScope's own data, plus live hazard,
 * shelter and comparison lookups. Used when no Claude API key is configured or the API is unavailable.
 */
export async function ruleBasedAnswer(input: AskInput): Promise<AskAnswer> {
  let live: AskAnswer | null = null;
  try { live = await liveAnswer(input); } catch { live = null; }
  const answer = live ?? staticAnswer(input);
  if (!live && BANGLA.test(input.question)) answer.answer += "\n\n" + BANGLA_NOTE;
  return answer;
}
