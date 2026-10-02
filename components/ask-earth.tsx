"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, Copy, Globe2, LoaderCircle, MapPin, RotateCcw, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { calculateTrend, trendVerdict, type ClimateData, type Place } from "@/lib/climate";

type Mode = "ai" | "offline";
type AskEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "done"; followUps: string[]; citations: string[]; mode: Mode; note?: string; provider?: string }
  | { type: "error"; message: string };

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  followUps?: string[];
  citations?: string[];
  mode?: Mode;
  note?: string;
  status?: string;
  streaming?: boolean;
  failed?: boolean;
}

// ---------- tiny, safe renderer for the markdown subset Ask Earth uses ----------
function inline(str: string): ReactNode[] {
  // **bold** and bare https:// links; everything else is plain text (React escapes it).
  return str.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\//, "").slice(0, 48)}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function FormattedMessage({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      {text.split("\n").map((line, idx) => {
        const t = line.trim();
        if (!t) return <div key={idx} className="chat-md-spacer" />;
        if (t.startsWith("### ")) return <h4 key={idx} className="chat-md-h4">{inline(t.slice(4))}</h4>;
        if (t.startsWith("> ")) return <p key={idx} className="chat-md-note">{inline(t.slice(2))}</p>;
        if (/^\*[^*\s].*[^*\s]\*$/.test(t)) return <p key={idx} className="chat-md-p"><em>{inline(t.slice(1, -1))}</em></p>;
        const num = t.match(/^(\d+)[.)]\s+(.*)$/);
        if (num) return <div key={idx} className="chat-md-bullet"><span className="bullet-num">{num[1]}.</span><span>{inline(num[2])}</span></div>;
        if (/^[*•-]\s/.test(t)) return <div key={idx} className="chat-md-bullet"><span className="bullet-dot">•</span><span>{inline(t.replace(/^[*•-]\s*/, ""))}</span></div>;
        return <p key={idx} className="chat-md-p">{inline(t)}</p>;
      })}
    </div>
  );
}

export default function AskEarth({ open, onOpenChange, place, data, year, warming, rainChange }: {
  open: boolean; onOpenChange: (v: boolean) => void; place: Place; data: ClimateData; year: number; warming: number; rainChange: number;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null), [provider, setProvider] = useState<string | null>(null);
  const isClaude = provider === "Claude AI";
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const trend = calculateTrend(data.annual);

  // A new place starts a new conversation.
  const [placeId, setPlaceId] = useState(place.id);
  if (placeId !== place.id) { setPlaceId(place.id); setMessages([]); }

  useEffect(() => {
    if (!open || aiAvailable !== null) return;
    fetch("/api/ask").then(r => r.json() as Promise<{ ai?: boolean; provider?: string | null }>).then(j => { setAiAvailable(!!j.ai); setProvider(j.provider ?? null); }).catch(() => setAiAvailable(false));
  }, [open, aiAvailable]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (m: ChatMessage) => ChatMessage) => setMessages(ms => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || answering) return;
    const history = messages.filter(m => !m.failed && m.text.trim()).map(m => ({ role: m.role, text: m.text }));
    setMessages(m => [...m, { role: "user", text: q }, { role: "assistant", text: "", streaming: true, status: "Reading EarthScope's NASA data…" }]);
    setQuestion("");
    setAnswering(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ question: q, history, place, year, warming, rainChange, data }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error || "Request failed");
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AskEvent;
          if (e.type === "text") patchLast(m => ({ ...m, text: m.text + e.delta, status: undefined }));
          else if (e.type === "status") patchLast(m => ({ ...m, status: e.text }));
          else if (e.type === "done") { patchLast(m => ({ ...m, streaming: false, status: undefined, followUps: e.followUps, citations: e.citations, mode: e.mode, note: e.note })); if (e.provider) setProvider(e.provider); setAiAvailable(v => v ?? e.mode === "ai"); }
          else if (e.type === "error") patchLast(m => ({ ...m, streaming: false, status: undefined, note: e.message, failed: !m.text }));
        }
      }
      patchLast(m => (m.streaming ? { ...m, streaming: false, status: undefined } : m));
    } catch (err) {
      const stopped = controller.signal.aborted;
      patchLast(m => ({
        ...m, streaming: false, status: undefined, failed: !m.text,
        text: m.text || (stopped ? "" : "I couldn't reach the Earth guide just now. Your climate story and observations are still available in the explorer. Please try again."),
        note: stopped ? "Stopped." : err instanceof Error && err.message !== "Request failed" ? err.message : undefined,
      }));
    } finally {
      setAnswering(false);
      abortRef.current = null;
    }
  };

  const starters = [
    { icon: "🔍", label: "Trend detective", q: `Is ${place.name} really warming? Show me the evidence.` },
    { icon: "🚨", label: "Live hazards", q: `Are there any active disasters or cyclones near ${place.name} right now?` },
    { icon: "🛡️", label: "Safe places", q: `Where are the nearest safe shelters and hospitals in ${place.name}?` },
    { icon: "🌍", label: "Global vs local", q: `How does ${place.name} compare with global warming?` },
    { icon: "⚖️", label: "Compare", q: `Compare ${place.name} with ${place.id === "khulna" ? "Dhaka" : "Khulna"}, Bangladesh.` },
    { icon: "🌧️", label: "Floods & rain", q: `Is rainfall changing in ${place.name}, and what does that mean for floods?` },
    { icon: "❄️", label: "Arctic & sea ice", q: "Why is the Arctic warming faster than the rest of the planet?" },
    { icon: "🔮", label: "2050 outlook", q: `What could ${place.name} be like by 2050?` },
    { icon: "🇧🇩", label: "বাংলায়", q: `${place.name}-এর জলবায়ু কীভাবে বদলাচ্ছে? সহজ ভাষায় বলুন।` },
  ];
  const modeLabel = aiAvailable === null ? "Grounded in NASA data" : aiAvailable ? `${provider ?? "AI"} · grounded in EarthScope's NASA data & live feeds` : "Offline guide · rule-based answers from NASA data";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="chat-sheet">
        <SheetHeader>
          <div className="chat-sheet-header-row">
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="chat-earth-icon"><Globe2 size={24} /></span>
              <div><SheetTitle>Ask Earth</SheetTitle><SheetDescription className={`chat-mode ${aiAvailable ? "is-ai" : ""}`}>{modeLabel}</SheetDescription></div>
            </div>
            {messages.length > 0 && <button className="chat-clear-btn" onClick={() => { abortRef.current?.abort(); setMessages([]); }} title="Start a new conversation"><RotateCcw size={12} /> New chat</button>}
          </div>
        </SheetHeader>
        <div className="chat-context"><MapPin size={14} /><span><strong>{place.name}</strong>, {place.country}</span><span>Year {year} · {trendVerdict(trend).toLowerCase()}</span></div>
        <div className="chat-categories">
          {starters.map(c => <button key={c.label} className="chat-category-btn" onClick={() => ask(c.q)} disabled={answering}><span>{c.icon}</span><span>{c.label}</span></button>)}
        </div>
        <div className="chat-messages" aria-live="polite">
          {!messages.length && (
            <div className="chat-welcome">
              <Sparkles size={25} />
              <h3>Ask Earth anything</h3>
              <p>Ask about {place.name}&apos;s climate record, live disasters and safe places nearby, or the global picture. {aiAvailable ? (isClaude ? "Answers are written by Claude" : "Answers are written by a free open AI model") + " using only EarthScope's NASA data and live agency feeds, and it remembers the conversation." : "Answers are computed from EarthScope's NASA data."} You can ask in English or বাংলা.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                {[`Is ${place.name} really getting hotter?`, `Is anything dangerous happening near ${place.name} right now?`, `What can my neighbourhood do to cope with heat and floods?`].map(q => <button key={q} onClick={() => ask(q)}><span>{q}</span><ArrowUpRight size={14} /></button>)}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              {m.role === "assistant" && <span><Sparkles size={13} /> EARTH GUIDE{m.mode && <em className={`chat-mode-tag ${m.mode}`}>{m.mode === "ai" ? "AI" : "OFFLINE"}</em>}</span>}
              {m.role === "assistant" ? (m.text ? <FormattedMessage text={m.text} /> : null) : <p>{m.text}</p>}
              {m.streaming && <div className="chat-status"><LoaderCircle size={14} className="spin" /><span>{m.status ?? "Writing…"}</span></div>}
              {m.note && <p className="chat-note">{m.note}</p>}
              {m.role === "assistant" && !m.streaming && m.text && (
                <div className="chat-message-footer">
                  <button className="chat-copy-btn" onClick={() => { navigator.clipboard.writeText(m.text); toast.success("Answer copied to clipboard"); }} title="Copy answer"><Copy size={12} /> Copy</button>
                  {!!m.citations?.length && <details className="chat-sources"><summary><BookOpen size={12} /> Sources</summary><ul>{m.citations.map(c => <li key={c}>{c}</li>)}</ul></details>}
                </div>
              )}
              {m.role === "assistant" && !m.streaming && !!m.followUps?.length && i === messages.length - 1 && (
                <div className="chat-followup-container">
                  <span className="chat-followup-title">Explore further</span>
                  {m.followUps.map(fu => <button key={fu} className="chat-followup-btn" onClick={() => ask(fu)} disabled={answering}><span>{fu}</span><ArrowUpRight size={13} /></button>)}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="chat-form" onSubmit={e => { e.preventDefault(); ask(question); }}>
          <input aria-label="Ask a climate question" placeholder={`Ask about ${place.name}, live hazards, or climate…`} value={question} maxLength={1000} onChange={e => setQuestion(e.target.value)} />
          {answering
            ? <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop answer" className="chat-stop"><Square size={15} /></button>
            : <button disabled={!question.trim()} aria-label="Send question"><ArrowUpRight size={19} /></button>}
        </form>
        <p className="chat-disclaimer">{aiAvailable ? `AI answers can still be wrong — check key facts.${isClaude ? "" : " Questions are sent to the free AI service; don't include personal details."} ` : ""}Grounded in NASA POWER, GISTEMP, NSIDC, NOAA and live EONET · GDACS · USGS feeds. Not an official warning service — in an emergency call 999 (Bangladesh) or your local number.</p>
      </SheetContent>
    </Sheet>
  );
}
