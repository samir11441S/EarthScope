import type { Metadata } from "next";
import ClimateApp from "@/components/app/shell";

export const metadata: Metadata = { title: "My climate reports · EarthScope", description: "Bilingual (English / বাংলা) climate reports built from NASA data, for citizens, students and planners.", alternates: { canonical: "/reports" } };
export default function ReportsPage() { return <ClimateApp initialView="reports" />; }
