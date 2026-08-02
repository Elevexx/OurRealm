import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Loader2, Save, UserPlus, Trash2, FlaskConical, Wrench, Flame, Medal, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const ROLE_LABELS = {
  platform_admin: "Platform admins", center_owner: "Center owners",
  center_admin: "Center admins", center_manager: "Center managers",
};
const WINDOWS = ["daily", "weekly", "monthly", "yearly"];

function Toggle({ label, value, onChange, testid, danger }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer" data-testid={testid}>
      <span className="text-xs" style={{ color: danger ? "#FF6B6B" : "var(--text-main)" }}>{label}</span>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
        className="accent-[#2EE6FF] w-4 h-4" />
    </label>
  );
}

function ChipsInput({ value, onChange, placeholder, testid }) {
  const [txt, setTxt] = useState("");
  const add = () => {
    const v = txt.trim().replace(/^@/, "");
    if (v && !value.includes(v)) onChange([...value, v]);
    setTxt("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {value.map((u) => (
          <span key={u} className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1"
            style={{ background: "rgba(46,230,255,0.12)", color: "#2EE6FF" }}>
            @{u}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== u))}
              data-testid={`${testid}-remove-${u}`}>×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input className="or-input text-xs flex-1" value={txt} placeholder={placeholder}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          data-testid={testid} />
        <button type="button" className="or-btn or-btn-ghost text-[10px]" onClick={add}
          data-testid={`${testid}-add`}>Add</button>
      </div>
    </div>
  );
}

function GrantsPanel({ featureKey }) {
  const [grants, setGrants] = useState([]);
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => {
    apiClient.get(`/admin/ai-policies/${featureKey}/grants`).then((r) => setGrants(r.data.grants)).catch(() => {});
  }, [featureKey]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!username.trim()) return;
    try {
      await apiClient.post(`/admin/ai-policies/${featureKey}/grants`, { username: username.trim(), note });
      toast.success(`Access granted to @${username.trim()}`);
      setUsername(""); setNote(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not grant"); }
  };
  const remove = async (g) => {
    try {
      await apiClient.delete(`/admin/ai-policies/${featureKey}/grants/${g.id}`);
      toast.success(`Removed @${g.username}`); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not remove"); }
  };

  return (
    <div className="rounded-lg p-2.5 mt-2" style={{ background: "rgba(255,255,255,0.03)" }} data-testid={`policy-grants-${featureKey}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#F4A73B" }}>
        <UserPlus size={11} className="inline mr-1" />Invite grants ({grants.length})
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <input className="or-input text-xs w-32" placeholder="@username" value={username}
          onChange={(e) => setUsername(e.target.value)} data-testid={`grant-username-${featureKey}`} />
        <input className="or-input text-xs flex-1 min-w-[120px]" placeholder="Note (optional)" value={note}
          onChange={(e) => setNote(e.target.value)} data-testid={`grant-note-${featureKey}`} />
        <button className="or-btn text-[10px]" onClick={add} data-testid={`grant-add-${featureKey}`}>Grant</button>
      </div>
      {grants.map((g) => (
        <div key={g.id} className="flex items-center gap-2 py-1 text-[11px]" data-testid={`grant-row-${g.username}`}>
          <b className="flex-1">@{g.username}</b>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{g.note}</span>
          {!g.active && <span className="text-[9px]" style={{ color: "#FF8A5A" }}>expired</span>}
          <button onClick={() => remove(g)} data-testid={`grant-remove-${g.username}`}>
            <Trash2 size={12} style={{ color: "#FF6B6B" }} />
          </button>
        </div>
      ))}
      {!grants.length && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>No grants yet.</div>}
    </div>
  );
}

function SimulatePanel({ featureKey }) {
  const [username, setUsername] = useState("");
  const [result, setResult] = useState(null);
  const run = async () => {
    if (!username.trim()) return;
    try {
      const r = await apiClient.post(`/admin/ai-policies/${featureKey}/simulate`, { username: username.trim() });
      setResult(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Simulation failed"); }
  };
  return (
    <div className="rounded-lg p-2.5 mt-2" style={{ background: "rgba(194,107,255,0.05)", border: "1px solid rgba(194,107,255,0.2)" }}
      data-testid={`policy-simulate-${featureKey}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#C26BFF" }}>
        <FlaskConical size={11} className="inline mr-1" />Test as a user
      </div>
      <div className="flex gap-1.5">
        <input className="or-input text-xs flex-1" placeholder="@username" value={username}
          onChange={(e) => setUsername(e.target.value)} data-testid={`simulate-username-${featureKey}`} />
        <button className="or-btn text-[10px]" onClick={run} data-testid={`simulate-run-${featureKey}`}>Simulate</button>
      </div>
      {result && (
        <div className="mt-2 text-[11px]" data-testid={`simulate-result-${featureKey}`}>
          <b style={{ color: result.allowed ? "#10E670" : "#FF6B6B" }}>
            @{result.username}: {result.allowed ? "ALLOWED" : "DENIED"}
          </b>
          {result.reason && <div style={{ color: "#FF8A5A" }}>{result.reason}</div>}
          {(result.trace || []).map((t, i) => (
            <div key={i} className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {t.pass ? "✓" : "✗"} {t.check}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeatureCard({ feature, badges, onSaved }) {
  const [draft, setDraft] = useState(feature.policy);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const k = feature.feature_key;

  const save = async () => {
    const reason = window.prompt("Reason for this policy change (audited):");
    if (!reason || reason.trim().length < 5) { toast.error("A short reason is required"); return; }
    setBusy(true);
    try {
      const r = await apiClient.patch(`/admin/ai-policies/${k}`, { ...draft, reason });
      setDraft(r.data.policy);
      toast.success(`${feature.label} policy saved`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
    finally { setBusy(false); }
  };

  const num = (kk, label, testid) => (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <input className="or-input text-xs w-20 text-right" type="number" min={0} value={draft[kk]}
        onChange={(e) => setDraft({ ...draft, [kk]: Number(e.target.value) })} data-testid={testid} />
    </label>
  );

  const status = draft.maintenance ? ["Maintenance", "#FF8A5A"]
    : draft.invite_only ? ["Invite-only", "#F4A73B"]
      : draft.restricted ? ["Restricted", "#C26BFF"] : ["Open", "#10E670"];

  return (
    <div className="or-surface p-4" data-testid={`policy-card-${k}`}>
      <button type="button" className="w-full text-left" onClick={() => setOpen(!open)} data-testid={`policy-toggle-${k}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <b className="text-sm flex-1">{feature.label}</b>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: `${status[1]}22`, color: status[1] }} data-testid={`policy-status-${k}`}>{status[0]}</span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {feature.usage.today} today · {feature.usage.month} this month
          </span>
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{feature.description}</div>
      </button>

      {open && (
        <div className="mt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1">
            <div>
              <Toggle label="Restricted (rules below apply)" value={draft.restricted}
                onChange={(v) => setDraft({ ...draft, restricted: v })} testid={`policy-restricted-${k}`} />
              <Toggle label="Invite-only (grants + usernames only)" value={draft.invite_only}
                onChange={(v) => setDraft({ ...draft, invite_only: v })} testid={`policy-inviteonly-${k}`} />
              <Toggle label="Maintenance mode" value={draft.maintenance} danger
                onChange={(v) => setDraft({ ...draft, maintenance: v })} testid={`policy-maintenance-${k}`} />
              {draft.maintenance && (
                <div className="flex flex-wrap gap-1.5 pl-1 pb-1">
                  {["founder", "platform_admin", "granted"].map((r) => (
                    <button key={r} type="button" data-testid={`policy-bypass-${r}-${k}`}
                      onClick={() => setDraft({
                        ...draft,
                        maintenance_bypass: draft.maintenance_bypass.includes(r)
                          ? draft.maintenance_bypass.filter((x) => x !== r || r === "founder")
                          : [...draft.maintenance_bypass, r],
                      })}
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: draft.maintenance_bypass.includes(r) ? "rgba(255,138,90,0.2)" : "rgba(255,255,255,0.05)",
                               color: draft.maintenance_bypass.includes(r) ? "#FF8A5A" : "var(--text-muted)" }}>
                      <Wrench size={9} className="inline mr-0.5" />bypass: {r}
                    </button>
                  ))}
                </div>
              )}
              <div className="text-[10px] font-bold uppercase tracking-widest mt-2 mb-1" style={{ color: "#2EE6FF" }}>
                <Users size={11} className="inline mr-1" />Always-allowed roles
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {Object.entries(ROLE_LABELS).map(([r, label]) => (
                  <button key={r} type="button" data-testid={`policy-role-${r}-${k}`}
                    onClick={() => setDraft({
                      ...draft,
                      allow_roles: draft.allow_roles.includes(r)
                        ? draft.allow_roles.filter((x) => x !== r) : [...draft.allow_roles, r],
                    })}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: draft.allow_roles.includes(r) ? "rgba(46,230,255,0.15)" : "rgba(255,255,255,0.05)",
                             color: draft.allow_roles.includes(r) ? "#2EE6FF" : "var(--text-muted)" }}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#2EE6FF" }}>Always-allowed usernames</div>
              <ChipsInput value={draft.allow_usernames} onChange={(v) => setDraft({ ...draft, allow_usernames: v })}
                placeholder="@username + Enter" testid={`policy-usernames-${k}`} />
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "#F4A73B" }}>
                <Medal size={11} className="inline mr-1" />Earned requirements
              </div>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {badges.map((b) => (
                  <button key={b.key} type="button" data-testid={`policy-badge-${b.key}-${k}`}
                    onClick={() => setDraft({
                      ...draft,
                      required_badges: draft.required_badges.includes(b.key)
                        ? draft.required_badges.filter((x) => x !== b.key) : [...draft.required_badges, b.key],
                    })}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: draft.required_badges.includes(b.key) ? "rgba(244,167,59,0.2)" : "rgba(255,255,255,0.05)",
                             color: draft.required_badges.includes(b.key) ? "#F4A73B" : "var(--text-muted)" }}>
                    {b.name}
                  </button>
                ))}
              </div>
              {draft.required_badges.length > 1 && (
                <label className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>Badge rule</span>
                  <select className="or-input text-xs" value={draft.badges_mode}
                    onChange={(e) => setDraft({ ...draft, badges_mode: e.target.value })} data-testid={`policy-badgesmode-${k}`}>
                    <option value="any">Any of these</option>
                    <option value="all">All of these</option>
                  </select>
                </label>
              )}
              {num("min_level", "Minimum progression level (0 = off)", `policy-minlevel-${k}`)}
              {num("min_fire_power", "Minimum Fire Power in vault (0 = off)", `policy-minfp-${k}`)}
              {num("fire_power_cost", "Fire Power cost per use (0 = free)", `policy-fpcost-${k}`)}
              <div className="text-[10px] font-bold uppercase tracking-widest mt-2 mb-1" style={{ color: "#10E670" }}>
                <TrendingUp size={11} className="inline mr-1" />Usage limits (0 = unlimited)
              </div>
              <div className="grid grid-cols-2 gap-x-4">
                {WINDOWS.map((w) => (
                  <label key={w} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>{w}</span>
                    <input className="or-input text-xs w-16 text-right" type="number" min={0}
                      value={draft.limits[w]} data-testid={`policy-limit-${w}-${k}`}
                      onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [w]: Number(e.target.value) } })} />
                  </label>
                ))}
              </div>
              <label className="block mt-1">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Custom denial message (optional)</span>
                <input className="or-input text-xs w-full mt-0.5" value={draft.message} maxLength={300}
                  onChange={(e) => setDraft({ ...draft, message: e.target.value })} data-testid={`policy-message-${k}`} />
              </label>
            </div>
          </div>

          <GrantsPanel featureKey={k} />
          <SimulatePanel featureKey={k} />

          {feature.usage.top_users?.length > 0 && (
            <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
              Top users (7d): {feature.usage.top_users.map((u) => `@${u.username} (${u.uses})`).join(" · ")}
            </div>
          )}

          <button className="or-btn text-xs font-bold mt-3" onClick={save} disabled={busy}
            data-testid={`policy-save-${k}`}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save Policy
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminAiPolicies() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [badges, setBadges] = useState([]);
  const load = useCallback(() => {
    apiClient.get("/admin/ai-policies").then((r) => setData(r.data))
      .catch((e) => toast.error(e?.response?.data?.detail || "Could not load policies"));
    apiClient.get("/admin/ai-policies/badges").then((r) => setBadges(r.data.badges)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto pb-12" data-testid="admin-ai-policies-page">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate("/admin")} data-testid="ai-policies-back">
          <ArrowLeft size={13} /> Admin Hub
        </button>
        <h1 className="text-xl sm:text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
          <ShieldCheck size={22} style={{ color: "#2EE6FF" }} /> AI Access Policies
        </h1>
      </div>
      <p className="text-[11px] mb-4" style={{ color: "var(--text-muted)" }}>
        One reusable rule engine gates every AI feature. Combine roles, usernames, invite grants,
        badges, progression levels, Fire Power <Flame size={10} className="inline" style={{ color: "#F4A73B" }} /> requirements
        and usage limits per feature. The founder always has access. Every change is audited.
      </p>
      {!data ? (
        <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <div className="space-y-3">
          {data.features.map((f) => (
            <FeatureCard key={f.feature_key} feature={f} badges={badges} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
