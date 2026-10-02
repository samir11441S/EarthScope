// Privacy-friendly error reporting: unexpected errors are sent to EarthScope's own /api/log endpoint
// (visible in the hosting provider's function logs) — no third-party tracker, no cookies, no
// personal data. Messages are truncated and URLs are stripped of query strings.
const seen = new Set<string>();
let sent = 0;
const MAX_PER_SESSION = 20;

function clean(s: unknown, max = 500) {
  return String(s ?? "").replace(/https?:\/\/[^\s)]+/g, u => u.split("?")[0]).slice(0, max);
}

export function reportError(error: unknown, context = "client") {
  if (typeof window === "undefined" || sent >= MAX_PER_SESSION) return;
  const e = error instanceof Error ? error : new Error(clean(error));
  // Ignore noise from browser extensions and aborted requests.
  const text = `${e.message} ${e.stack ?? ""}`.toLowerCase();
  if (/extension:\/\/|metamask|inpage\.js|aborterror|the user aborted|resizeobserver loop/.test(text)) return;
  const key = `${context}:${e.message}`;
  if (seen.has(key)) return;
  seen.add(key);
  sent++;
  const body = JSON.stringify({ context: clean(context, 60), message: clean(e.message), stack: clean(e.stack, 1500), page: location.pathname, at: new Date().toISOString() });
  try {
    if (!navigator.sendBeacon?.("/api/log", new Blob([body], { type: "application/json" }))) fetch("/api/log", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  } catch { /* never let reporting break the app */ }
}

let installed = false;
/** Report uncaught errors and unhandled promise rejections once per page load. */
export function installErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", ev => reportError(ev.error ?? ev.message, "window.onerror"));
  window.addEventListener("unhandledrejection", ev => reportError(ev.reason, "unhandledrejection"));
}
