/**
 * SafetyPreferences — Settings → Safety & Content Preferences.
 * Per-category show / blur / hide. Never overrides admin enforcement.
 */
import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import apiClient from "@/api/client";
import { resetSafetyPrefsCache } from "@/components/SensitiveMediaOverlay";

const ROWS = [
  { key: "graphic", label: "Graphic Content", hint: "Blood, injuries, hunting, accidents" },
  { key: "adult_sexual", label: "Adult or Sexually Suggestive", hint: "Nudity and suggestive content" },
  { key: "violent", label: "Violent Content", hint: "Violence, weapons, threats" },
  { key: "medical", label: "Sensitive Medical Content", hint: "Medical procedures and imagery" },
];
const OPTIONS = [
  { id: "show", label: "Show" },
  { id: "blur", label: "Blur" },
  { id: "hide", label: "Hide" },
];

export const SafetyPreferences = () => {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    apiClient.get("/me/safety-preferences")
      .then((r) => setPrefs(r.data?.preferences || {}))
      .catch(() => setPrefs({}));
  }, []);

  const setPref = async (key, value) => {
    setSaving(key);
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      await apiClient.patch("/me/safety-preferences", { [key]: value });
      resetSafetyPrefsCache();
    } catch { /* keep optimistic value; next load re-syncs */ }
    setSaving("");
  };

  return (
    <div className="or-surface p-5 mb-4" data-testid="safety-preferences">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} style={{ color: "var(--primary)" }} />
        <h3 className="text-lg" style={{ fontFamily: "var(--font-display)" }}>Safety &amp; Content Preferences</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Choose how sensitive content appears in your feeds. Removed content,
        age restrictions, and admin enforcement always apply regardless.
      </p>
      {!prefs ? (
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : ROWS.map((row) => (
        <div key={row.key} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2.5" style={{ borderTop: "1px solid var(--border-col)" }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm" style={{ color: "var(--text-main)" }}>{row.label}</div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{row.hint}</div>
          </div>
          <div className="flex gap-1.5" data-testid={`safety-pref-${row.key}`}>
            {OPTIONS.map((o) => {
              const active = (prefs[row.key] || "blur") === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={saving === row.key}
                  onClick={() => setPref(row.key, o.id)}
                  className="text-[11px] uppercase tracking-wide px-3 py-1.5"
                  style={{
                    borderRadius: 999,
                    background: active ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "transparent",
                    color: active ? "var(--primary)" : "var(--text-muted)",
                    border: active ? "1px solid var(--primary)" : "1px solid var(--border-col)",
                  }}
                  data-testid={`safety-pref-${row.key}-${o.id}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default SafetyPreferences;
