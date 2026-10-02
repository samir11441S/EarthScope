"use client";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { PLACES, type Place } from "@/lib/climate";
import { useI18n } from "@/lib/i18n";

export function PlacePicker({ place, onChange, label = "Search any city or region" }: { place: Place; onChange: (p: Place) => void; label?: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(""), [remote, setRemote] = useState<Place[]>([]), [busy, setBusy] = useState(false), [searchError, setSearchError] = useState(false);
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setSearchError(false);
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!r.ok) throw new Error();
        const data = await r.json() as { results: Place[] };
        setRemote(data.results || []);
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const options = useMemo(() => {
    const local = PLACES.filter(p => `${p.name} ${p.country} ${p.region || ""}`.toLowerCase().includes(query.toLowerCase()));
    return [...local, ...remote.filter(p => !local.some(c => c.name === p.name && c.country === p.country))];
  }, [query, remote]);
  return <div className="location-search"><Search size={17}/>
    <Combobox items={options} value={place} onValueChange={p => { if (p) { onChange(p); setQuery(""); setRemote([]); } }} onInputValueChange={q => { setQuery(q); if (q.length < 2) { setRemote([]); setSearchError(false); setBusy(false); } }} itemToStringLabel={(p: Place) => `${p.name}, ${p.country}`} isItemEqualToValue={(a: Place, b: Place) => a.id === b.id} filter={null}>
      <ComboboxInput aria-label={t(label)} placeholder={t(label)} className="place-combobox"/>
      <ComboboxContent className="place-results">
        <div className="picker-heading">{query ? t("SEARCH RESULTS") : t("EXPLORE A PLACE")}</div>
        <ComboboxEmpty>{busy ? t("Searching the planet…") : searchError ? t("Search unavailable. Try one of the featured cities.") : t("No locations found. Try a nearby city.")}</ComboboxEmpty>
        <ComboboxList>{(p: Place) => <ComboboxItem key={p.id} value={p}><MapPin size={16}/><span>{p.name}<small>{p.region ? `${p.region}, ` : ""}{p.country}</small></span></ComboboxItem>}</ComboboxList>
        <div className="picker-credit">{t("Places by Open-Meteo / GeoNames")}</div>
      </ComboboxContent>
    </Combobox>
  </div>;
}
