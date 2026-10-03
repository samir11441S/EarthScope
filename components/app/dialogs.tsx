"use client";
import { Download, Earth, ExternalLink, FlaskConical, Layers3, ShieldCheck, Siren, Sparkles, Sprout, Thermometer, TrendingUp, Waves, Wind } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RECORD_END, RECORD_START, SCENARIO_END, climateStory, imageUrl, type ClimateData, type Place } from "@/lib/climate";
import { climateStoryBn } from "@/lib/climate-bn";
import { useI18n } from "@/lib/i18n";

/* i18n */const SOURCES = [
  { href: "https://power.larc.nasa.gov/docs/methodology/", icon: Thermometer, title: "NASA POWER / MERRA-2", text: "Annual temperature at 2 meters and precipitation, {from}–{to}. Gridded reanalysis estimates (about 50 km cells), not city weather stations. Each series is tested for abrupt non-climatic steps — reanalyses jump when the observations they assimilate change — and years before a step are excluded. The record is cross-checked against ECMWF ERA5." },
  { href: "https://nasa-gibs.github.io/gibs-api-docs/", icon: Layers3, title: "NASA GIBS: MODIS, VIIRS, Landsat, Sentinel-2", text: "Land cover, vegetation (NDVI), land-surface temperature, aerosols and like-for-like imagery. The 3D globe uses NASA Blue Marble, VIIRS Black Marble city lights and real VIIRS clouds, refreshed daily." },
  { href: "https://eonet.gsfc.nasa.gov/", icon: Siren, title: "Live disasters: NASA EONET · GDACS · USGS", text: "Open natural events from NASA EONET, alert levels from GDACS (UN / European Commission) and M4.5+ earthquakes from USGS, refreshed every 5 minutes. Impact zones are simple distance estimates and “safer places” are OpenStreetMap shelters, hospitals and assembly points. Not an official warning system." },
  { href: "https://open-meteo.com/en/docs/air-quality-api", icon: Wind, title: "Air quality: CAMS forecast + NASA aerosols", text: "Hourly PM2.5, PM10, ozone and NO₂ with a 5-day forecast from the Copernicus Atmosphere Monitoring Service (via Open-Meteo), and NASA MODIS aerosol optical depth on the map." },
  { href: "https://www.ipcc.ch/report/ar6/wg1/", icon: Waves, title: "Sea level: IPCC AR6", text: "Global mean sea-level projections for low, intermediate and very high emissions (AR6 WGI Table 9.9), with ground height from the Copernicus 90 m elevation model." },
  { href: "https://www.geoboundaries.org/", icon: Earth, title: "Climate atlas: NASA POWER grid + boundaries", text: "State and district values average every NASA POWER grid cell (0.5° × 0.625°) inside the boundary, weighted by latitude. Boundaries: Natural Earth and geoBoundaries." },
];/* /i18n */
/* i18n */const NOTES = [
  { icon: TrendingUp, title: "Honest trend statistics", text: "Trends are least-squares slopes with 95% confidence intervals and an autocorrelation-corrected t-test (Santer et al. 2000). A change is called “warming” or “cooling” only when p < 0.05; otherwise EarthScope says there is no clear trend yet. The statistics are covered by automated tests." },
  { icon: FlaskConical, title: "Transparent scenarios", text: "User-selected changes are applied linearly from {to} to {end}. These are educational scenarios, not CMIP6 output; the globe’s years after {to} extend observed trends and are flagged as such." },
  { icon: Sparkles, title: "Ask Earth", text: "Answers are written by an AI model (Claude, or a free open model) only from EarthScope’s NASA data and live feeds, with sources cited. When AI is unavailable, a rule-based guide answers from the same data." },
];/* /i18n */

export function DataDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, y } = useI18n();
  const vars = { from: y(RECORD_START), to: y(RECORD_END), end: y(SCENARIO_END) };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="info-dialog">
    <DialogHeader><span className="eyebrow">{t("BUILT ON EARTH SCIENCE")}</span><DialogTitle>{t("The story behind the data.")}</DialogTitle><DialogDescription>{t("Know what you’re looking at, and what it can tell you.")}</DialogDescription></DialogHeader>
    <div className="source-list">
      {SOURCES.map(s => <a key={s.title} href={s.href} target="_blank" rel="noreferrer"><s.icon/><div><strong>{t(s.title)}</strong><p>{t(s.text, vars)}</p></div><ExternalLink size={16}/></a>)}
      {NOTES.map(s => <div key={s.title}><s.icon/><div><strong>{t(s.title)}</strong><p>{t(s.text, vars)}</p></div></div>)}
    </div>
  </DialogContent></Dialog>;
}

export function StoryDialog({ open, onOpenChange, place, data, year, warming, rainChange, onSave, busy }: {
  open: boolean; onOpenChange: (v: boolean) => void; place: Place; data: ClimateData; year: number; warming: number; rainChange: number; onSave: () => void; busy: boolean;
}) {
  const { t, y, lang } = useI18n();
  const story = lang === "bn" ? climateStoryBn(place, data, year, warming, rainChange) : climateStory(place, data, year, warming, rainChange);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="story-dialog">
    <DialogHeader><span className="eyebrow">{t("YOUR CLIMATE STORY · {year}", { year: y(year) })}</span><DialogTitle>{t("{place}. A story still unfolding.", { place: place.name })}</DialogTitle><DialogDescription>{data.source} · {year > RECORD_END ? t("User-defined scenario") : t("{a}–{b} annual climate record", { a: y(data.annual[0]?.year), b: y(data.annual.at(-1)!.year) })}</DialogDescription></DialogHeader>
    <div className="story-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(place, "2025-01-20")} alt={t("Satellite view of {place}, 20 January 2025", { place: place.name })}/><span>{t("{place}, from a different perspective.", { place: place.name })}</span>
    </div>
    <p className="story-body">{story}</p>
    <h3>{t("A more resilient next chapter")}</h3>
    <div className="adaptation-grid">
      <div><Sprout/><strong>{t("Make room for green")}</strong><p>{t("Protect mature trees and prioritize shade around homes, schools, and walking routes.")}</p></div>
      <div><Waves/><strong>{t("Work with water")}</strong><p>{t("Keep drainage clear, protect wetlands, and follow locally informed water planning.")}</p></div>
      <div><ShieldCheck/><strong>{t("Prepare together")}</strong><p>{t("Use local early warnings and identify people who may need extra support during extremes.")}</p></div>
    </div>
    <button className="lime-button" onClick={onSave} disabled={busy}>{t("Keep this story")} <Download size={16}/></button>
  </DialogContent></Dialog>;
}
