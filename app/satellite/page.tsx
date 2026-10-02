import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "Satellite comparison · EarthScope", description: "Measured change from NASA satellites: land cover, vegetation, surface heat and like-for-like Landsat and Sentinel-2 imagery.", alternates: { canonical: "/satellite" } };
export default function SatellitePage() { return <ClimateApp initialView="satellite" />; }
