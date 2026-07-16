/**
 * /admin/leaderboards — Founder Leaderboard Settings.
 * Enabled categories, audiences, cache duration, tie-breaking, and the
 * hidden-users list (public-exclusion only; progression is untouched).
 * Every change is audited server-side in progression_audit_logs.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EyeOff, Loader2, RefreshCw, Save, Trash2, Trophy, UserX } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const CAT_LABELS = {
  reputation: "Reputation", level: "Level", achievements: "Achievements",
  posts: "Posts", likes: "Likes", comments: "Comments", followers: "Followers",
  realms: "Realms", weekly_activity: "Weekly Activity", alltime_activity: "All-Time Activity",
};

function Toggle({ label, checked, onChange, testid }) {
  return (
    <button type="button" className="or-chip" data-active={checked} onClick={() => onChange(!checked)} data-testid={testid}>
      {label}
    </button>
  );
}

export default function AdminLeaderboardSettings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [categories, setCategories] = useState([]);
  const [hideInput, setHideInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiClient.get("/admin/leaderboards/settings")
      .then((r) => { setSettings(r.data.settings); setCategories(r.data.categories); })
      .catch((e) => setErr(e?.response?.status === 403 ? "Founder access required." : "Could not load settings."));
  }, []);

  const patch = (p) => setSettings((s) => ({ ...s, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await apiClient.patch("/admin/leaderboards/settings", settings);
      setSettings(r.data.settings);
      toast.success("Leaderboard settings saved (audited).");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed.");
    } finally { setSaving(false); }
  };

  const refreshCache = async () => {
    try {
      await apiClient.post("/admin/leaderboards/refresh");
      toast.success("Leaderboard cache cleared — rankings will recompute.");
    } catch { toast.error("Refresh failed."); }
  };

  const addHidden = () => {
    const u = hideInput.toLowerCase().trim().replace(/^@/, "");
    if (!u) return;
    if ((settings.hidden_usernames || []).includes(u)) { setHideInput(""); return; }
    patch({ hidden_usernames: [...(settings.hidden_usernames || []), u] });
    setHideInput("");
  };
  const removeHidden = (u) =>
    patch({ hidden_usernames: (settings.hidden_usernames || []).filter((x) => x !== u) });

  if (err) return <div className="max-w-3xl mx-auto or-surface p-8 text-center text-sm" style={{ color: "var(--text-muted)" }} data-testid="lb-settings-error">{err}</div>;
  if (!settings) return <div className="max-w-3xl mx-auto or-surface p-8 flex justify-center" data-testid="lb-settings-loading"><Loader2 className="animate-spin" style={{ color: "var(--primary)" }} /></div>;

  const toggleCat = (c) => {
    const on = settings.enabled_categories.includes(c);
    patch({ enabled_categories: on ? settings.enabled_categories.filter((x) => x !== c) : [...settings.enabled_categories, c] });
  };

  return (
    <div className="max-w-3xl mx-auto pb-10" data-testid="admin-leaderboard-settings">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <Trophy size={24} style={{ color: "var(--primary)" }} />
        <h1 className="text-3xl flex-1" style={{ fontFamily: "var(--font-display)" }}>Leaderboard Settings</h1>
        <button className="or-chip" onClick={() => navigate("/leaderboards")} data-testid="lb-settings-view-public">View public page</button>
      </div>
      <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
        Founder-only. All changes are written to the progression audit log.
      </p>

      <div className="or-surface p-4 mb-4" data-testid="lb-settings-categories">
        <div className="text-xs uppercase tracking-[0.25em] mb-3" style={{ color: "var(--text-muted)" }}>Enabled leaderboards</div>
        <div className="flex gap-1.5 flex-wrap">
          {categories.map((c) => (
            <Toggle key={c} label={CAT_LABELS[c] || c} checked={settings.enabled_categories.includes(c)}
              onChange={() => toggleCat(c)} testid={`lb-toggle-cat-${c}`} />
          ))}
        </div>
      </div>

      <div className="or-surface p-4 mb-4" data-testid="lb-settings-general">
        <div className="text-xs uppercase tracking-[0.25em] mb-3" style={{ color: "var(--text-muted)" }}>Audiences & display</div>
        <div className="flex gap-1.5 flex-wrap mb-4">
          <Toggle label="Friends board" checked={settings.friends_enabled} onChange={(v) => patch({ friends_enabled: v })} testid="lb-toggle-friends" />
          <Toggle label="Realm board" checked={settings.realm_enabled} onChange={(v) => patch({ realm_enabled: v })} testid="lb-toggle-realm" />
          <Toggle label="Top-3 highlight" checked={settings.top3_highlight} onChange={(v) => patch({ top3_highlight: v })} testid="lb-toggle-top3" />
          <Toggle label="Profile rank summary" checked={settings.show_profile_rank_summary} onChange={(v) => patch({ show_profile_rank_summary: v })} testid="lb-toggle-rank-summary" />
        </div>
        <div className="flex gap-6 flex-wrap items-end">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            Cache duration (seconds, 30–86400)
            <input type="number" min={30} max={86400} className="or-input mt-1 block w-40" value={settings.cache_seconds}
              onChange={(e) => patch({ cache_seconds: Number(e.target.value) })} data-testid="lb-cache-seconds" />
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            Tie-breaking rule
            <select className="or-input mt-1 block w-48" value={settings.tie_breaker}
              onChange={(e) => patch({ tie_breaker: e.target.value })} data-testid="lb-tie-breaker">
              <option value="reputation">Higher reputation wins</option>
              <option value="alphabetical">Alphabetical username</option>
            </select>
          </label>
          <button className="or-chip" onClick={refreshCache} data-testid="lb-refresh-cache"><RefreshCw size={12} /> Clear cache now</button>
        </div>
      </div>

      <div className="or-surface p-4 mb-5" data-testid="lb-settings-hidden">
        <div className="text-xs uppercase tracking-[0.25em] mb-1 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <EyeOff size={13} /> Hidden users
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Hidden users are removed from public rankings only. They keep all progression,
          reputation, rewards, and history, still see their own private rank, and can be
          un-hidden at any time. Applies to any account, including the founder.
        </p>
        <div className="flex gap-2 mb-3">
          <input className="or-input flex-1" placeholder="username to hide (e.g. stealth)" value={hideInput}
            onChange={(e) => setHideInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHidden()} data-testid="lb-hide-input" />
          <button className="or-btn" onClick={addHidden} data-testid="lb-hide-add"><UserX size={14} /> Hide</button>
        </div>
        {(settings.hidden_usernames || []).length === 0 ? (
          <div className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="lb-hidden-empty">No hidden users — everyone appears on public leaderboards.</div>
        ) : (
          <div className="flex gap-1.5 flex-wrap" data-testid="lb-hidden-list">
            {settings.hidden_usernames.map((u) => (
              <span key={u} className="or-chip" data-testid={`lb-hidden-${u}`}>
                @{u}
                <button type="button" onClick={() => removeHidden(u)} aria-label={`Unhide ${u}`} data-testid={`lb-unhide-${u}`}
                  style={{ marginLeft: 6, display: "inline-flex" }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <button className="or-btn w-full" onClick={save} disabled={saving} data-testid="lb-settings-save">
        {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save settings</>}
      </button>
    </div>
  );
}
