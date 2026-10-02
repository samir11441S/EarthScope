import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "Compare places · EarthScope", description: "Put two NASA climate records side by side, with honest trend statistics.", alternates: { canonical: "/compare" } };
export default function ComparePage() { return <ClimateApp initialView="compare" />; }
