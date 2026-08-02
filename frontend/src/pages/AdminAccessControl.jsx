import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ShieldCheck, Lock, Unlock, Eye, CalendarClock, Users, ScrollText,
  Trash2, Plus, Loader2, AlertTriangle, X, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessControl } from "@/contexts/AccessControlContext";

const MODE_META = {
  full_access:   { label: "Full Access",        color: "#10E670" },
  view_only:     { label: "View Only",          color: "#F4A73B" },
  public_preview:{ label: "Public Preview",     color: "#2EA0FF" },
  invite_only:   { label: "Invite Only",        color: "#2EA0FF" },
  admin_only:    { label: "Admin Only",         color: "#B78BFF" },
  founder_only:  { label: "Founder Only",       color: "#B78BFF" },
  hidden:        { label: "Hidden (404)",       color: "#FF6B6B" },
  maintenance:   { label: "Maintenance / Paused", color: "#F4A73B" },
  emergency_lock:{ label: "Emergency Lock",     color: "#FF3F5A" },
  custom:        { label: "Custom Rules",       color: "#2EE6FF" },
};
const GROUP_LABEL = { master: "Master Controls", rc: "Responsibility Center", orai: "ORAi" };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PERSONAS = ["signed_out", "regular_user", "invited_beta_user", "center_member", "manager", "platform_admin", "founder"];

function ModeBadge({ mode }) {
  const m = MODE_META[mode] || MODE_META.full_access;
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
      style={{ background: `color-mix(in srgb, ${m.color} 15%, transparent)`, color: m.color }}>
      {m.label}
    </span>
  );
}

// ── Impact-preview + confirm modal (shown before EVERY access change) ──
function ImpactModal({ featureKey, targetMode, onClose, onConfirm, busy }) {
  const [impact, setImpact] = useState(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    apiClient.get(`/admin/access-control/impact?feature=${featureKey}&mode=${targetMode}`)
      .then((r) => setImpact(r.data))
      .catch((e) => toast.error(formatApiErrorDetail(e?.response?.data?.detail)));
  }, [featureKey, targetMode]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)" }} data-testid="access-impact-modal">
      <div className="or-surface p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2"><AlertTriangle size={16} style={{ color: "#F4A73B" }} /> Impact preview</h3>
          <button onClick={onClose} className="or-btn or-btn-ghost p-1" aria-label="Close" data-testid="impact-close-btn"><X size={16} /></button>
        </div>
        {!impact ? <div className="py-6 text-center"><Loader2 className="animate-spin mx-auto" size={20} /></div> : (
          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold">{featureKey}</span> <span>→</span> <ModeBadge mode={targetMode} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="text-base font-extrabold" data-testid="impact-users">{impact.affected_users}</div>
                <div style={{ color: "var(--text-muted)" }}>Users</div>
              </div>
              <div className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="text-base font-extrabold" data-testid="impact-centers">{impact.affected_centers}</div>
                <div style={{ color: "var(--text-muted)" }}>Centers</div>
              </div>
              <div className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="text-base font-extrabold">{impact.pending_scheduled_jobs}</div>
                <div style={{ color: "var(--text-muted)" }}>Pending jobs</div>
              </div>
            </div>
            {impact.cascades_to?.length > 0 && (
              <div><span className="font-bold">Cascades to:</span> {impact.cascades_to.join(", ")}</div>
            )}
            <div>
              <div className="font-bold mb-1">Routes affected</div>
              <div className="space-y-0.5" style={{ color: "var(--text-muted)" }}>
                {impact.routes_affected?.slice(0, 8).map((r, i) => <div key={i} className="font-mono">{r}</div>)}
              </div>
            </div>
            <div>
              <div className="font-bold mb-1">Navigation affected</div>
              <div style={{ color: "var(--text-muted)" }}>{impact.navigation_affected?.join(" · ")}</div>
            </div>
            {impact.ai_capabilities_affected?.length > 0 && (
              <div>
                <div className="font-bold mb-1">AI capabilities affected</div>
                <div style={{ color: "var(--text-muted)" }}>{impact.ai_capabilities_affected.join(" · ")}</div>
              </div>
            )}
            <div className="p-2 rounded-lg" style={{ background: "rgba(46,160,255,0.08)" }}>
              <div className="font-bold mb-1">Effects</div>
              <ul className="space-y-0.5" style={{ color: "var(--text-muted)" }}>
                {impact.effects?.writes && <li>• All writes, generation, voice, automations, approvals, uploads, exports, invites & settings actions blocked</li>}
                {impact.effects?.reads && <li>• Reads blocked for unauthorized users</li>}
                {impact.effects?.navigation_hidden && <li>• Navigation entries removed</li>}
                {impact.effects?.returns_404 && <li>• Direct API/routes return 404 to unauthorized users</li>}
                {impact.effects?.maintenance_screen && <li>• Maintenance screen shown</li>}
                {impact.effects?.all_locked && <li>• Everything locked incl. scheduled jobs (never replayed)</li>}
              </ul>
              <div className="mt-1" style={{ color: "var(--text-muted)" }}>Bypass: {impact.bypass}</div>
            </div>
            <div>
              <label className="font-bold block mb-1" htmlFor="impact-reason">Reason (audited)</label>
              <input id="impact-reason" className="or-input w-full text-xs" value={reason}
                onChange={(e) => setReason(e.target.value)} placeholder="Why are you changing this?"
                data-testid="impact-reason-input" />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button className="or-btn or-btn-ghost text-xs" onClick={onClose} data-testid="impact-cancel-btn">Cancel</button>
              <button className="or-btn text-xs font-bold" disabled={busy}
                style={{ background: MODE_META[targetMode]?.color, color: "#0a0a0a" }}
                onClick={() => onConfirm(reason)} data-testid="impact-apply-btn">
                {busy ? <Loader2 size={14} className="animate-spin" /> : "Apply change"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureCard({ fk, reg, feat, onApply }) {
  const [mode, setMode] = useState(feat.mode);
  const [message, setMessage] = useState(feat.message || "");
  const [rules, setRules] = useState(feat.custom_rules || { allow_reads: true, allow_writes: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMode(feat.mode); setMessage(feat.message || ""); }, [feat.mode, feat.message]);
  const dirty = mode !== feat.mode || message !== (feat.message || "");
  return (
    <div className="or-surface p-4" data-testid={`access-card-${fk}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-bold text-sm">{reg.label}</div>
          {reg.parents?.length > 0 && (
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Cascades from: {reg.parents.join(", ")}</div>
          )}
        </div>
        <ModeBadge mode={feat.mode} />
      </div>
      <div className="grid gap-2">
        <select className="or-input text-xs w-full" value={mode} onChange={(e) => setMode(e.target.value)}
          aria-label={`${reg.label} access mode`} data-testid={`access-mode-select-${fk}`}>
          {Object.entries(MODE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <input className="or-input text-xs w-full" value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Custom message shown to users (optional)" data-testid={`access-message-input-${fk}`} />
        {mode === "custom" && (
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={rules.allow_reads}
                onChange={(e) => setRules({ ...rules, allow_reads: e.target.checked })} data-testid={`access-rule-reads-${fk}`} /> Allow reads
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={rules.allow_writes}
                onChange={(e) => setRules({ ...rules, allow_writes: e.target.checked })} data-testid={`access-rule-writes-${fk}`} /> Allow writes
            </label>
          </div>
        )}
        {(dirty || mode === "custom") && (
          <button className="or-btn text-xs font-bold self-start" style={{ background: "var(--brand-blue)", color: "#fff" }}
            onClick={() => setConfirming(true)} data-testid={`access-review-btn-${fk}`}>
            Review &amp; apply
          </button>
        )}
      </div>
      {confirming && (
        <ImpactModal featureKey={fk} targetMode={mode} busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={async (reason) => {
            setBusy(true);
            try {
              await apiClient.patch(`/admin/access-control/features/${fk}`, {
                mode, message, reason, custom_rules: mode === "custom" ? rules : undefined,
              });
              toast.success(`${reg.label} → ${MODE_META[mode].label}`);
              setConfirming(false);
              onApply();
            } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
            finally { setBusy(false); }
          }} />
      )}
    </div>
  );
}

function Schedules({ registry, schedules, reload }) {
  const [kind, setKind] = useState("one_time");
  const [featureKey, setFeatureKey] = useState("responsibility_center");
  const [targetMode, setTargetMode] = useState("view_only");
  const [runAt, setRunAt] = useState("");
  const [days, setDays] = useState(["mon", "tue", "wed", "thu", "fri"]);
  const [timeLocal, setTimeLocal] = useState("22:00");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const create = async () => {
    try {
      const body = { feature_key: featureKey, target_mode: targetMode, kind };
      if (kind === "one_time") {
        if (!runAt) return toast.error("Pick a date & time");
        body.run_at = new Date(runAt).toISOString();
      } else { body.days = days; body.time_local = timeLocal; body.timezone = tz; }
      await apiClient.post("/admin/access-control/schedules", body);
      toast.success("Schedule created"); reload();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };
  return (
    <div className="or-surface p-4" data-testid="access-schedules-section">
      <h2 className="font-bold text-sm mb-3 flex items-center gap-2"><CalendarClock size={16} style={{ color: "var(--brand-blue)" }} /> Scheduled transitions</h2>
      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <select className="or-input text-xs" value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} aria-label="Schedule feature" data-testid="schedule-feature-select">
          {Object.entries(registry).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="or-input text-xs" value={targetMode} onChange={(e) => setTargetMode(e.target.value)} aria-label="Schedule target mode" data-testid="schedule-mode-select">
          {Object.entries(MODE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select className="or-input text-xs" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Schedule kind" data-testid="schedule-kind-select">
          <option value="one_time">One-time</option>
          <option value="recurring">Recurring</option>
        </select>
        {kind === "one_time" ? (
          <input type="datetime-local" className="or-input text-xs" value={runAt} onChange={(e) => setRunAt(e.target.value)} aria-label="Run at" data-testid="schedule-runat-input" />
        ) : (
          <input type="time" className="or-input text-xs" value={timeLocal} onChange={(e) => setTimeLocal(e.target.value)} aria-label="Time of day" data-testid="schedule-time-input" />
        )}
      </div>
      {kind === "recurring" && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {DAYS.map((d) => (
            <button key={d} className="or-btn text-[10px] uppercase px-2 py-1"
              style={{ background: days.includes(d) ? "var(--brand-blue)" : "rgba(255,255,255,0.06)", color: days.includes(d) ? "#fff" : "var(--text-muted)" }}
              onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
              data-testid={`schedule-day-${d}`}>{d}</button>
          ))}
          <span className="text-[10px] self-center" style={{ color: "var(--text-muted)" }}>Timezone: {tz} (stored in UTC)</span>
        </div>
      )}
      <button className="or-btn text-xs font-bold inline-flex items-center gap-1.5" style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
        onClick={create} data-testid="schedule-create-btn"><Plus size={14} /> Create schedule</button>
      <div className="mt-3 space-y-1.5">
        {schedules.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No schedules yet.</div>}
        {schedules.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }} data-testid={`schedule-row-${s.id}`}>
            <div>
              <span className="font-bold">{registry[s.feature_key]?.label || s.feature_key}</span>
              <span> → </span><ModeBadge mode={s.target_mode} />
              <div style={{ color: "var(--text-muted)" }}>
                {s.kind === "one_time"
                  ? `Once at ${s.run_at?.slice(0, 16).replace("T", " ")} UTC · ${s.status}`
                  : `Every ${(s.days || []).join(", ")} at ${s.time_local} (${s.timezone})${s.active === false ? " · inactive" : ""}`}
              </div>
            </div>
            <button className="or-btn or-btn-ghost p-1" aria-label="Cancel schedule"
              onClick={async () => { await apiClient.delete(`/admin/access-control/schedules/${s.id}`); reload(); }}
              data-testid={`schedule-delete-${s.id}`}><Trash2 size={14} style={{ color: "#FF6B6B" }} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Allowlist({ settings, reload }) {
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const add = async () => {
    try {
      await apiClient.post("/admin/access-control/allowlist", {
        username, reason,
        starts_at: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : "",
      });
      toast.success("Emergency access granted"); setUsername(""); setReason(""); reload();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
  };
  return (
    <div className="or-surface p-4" data-testid="access-allowlist-section">
      <h2 className="font-bold text-sm mb-1 flex items-center gap-2"><Users size={16} style={{ color: "var(--brand-blue)" }} /> Emergency-access allowlist</h2>
      <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
        Empty by default. Ordinary admins never bypass locks. Every grant requires your approval, a reason, a start time and an expiration — all audited.
      </p>
      <div className="grid sm:grid-cols-2 gap-2 mb-2">
        <input className="or-input text-xs" placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="allowlist-username-input" />
        <input className="or-input text-xs" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="allowlist-reason-input" />
        <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>Start
          <input type="datetime-local" className="or-input text-xs w-full" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} data-testid="allowlist-start-input" />
        </label>
        <label className="text-[10px]" style={{ color: "var(--text-muted)" }}>Expires
          <input type="datetime-local" className="or-input text-xs w-full" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} data-testid="allowlist-expiry-input" />
        </label>
      </div>
      <button className="or-btn text-xs font-bold" style={{ background: "var(--brand-blue)", color: "#fff" }} onClick={add} data-testid="allowlist-add-btn">Grant temporary bypass</button>
      <div className="mt-3 space-y-1.5">
        {(settings.emergency_allowlist || []).length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No active bypass grants.</div>}
        {(settings.emergency_allowlist || []).map((e) => (
          <div key={e.id} className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }} data-testid={`allowlist-row-${e.id}`}>
            <div>
              <span className="font-bold">@{e.username}</span> — {e.reason}
              <div style={{ color: "var(--text-muted)" }}>{e.starts_at?.slice(0, 16)} → {e.expires_at?.slice(0, 16)} UTC</div>
            </div>
            <button className="or-btn or-btn-ghost p-1" aria-label="Revoke"
              onClick={async () => { await apiClient.delete(`/admin/access-control/allowlist/${e.id}`); reload(); }}
              data-testid={`allowlist-revoke-${e.id}`}><Trash2 size={14} style={{ color: "#FF6B6B" }} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewAs({ registry }) {
  const [persona, setPersona] = useState("regular_user");
  const [matrix, setMatrix] = useState(null);
  useEffect(() => {
    apiClient.get(`/admin/access-control/preview-as?persona=${persona}`)
      .then((r) => setMatrix(r.data.features)).catch(() => setMatrix(null));
  }, [persona]);
  return (
    <div className="or-surface p-4" data-testid="access-preview-as-section">
      <h2 className="font-bold text-sm mb-2 flex items-center gap-2"><Eye size={16} style={{ color: "var(--brand-blue)" }} /> Preview as user</h2>
      <select className="or-input text-xs mb-3" value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona" data-testid="preview-persona-select">
        {PERSONAS.map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
      </select>
      {matrix && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr style={{ color: "var(--text-muted)" }}>
              <th className="text-left py-1">Feature</th><th>Visible</th><th>Read</th><th>Write</th><th className="text-left">Screen</th>
            </tr></thead>
            <tbody>
              {Object.entries(matrix).map(([k, v]) => (
                <tr key={k} className="border-t" style={{ borderColor: "var(--border-col)" }} data-testid={`preview-row-${k}`}>
                  <td className="py-1.5 font-semibold">{registry[k]?.label || k}</td>
                  <td className="text-center">{v.visible ? "✓" : "—"}</td>
                  <td className="text-center">{v.can_read ? "✓" : "—"}</td>
                  <td className="text-center">{v.can_write ? "✓" : "—"}</td>
                  <td style={{ color: "var(--text-muted)" }}>{v.screen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditLog() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    apiClient.get("/admin/access-control/audit?limit=40").then((r) => setRows(r.data.rows || [])).catch(() => {});
  }, []);
  return (
    <div className="or-surface p-4" data-testid="access-audit-section">
      <h2 className="font-bold text-sm mb-2 flex items-center gap-2"><ScrollText size={16} style={{ color: "var(--brand-blue)" }} /> Change history</h2>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {rows.length === 0 && <div className="text-xs" style={{ color: "var(--text-muted)" }}>No changes recorded yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="text-[11px] p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
            <span className="font-bold">@{r.actor_username}</span> · {r.action.replace(/_/g, " ")} · <span className="font-semibold">{r.target}</span>
            {r.reason && <span style={{ color: "var(--text-muted)" }}> — "{r.reason}"</span>}
            <div style={{ color: "var(--text-muted)" }}>{r.at?.slice(0, 19).replace("T", " ")} UTC</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminAccessControl() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh: refreshAccess } = useAccessControl();
  const [data, setData] = useState(null);
  const [lockBusy, setLockBusy] = useState(false);

  const load = useCallback(() => {
    apiClient.get("/admin/access-control")
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatApiErrorDetail(e?.response?.data?.detail)));
    refreshAccess();
  }, [refreshAccess]);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return null;
  if (!data) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto" size={22} /></div>;

  const { settings, registry, schedules, emergency_locked } = data;
  const groups = { master: [], rc: [], orai: [] };
  Object.entries(registry).forEach(([k, v]) => (groups[v.group] || groups.rc).push(k));

  const toggleLock = async (engage) => {
    const reason = window.prompt(engage
      ? "EMERGENCY LOCK — this instantly stops all new RC writes, AI requests, voice sessions, course generation, automations, scheduled jobs, Center creation and invitations. All data is preserved. Reason:"
      : "Restore pre-lock access modes exactly as they were? Skipped jobs will NOT be replayed. Reason:");
    if (reason === null) return;
    setLockBusy(true);
    try {
      await apiClient.post("/admin/access-control/emergency-lock", { engage, reason });
      toast.success(engage ? "Emergency Lock engaged" : "Access restored to pre-lock state");
      load();
    } catch (e) { toast.error(formatApiErrorDetail(e?.response?.data?.detail)); }
    finally { setLockBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-5 py-4 space-y-4" data-testid="admin-access-control-page">
      <div className="flex items-center gap-3">
        <button className="or-btn or-btn-ghost p-1.5" onClick={() => navigate("/admin")} aria-label="Back to Admin Hub" data-testid="access-back-btn">
          <ArrowLeft size={18} />
        </button>
        <ShieldCheck size={22} style={{ color: "var(--brand-green, #10E670)" }} aria-hidden="true" />
        <div>
          <h1 className="text-lg font-extrabold" style={{ fontFamily: "var(--font-display)" }}>Global Access Control</h1>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Founder-only. Every restriction is enforced server-side on every RC &amp; ORAi API — current and future.
          </p>
        </div>
      </div>

      <div className="or-surface p-4 flex flex-wrap items-center justify-between gap-3"
        style={{ border: emergency_locked ? "1px solid #FF3F5A" : "1px solid var(--border-col)" }}>
        <div className="flex items-center gap-2.5">
          {emergency_locked
            ? <Lock size={20} style={{ color: "#FF3F5A" }} aria-hidden="true" />
            : <Sparkles size={20} style={{ color: "var(--brand-green, #10E670)" }} aria-hidden="true" />}
          <div>
            <div className="font-bold text-sm">{emergency_locked ? "EMERGENCY LOCK ACTIVE" : "Emergency Lock"}</div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {emergency_locked
                ? "Everything is locked. Data is safe. Restore returns every feature to its exact pre-lock mode."
                : "One switch stops all RC writes, AI requests, voice, course generation, automations, scheduled jobs, creation & invites."}
            </div>
          </div>
        </div>
        {emergency_locked ? (
          <button className="or-btn text-xs font-bold inline-flex items-center gap-1.5" disabled={lockBusy}
            style={{ background: "var(--brand-green, #10E670)", color: "#0a0a0a" }}
            onClick={() => toggleLock(false)} data-testid="emergency-restore-btn">
            <Unlock size={14} /> Safe restore
          </button>
        ) : (
          <button className="or-btn text-xs font-bold inline-flex items-center gap-1.5" disabled={lockBusy}
            style={{ background: "#FF3F5A", color: "#fff" }}
            onClick={() => toggleLock(true)} data-testid="emergency-lock-btn">
            <Lock size={14} /> Engage Emergency Lock
          </button>
        )}
      </div>

      {["master", "rc", "orai"].map((g) => (
        <div key={g}>
          <h2 className="text-xs font-extrabold uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>{GROUP_LABEL[g]}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {groups[g].map((fk) => (
              <FeatureCard key={fk} fk={fk} reg={registry[fk]} feat={settings.features[fk]} onApply={load} />
            ))}
          </div>
        </div>
      ))}

      <Schedules registry={registry} schedules={schedules} reload={load} />
      <Allowlist settings={settings} reload={load} />
      <PreviewAs registry={registry} />
      <AuditLog />
    </div>
  );
}
