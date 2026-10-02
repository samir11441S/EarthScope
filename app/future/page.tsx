import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "Future scenarios · EarthScope", description: "Explore what-if warming and rainfall changes, and IPCC AR6 sea-level projections next to your ground height.", alternates: { canonical: "/future" } };
export default function FuturePage() { return <ClimateApp initialView="future" />; }
