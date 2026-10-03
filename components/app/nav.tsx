"use client";
import { ArrowUpRight, BookOpen, CircleHelp, Compass, Earth, FileText, FlaskConical, Globe2, Layers3, Siren, Sprout } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useI18n } from "@/lib/i18n";

export type View = "explore" | "disasters" | "atlas" | "satellite" | "future" | "compare" | "reports";

/** Every page has its own address, so the back button, refresh and shared links all work. */
export const VIEW_PATH: Record<View, string> = {
  explore: "/", disasters: "/disasters", atlas: "/atlas", satellite: "/satellite", future: "/future", compare: "/compare", reports: "/reports",
};
export const viewFromPath = (path: string): View =>
  (Object.entries(VIEW_PATH).find(([, p]) => p !== "/" && path.replace(/\/$/, "") === p)?.[0] as View) ?? "explore";

/* i18n */export const NAV: { id: View; title: string; icon: typeof Compass; badge?: string }[] = [
  { id: "explore", title: "Earth explorer", icon: Compass },
  { id: "disasters", title: "Live disasters", icon: Siren, badge: "LIVE" },
  { id: "atlas", title: "Climate atlas", icon: Earth, badge: "MAPS" },
  { id: "satellite", title: "Satellite comparison", icon: Layers3 },
  { id: "future", title: "Future scenarios", icon: FlaskConical, badge: "LAB" },
  { id: "compare", title: "Compare places", icon: Globe2 },
  { id: "reports", title: "My climate reports", icon: FileText },
];/* /i18n */

/* i18n */export const HEADINGS: Record<View, [string, string]> = {
  explore: ["Every place has a climate story.", "Travel through time. Understand your world. Imagine what comes next."],
  disasters: ["The planet, right now.", "Live storms, floods, earthquakes and fires from NASA, GDACS and USGS — and the safer places around you."],
  atlas: ["Every country. Every state. Every year.", "Zoom from the whole Earth into a country and its states, and watch 45 years of NASA climate data unfold."],
  satellite: ["See change with your own eyes.", "Measured change from NASA satellites: land cover, vegetation, surface heat and like-for-like imagery."],
  future: ["The future is a possibility.", "Change the assumptions, and see what IPCC projections say about sea level."],
  compare: ["Different places. One planet.", "Put two climate histories side by side to see the bigger picture."],
  reports: ["Your planet, on the record.", "Keep your discoveries close. Saved reports stay in this browser."],
};/* /i18n */

export function AppNav({ view, navigate, onData }: { view: View; navigate: (v: View) => void; onData: () => void }) {
  const { setOpenMobile } = useSidebar();
  const { t } = useI18n();
  const go = (v: View) => { setOpenMobile(false); navigate(v); };
  return <Sidebar className="app-sidebar">
    <SidebarHeader className="brand"><span className="brand-symbol"><Globe2 size={29} strokeWidth={1.3}/></span><div>Earth<b>Scope</b><span>{t("CLIMATE TIME MACHINE")}</span></div></SidebarHeader>
    <SidebarContent className="nav-content">
      <p className="nav-caption">{t("YOUR PLANET, THROUGH TIME")}</p>
      <SidebarMenu>{NAV.map(item => <SidebarMenuItem key={item.id}>
        {/* Real links (open in a new tab works) that navigate in place on a normal click. */}
        <SidebarMenuButton asChild isActive={view === item.id} className="nav-button">
          <a href={VIEW_PATH[item.id]} aria-current={view === item.id ? "page" : undefined} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(item.id); }}>
            <item.icon size={18}/><span>{t(item.title)}</span>{item.badge && <b>{t(item.badge)}</b>}
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>)}</SidebarMenu>
      <div className="nav-divider"/>
      <p className="nav-caption">{t("THE BIGGER PICTURE")}</p>
      <button className="nav-secondary" onClick={onData}><BookOpen size={18}/> {t("About the data")} <ArrowUpRight size={14}/></button>
      <div className="planet-note"><div className="note-orbit"><Sprout size={23}/></div><p>{t("One planet.")}<br/><strong>{t("Endless perspectives.")}</strong></p><span>{t("A little understanding can make a world of difference.")}</span><button onClick={() => go("future")}>{t("Explore what’s possible")} <ArrowUpRight size={15}/></button></div>
    </SidebarContent>
    <SidebarFooter className="sidebar-bottom"><span className="nasa-small">NASA</span><p>{t("Powered by Earth science")}<small>{t("Built for the curious.")}</small></p><button aria-label={t("About EarthScope")} onClick={onData}><CircleHelp size={16}/></button></SidebarFooter>
  </Sidebar>;
}
