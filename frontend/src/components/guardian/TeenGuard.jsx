import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock, Clock } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

// TeenGuard — mounted once in App. For teen accounts it:
// 1. Sends a foreground-only heartbeat (~60s) for screen-time tracking.
// 2. Polls /guardian/my-limits and shows a full-screen lock overlay when
//    the account is blocked (manual lock / schedule / bedtime / time).
// Backend enforces everything independently; this shapes the UX.
export default function TeenGuard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [limits, setLimits] = useState(null);
  const timerRef = useRef(null);

  const tick = useCallback(async () => {
    if (document.visibilityState !== "visible") return; // no background counting
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      await apiClient.post("/guardian/heartbeat", { timezone: tz, visible: true });
      const { data } = await apiClient.get("/guardian/my-limits");
      setLimits(data);
    } catch { /* fail open visually; backend still enforces */ }
  }, []);

  useEffect(() => {
    if (!user || (user.age_class || "adult") !== "teen") { setLimits(null); return; }
    tick();
    timerRef.current = setInterval(tick, 60000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timerRef.current); document.removeEventListener("visibilitychange", onVis); };
  }, [user, tick]);

  if (!user || (user.age_class || "adult") !== "teen" || !limits?.is_teen) return null;
  if (!limits.blocked || location.pathname === "/my-limits") return null;

  const nextAt = limits.next_available_at
    ? new Date(limits.next_available_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(4,10,18,0.96)", backdropFilter: "blur(10px)" }}
      data-testid="teen-lock-screen">
      <div className="or-surface p-8 max-w-md w-full text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "rgba(46,160,255,0.15)" }}>
          <Lock size={28} style={{ color: "var(--brand-blue)" }} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-display)" }}>
          Time for a break
        </h1>
        <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }} data-testid="teen-lock-message">
          This account is currently unavailable based on your parent settings.
        </p>
        {nextAt && (
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full mb-4"
            style={{ background: "rgba(16,230,112,0.1)", color: "var(--brand-green, #10E670)" }}
            data-testid="teen-lock-next-available">
            <Clock size={13} /> Available again: {nextAt}
          </div>
        )}
        <div>
          <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-blue)", color: "#fff" }}
            onClick={() => navigate("/my-limits")} data-testid="teen-lock-mylimits-btn">
            View My Limits
          </button>
        </div>
      </div>
    </div>
  );
}
