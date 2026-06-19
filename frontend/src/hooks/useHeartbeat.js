/**
 * useHeartbeat — page-scoped activity tracker for Realm Pulse DAU.
 *
 * Contract (per product spec, Feb 19 2026):
 *   • Send a heartbeat only after 30 seconds of CONTINUOUS active time
 *     on the page.
 *   • Cap to one heartbeat every 5 minutes per user (client-side
 *     throttle; backend dedupes per-day via the unique index).
 *   • Ignore background tabs, blurred windows, minimised apps —
 *     `document.hidden` + window blur halts the timer.
 *   • No content, no message bodies, no PII ever transit this path —
 *     the POST body is just `{ kind: "<page>" }`.
 *
 * Usage in a page component:
 *     useHeartbeat("feed");
 *
 * The `kind` argument is a free-form tag for client-side diagnostics
 * only; the backend stores nothing about it. We pass it so future
 * debugging (or kill-switches) can be page-specific without breaking
 * the canonical DAU number.
 */
import { useEffect, useRef } from "react";
import apiClient from "@/api/client";

const CONTINUOUS_MS = 30 * 1000;        // 30s of foreground activity
const THROTTLE_MS   = 5 * 60 * 1000;    // 5min cap per browser tab
const STORAGE_KEY   = "ourrealm.lastHeartbeatAt";

function lastHeartbeatTs() {
  try { return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10) || 0; } catch { return 0; }
}
function markHeartbeat(ts) {
  try { localStorage.setItem(STORAGE_KEY, String(ts)); } catch { /* */ }
}

export default function useHeartbeat(kind = "page") {
  const accumulated = useRef(0);        // ms of foreground time since last ping
  const lastTick    = useRef(null);     // wall-clock at the most recent active tick
  const sentRef     = useRef(false);    // already pinged this mount cycle

  useEffect(() => {
    // Page-load: only start counting if visible & focused.
    let interval;

    const isActive = () =>
      typeof document !== "undefined" &&
      !document.hidden &&
      document.hasFocus();

    const tick = async () => {
      if (!isActive()) {
        lastTick.current = null;       // pause accumulation
        return;
      }
      const now = Date.now();
      if (lastTick.current != null) {
        accumulated.current += now - lastTick.current;
      }
      lastTick.current = now;

      if (accumulated.current >= CONTINUOUS_MS && !sentRef.current) {
        const last = lastHeartbeatTs();
        if (now - last >= THROTTLE_MS) {
          sentRef.current = true;
          markHeartbeat(now);
          try {
            await apiClient.post("/analytics/heartbeat", { kind });
          } catch { /* analytics never blocks UX */ }
        } else {
          // Within throttle window — still flip the flag so we don't
          // keep recomputing.
          sentRef.current = true;
        }
      }
    };

    // Foreground/background events reset the per-mount counter so a
    // user who comes back to the tab earns activity only after a
    // fresh 30s window of continuous attention.
    const reset = () => { lastTick.current = null; };
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("focus", () => { lastTick.current = Date.now(); });

    lastTick.current = isActive() ? Date.now() : null;
    interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("blur", reset);
    };
  }, [kind]);
}
