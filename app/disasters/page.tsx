import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "Live disasters · EarthScope", description: "Live storms, floods, earthquakes and fires from NASA, GDACS and USGS, with heat and air-quality warnings and the safer places nearby.", alternates: { canonical: "/disasters" } };
export default function DisastersPage() { return <ClimateApp initialView="disasters" />; }
