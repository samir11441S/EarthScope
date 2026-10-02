import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "Climate atlas · EarthScope", description: "Every country, state and district, year by year, from 45 years of NASA POWER climate data.", alternates: { canonical: "/atlas" } };
export default function AtlasPage() { return <ClimateApp initialView="atlas" />; }
