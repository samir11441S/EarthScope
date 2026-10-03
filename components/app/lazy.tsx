"use client";
// Heavy features load on demand, so the first page view downloads only what it shows:
// three.js (globe), Leaflet (maps), the report viewer, Ask Earth and the satellite tools are
// separate chunks fetched the first time they are needed.
import { lazy, Suspense, type ComponentType } from "react";
import { LoaderCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

function Loading({ label, className = "lazy-loading" }: { label: string; className?: string }) {
  const { t } = useI18n();
  return <div className={className} role="status"><LoaderCircle className="spin" size={20}/><span>{t(label)}</span></div>;
}

function withSuspense<P extends object>(Comp: ComponentType<P>, label: string, className?: string) {
  const Wrapped = (props: P) => <Suspense fallback={<Loading label={label} className={className}/>}><Comp {...props}/></Suspense>;
  return Wrapped;
}

/* i18n */
export const EarthGlobe = withSuspense(lazy(() => import("../earth-globe")), "Loading the 3D Earth…", "lazy-loading lazy-globe");
export const DisasterMap = withSuspense(lazy(() => import("../disaster-map")), "Loading the live disaster map…", "lazy-loading lazy-panel");
export const TrendLab = withSuspense(lazy(() => import("../trend-lab")), "Loading the Trend Lab…", "lazy-loading lazy-panel");
export const ClimateAtlas = withSuspense(lazy(() => import("../climate-atlas")), "Loading the climate atlas…", "lazy-loading lazy-panel");
export const SatelliteComparison = withSuspense(lazy(() => import("../satellite-compare")), "Loading satellite imagery…", "lazy-loading lazy-card");
export const AskEarth = withSuspense(lazy(() => import("../ask-earth")), "Loading Ask Earth…", "lazy-loading lazy-hidden");
export const ClimateReport = withSuspense(lazy(() => import("../climate-report")), "Preparing your report…", "lazy-loading lazy-overlay");
export const SeaLevelPanel = withSuspense(lazy(() => import("../sea-level")), "Loading sea-level projections…", "lazy-loading lazy-panel");
/* /i18n */
