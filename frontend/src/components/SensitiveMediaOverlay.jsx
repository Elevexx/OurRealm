/**
 * SensitiveMediaOverlay — viewer-facing blur/warning wrapper for post media.
 *
 * Rules:
 *  - Uploader always sees their own content normally (no blur, no chip).
 *  - Manual admin blur ALWAYS blurs for other users (prefs can't override).
 *  - Otherwise the viewer's Safety & Content Preferences decide:
 *    show / blur (default) / hide.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import apiClient from "@/api/client";

let _prefsPromise = null;
export function getSafetyPrefs() {
  if (!_prefsPromise) {
    _prefsPromise = apiClient
      .get("/me/safety-preferences")
      .then((r) => r.data?.preferences || {})
      .catch(() => ({}));
  }
  return _prefsPromise;
}
export function resetSafetyPrefsCache() { _prefsPromise = null; }

const GROUP = {
  nudity_sexual: "adult_sexual",
  sexual: "adult_sexual",
  violence: "violent",
  threats_violence: "violent",
  weapons: "violent",
  self_harm: "violent",
  hate: "violent",
  medical: "medical",
};

const LABELS = {
  graphic: "graphic or mature material",
  nudity_sexual: "nudity or sexual content",
  violence: "violent content",
  medical: "sensitive medical content",
  disturbing: "disturbing content",
  self_harm: "sensitive content",
  hate: "sensitive content",
  custom: "sensitive material",
};

export default function SensitiveMediaOverlay({ safetyView, children, testid }) {
  const [prefs, setPrefs] = useState(null);
  const active = !!(safetyView && !safetyView.is_uploader);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (active) getSafetyPrefs().then(setPrefs);
  }, [active]);

  if (!active) return children;

  const category = safetyView.category || "graphic";
  const group = GROUP[category] || "graphic";
  const pref = prefs?.[group] || "blur";

  // "Show normally" preference — honoured unless an admin manually blurred it.
  if (pref === "show" && !safetyView.manual && !revealed) return children;

  if (revealed) {
    return (
      <div className="relative" data-testid={testid ? `${testid}-revealed` : undefined}>
        {children}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setRevealed(false); }}
          className="absolute top-2 right-2 or-chip"
          style={{ background: "rgba(0,0,0,0.6)", color: "#fff", zIndex: 5 }}
          data-testid={testid ? `${testid}-hide-again` : undefined}
        >
          <EyeOff size={12} /> Hide
        </button>
      </div>
    );
  }

  const label = LABELS[category] || "graphic or mature material";
  const message = safetyView.message || `This post may contain ${label}.`;

  if (pref === "hide" && !safetyView.manual) {
    return (
      <div
        className="mb-3 p-5 flex flex-col items-center justify-center text-center gap-2"
        style={{ borderRadius: "var(--radius)", border: "1px dashed var(--border-col)", background: "var(--surface-2, rgba(255,255,255,0.03))" }}
        data-testid={testid ? `${testid}-hidden` : undefined}
      >
        <EyeOff size={18} style={{ color: "var(--text-muted)" }} />
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          Hidden by your content preferences.
        </div>
        <button
          type="button"
          className="or-chip"
          onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
          data-testid={testid ? `${testid}-show-once` : undefined}
        >
          <Eye size={12} /> Show once
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden mb-3"
      style={{ borderRadius: "var(--radius)" }}
      data-testid={testid || undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ filter: "blur(28px)", pointerEvents: "none", transform: "scale(1.06)" }} aria-hidden>
        {children}
      </div>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center"
        style={{ background: "rgba(0,0,0,0.55)", zIndex: 4 }}
      >
        <AlertTriangle size={22} style={{ color: "#FFC94D" }} />
        <div className="text-sm font-semibold" style={{ color: "#fff" }}>
          Sensitive Content
        </div>
        <div className="text-xs max-w-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
          {message}
        </div>
        <button
          type="button"
          className="or-chip mt-1"
          style={{ background: "rgba(255,255,255,0.14)", color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}
          onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
          data-testid={testid ? `${testid}-view-content` : undefined}
        >
          <Eye size={12} /> View Content
        </button>
      </div>
    </div>
  );
}
