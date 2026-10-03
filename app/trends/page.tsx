import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "Trend Lab · EarthScope", description: "Be an Earth system trend detective: what is changing, where, how much and whether it is significant, in NASA climate-model and satellite data.", alternates: { canonical: "/trends" } };
export default function TrendsPage() { return <ClimateApp initialView="trends" />; }
