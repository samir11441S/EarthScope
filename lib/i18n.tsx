"use client";
// EarthScope interface language (English / বাংলা).
// Strings are keyed by their English text, so components stay readable and any phrase without a
// translation simply falls back to English. Numbers and years use Bangla digits in Bangla.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BN } from "./i18n-bn";

export type UiLang = "en" | "bn";
type Vars = Record<string, string | number>;
interface I18n {
  lang: UiLang;
  setLang: (l: UiLang) => void;
  /** Translate an English UI string; {name} placeholders are filled from `vars`. */
  t: (en: string, vars?: Vars) => string;
  /** Format a number (grouping on) in the interface language. */
  n: (v: number, decimals?: number) => string;
  /** Format a year or any digit string (no grouping). */
  y: (v: number | string) => string;
}

const KEY = "earthscope-lang";
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const toBnDigits = (s: string) => s.replace(/\d/g, d => BN_DIGITS[+d]);

function fill(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

export function makeI18n(lang: UiLang, setLang: (l: UiLang) => void = () => {}): I18n {
  const bn = lang === "bn";
  return {
    lang, setLang,
    t: (en, vars) => fill(bn ? BN[en] ?? en : en, vars),
    n: (v, d = 0) => v.toLocaleString(bn ? "bn-BD" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
    y: v => (bn ? toBnDigits(String(v)) : String(v)),
  };
}

const Ctx = createContext<I18n>(makeI18n("en"));

export function LangProvider({ children }: { children: ReactNode }) {
  // Start in English for a stable first render, then apply the saved (or browser) preference.
  const [lang, setLangState] = useState<UiLang>("en");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    const preferred = saved === "bn" || saved === "en" ? saved : navigator.language?.toLowerCase().startsWith("bn") ? "bn" : "en";
    if (preferred !== "en") queueMicrotask(() => setLangState(preferred));
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: UiLang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => makeI18n(lang, setLang), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
