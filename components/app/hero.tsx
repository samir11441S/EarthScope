"use client";
import { cloudDate } from "@/lib/clouds";
import { useEffect, useRef } from "react";

/** Decorative planet horizon behind every page heading, painted from NASA's own globe textures. */
export function HeroSky({ view, lang }: { view: string; lang: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Lower the horizon just enough that the planet's limb passes below/right of every heading line,
  // whatever the page title length, language or screen width.
  useEffect(() => {
    const sky = ref.current, heading = sky?.parentElement?.querySelector(".page-heading");
    if (!sky || !heading) return;
    const place = () => {
      const planet = sky.querySelector<HTMLElement>(".hero-planet");
      if (!planet) return;
      sky.style.removeProperty("--hero-top");
      const R = planet.offsetWidth / 2, cx = planet.offsetLeft + R, preferred = planet.offsetTop, box = sky.getBoundingClientRect();
      let needed = -Infinity;
      for (const el of heading.querySelectorAll("h1, p, .eyebrow")) {
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          const x = r.right - box.left + 28, y = r.bottom - box.top + 16, dx = Math.abs(cx - x);
          if (dx < R) needed = Math.max(needed, y - (R - Math.sqrt(R * R - dx * dx)));
        }
      }
      sky.style.setProperty("--hero-top", `${Math.round(Math.min(300, Math.max(preferred, needed)))}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(heading);
    ro.observe(sky);
    document.fonts?.ready.then(place).catch(() => {});
    return () => ro.disconnect();
  }, [view, lang]);
  return <div ref={ref} className="hero-sky" aria-hidden="true">
    <div className="hero-stars"/>
    <div className="hero-planet"><div className="hero-night"/><div className="hero-day"/><div className="hero-clouds" style={{ backgroundImage: `url(/api/clouds?date=${cloudDate()}), url(/textures/earth-clouds.jpg)` }}/><div className="hero-rim"/></div>
    <div className="hero-flare"/>
  </div>;
}

/** Headline with its last two words in the EarthScope blue gradient. */
export function Headline({ text }: { text: string }) {
  const words = text.split(" "), tail = words.splice(-2).join(" ");
  return <h1>{words.join(" ")} <span className="h1-accent">{tail}</span></h1>;
}
