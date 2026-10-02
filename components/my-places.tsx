"use client";
import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Copy, Package, Plus, Share2, X } from "lucide-react";
import { toast } from "sonner";
import type { Hazard } from "@/lib/hazards";
import type { HeatDay, HeatOutlook } from "@/lib/heat";
import {
  alertsEnabled, loadPack, loadSavedPlaces, newAlerts, notify, packText, placeStatus, setAlertsEnabled, storePack, storeSavedPlaces,
  type SafetyPack, type SavedPlace,
} from "@/lib/safety-watch";

const LEVEL_TEXT = { danger: "Danger", caution: "Caution", clear: "Clear" } as const;
const NAMES = ["Home", "Work", "School", "Family"];

export default function MyPlaces({ hazards, feedReady, me, pack, onCheck }: {
  hazards: Hazard[]; feedReady: boolean; me: { lat: number; lon: number; label: string } | null; pack: SafetyPack | null; onCheck: (p: SavedPlace) => void;
}) {
  const [places, setPlaces] = useState<SavedPlace[]>(() => (typeof window === "undefined" ? [] : loadSavedPlaces()));
  const [heat, setHeat] = useState<Record<string, HeatDay[]>>({});
  const [alertsOn, setAlertsOn] = useState(() => typeof window !== "undefined" && alertsEnabled());
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [showPack, setShowPack] = useState(false);
  const [banner, setBanner] = useState<{ place: SavedPlace; message: string }[]>([]);
  const [name, setName] = useState("Home");
  // The latest check; if it could not reach the shelter search, keep shelters from the last good check of the same spot.
  const merged = useMemo(() => {
    if (!pack || typeof window === "undefined") return pack;
    const prev = loadPack();
    const same = prev && Math.abs(prev.lat - pack.lat) < 1e-3 && Math.abs(prev.lon - pack.lon) < 1e-3;
    return !pack.shelters.length && same && prev.shelters.length ? { ...pack, shelters: prev.shelters } : pack;
  }, [pack]);
  const stored = useMemo(() => merged ?? (typeof window === "undefined" ? null : loadPack()), [merged]);

  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // Heat outlook for every saved place (one request), refreshed every 30 minutes.
  const pointsKey = places.map(p => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join(";");
  useEffect(() => {
    if (!pointsKey) return;
    let active = true;
    const run = () => fetch(`/api/heat?points=${pointsKey}`).then(r => r.json() as Promise<{ outlooks?: HeatOutlook[] }>).then(j => {
      if (!active || !j.outlooks) return;
      const ids = loadSavedPlaces().map(p => p.id);
      setHeat(Object.fromEntries(j.outlooks.map((o, i) => [ids[i], o.days])));
    }).catch(() => {});
    queueMicrotask(run);
    const t = setInterval(run, 30 * 60_000);
    return () => { active = false; clearInterval(t); };
  }, [pointsKey]);

  const statuses = useMemo(() => places.map(p => placeStatus(p, hazards, heat[p.id])), [places, hazards, heat]);

  // Alert once per new threat: in-app banner always, system notification when alerts are on.
  useEffect(() => {
    if (!feedReady || !statuses.length) return;
    const fresh = newAlerts(statuses);
    if (!fresh.length) return;
    queueMicrotask(() => setBanner(b => [...fresh, ...b].slice(0, 5)));
    if (alertsOn) for (const a of fresh) void notify(`EarthScope alert — ${a.place.name}`, a.message);
  }, [statuses, feedReady, alertsOn]);

  // Keep the latest safety check on the device for offline use.
  useEffect(() => { if (merged) storePack(merged); }, [merged]);

  const save = () => {
    if (!me) return;
    const label = name.trim() || "My place";
    const next = [...places.filter(p => p.name !== label), { id: `${Date.now()}`, name: label, lat: +me.lat.toFixed(5), lon: +me.lon.toFixed(5) }].slice(-6);
    setPlaces(next); storeSavedPlaces(next);
    toast.success(`Saved "${label}". EarthScope will watch it while open.`);
  };
  const remove = (id: string) => { const next = places.filter(p => p.id !== id); setPlaces(next); storeSavedPlaces(next); };
  const toggleAlerts = async () => {
    if (alertsOn) { setAlertsEnabled(false); setAlertsOn(false); return; }
    if (typeof Notification === "undefined") { toast.error("This browser does not support notifications."); return; }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast.error("Notifications were not allowed. You can enable them in the browser's site settings."); return; }
    setAlertsEnabled(true); setAlertsOn(true);
    void notify("EarthScope alerts are on", places.length ? `Watching ${places.map(p => p.name).join(", ")}.` : "Save a place to be alerted about it.");
  };
  const share = async (p: SafetyPack) => {
    const text = packText(p);
    try { if (navigator.share) { await navigator.share({ title: "EarthScope safety pack", text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); toast.success("Safety pack copied — paste it into SMS or a messaging app."); } catch { toast.error("Could not copy."); }
  };

  return (
    <div className="my-places">
      <div className="my-places-head">
        <h4>My places</h4>
        <button className={`alert-toggle${alertsOn ? " on" : ""}`} onClick={toggleAlerts} title="Notify me when a hazard zone, cyclone forecast or dangerous heat reaches a saved place">
          {alertsOn ? <Bell size={13} /> : <BellOff size={13} />} {alertsOn ? "Alerts on" : "Turn on alerts"}
        </button>
        <button className={`alert-toggle${showPack || !online ? " on" : ""}`} onClick={() => setShowPack(v => !v)} title="Your last safety check, kept on this device for when the network is down"><Package size={13} /> Safety pack</button>
      </div>

      {banner.map((b, i) => (
        <div key={i} className="alert-banner"><strong>{b.place.name}:</strong> {b.message}<button onClick={() => setBanner(x => x.filter((_, j) => j !== i))} aria-label="Dismiss"><X size={12} /></button></div>
      ))}

      {!!statuses.length && <div className="place-chips">
        {statuses.map(s => (
          <span key={s.place.id} className={`place-chip lv-${s.level}`} title={s.messages.join("\n") || "No current or forecast hazard"}>
            <button onClick={() => onCheck(s.place)}><i />{s.place.name} · {LEVEL_TEXT[s.level]}</button>
            <button onClick={() => remove(s.place.id)} aria-label={`Remove ${s.place.name}`}><X size={11} /></button>
          </span>
        ))}
      </div>}

      {me && !places.some(p => Math.abs(p.lat - me.lat) < 1e-4 && Math.abs(p.lon - me.lon) < 1e-4) && (
        <div className="save-place">
          <span>Save this location as</span>
          <select value={name} onChange={e => setName(e.target.value)} aria-label="Place name">{NAMES.map(n => <option key={n}>{n}</option>)}</select>
          <button onClick={save}><Plus size={12} /> Save</button>
        </div>
      )}
      {!places.length && !me && <p className="hz-note">Check a location below, then save it as Home, Work or School — EarthScope will alert you if a hazard zone, a cyclone forecast or dangerous heat reaches it.</p>}
      {alertsOn && <p className="hz-note">Alerts are checked every 5 minutes while EarthScope is open in a tab or installed as an app.</p>}

      {(showPack || !online) && (stored ? (
        <div className="safety-pack">
          <h4>{!online && <span className="offline-badge">OFFLINE</span>} Safety pack — {stored.label}</h4>
          <p className="hz-note">Saved {new Date(stored.savedAt).toLocaleString()}. {online ? "Updated each time you run a safety check." : "Shown from this device; live data needs a connection."}</p>
          <pre>{packText(stored)}</pre>
          <div className="pack-actions">
            <button className="outline-button" onClick={() => share(stored)}><Share2 size={13} /> Share</button>
            <button className="outline-button" onClick={async () => { try { await navigator.clipboard.writeText(packText(stored)); toast.success("Copied"); } catch { toast.error("Could not copy."); } }}><Copy size={13} /> Copy</button>
          </div>
        </div>
      ) : <p className="hz-note">No safety pack yet — run a safety check (use your location or pick a place) and it will be saved here for offline use.</p>)}
    </div>
  );
}
