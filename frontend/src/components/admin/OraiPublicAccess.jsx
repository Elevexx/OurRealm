import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, Send, Loader2, Check, X, History } from "lucide-react";
import apiClient from "@/api/client";

/* ORAi Public Access & Rules — founder-only policy control + rules chat.
   Policies are enforced server-side; this UI only edits them. */
export const OraiPublicAccess = () => {
  const [policies, setPolicies] = useState([]);
  const [levels, setLevels] = useState([]);
  const [msg, setMsg] = useState("");
  const [prop, setProp] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiClient.get("/admin/orai-access/policies").then((r) => {
    setPolicies(r.data.policies); setLevels(r.data.access_levels); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const propose = async () => {
    if (!msg.trim()) return;
    setBusy(true);
    try {
      const r = await apiClient.post("/admin/orai-access/rules-chat", { message: msg });
      setProp(r.data.proposal);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not build a proposal"); }
    finally { setBusy(false); }
  };

  const edit = async (cap, changes) => {
    try {
      await apiClient.patch(`/admin/orai-access/policies/${cap}`, changes);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  return (
    <div className="space-y-3" data-testid="orai-public-access">
      <div className="or-surface p-3 rounded-xl">
        <b className="text-xs uppercase tracking-widest flex items-center gap-1 mb-1">
          <Shield size={12} /> ORAi Rules Chat — proposals never apply automatically</b>
        <div className="flex gap-2">
          <input className="or-input text-xs flex-1" value={msg} onChange={(e) => setMsg(e.target.value)}
            placeholder='e.g. "Allow beta users Game Maker AI Power 1-5 and make image generation founder-only"'
            data-testid="orai-rules-chat-input" />
          <button className="or-btn text-[10.5px]" onClick={propose} disabled={busy} data-testid="orai-rules-chat-send">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Propose</button>
        </div>
        {prop && (
          <div className="mt-2 p-2.5 rounded-lg text-[10.5px]" style={{ background: "rgba(194,107,255,0.08)", border: "1px solid rgba(194,107,255,0.35)" }}
            data-testid="orai-rules-proposal">
            <b>{prop.summary}</b>
            {(prop.warnings || []).map((w, i) => <p key={i} style={{ color: "#F4A73B" }}>⚠ {w}</p>)}
            {prop.diffs.map((d) => (
              <div key={d.capability} className="mt-1">
                <b>{d.label}</b> (audience: {d.audience}) — {Object.keys(d.after).map((k) => (
                  <span key={k} className="mr-2">{k}: <s style={{ opacity: 0.6 }}>{String(d.before[k])}</s> → <b style={{ color: "#10E670" }}>{String(d.after[k])}</b></span>))}
              </div>))}
            <div className="flex gap-2 mt-2">
              <button className="or-btn text-[10px]" data-testid="orai-rules-apply"
                onClick={async () => { await apiClient.post(`/admin/orai-access/rules-chat/${prop.id}/apply`);
                  toast.success("Policy applied — new immutable version created"); setProp(null); setMsg(""); load(); }}>
                <Check size={11} /> Apply</button>
              <button className="or-btn or-btn-ghost text-[10px]" onClick={() => setProp(null)} data-testid="orai-rules-cancel">
                <X size={11} /> Cancel</button>
            </div>
          </div>)}
      </div>

      <div className="or-surface p-3 rounded-xl">
        <b className="text-xs uppercase tracking-widest block mb-2">Capability policies (backend-enforced · explicit deny overrides allow)</b>
        {policies.map((p) => (
          <div key={p.capability} className="flex items-center gap-2 flex-wrap py-1.5 text-[10.5px]"
            style={{ borderBottom: "1px solid var(--border-col)" }} data-testid={`orai-policy-${p.capability}`}>
            <b className="w-44 truncate">{p.label}</b>
            <select className="or-input text-[10px]" value={p.access}
              onChange={(e) => edit(p.capability, { access: e.target.value })} data-testid={`orai-policy-access-${p.capability}`}>
              {levels.map((l) => <option key={l} value={l}>{l.replace(/_/g, " ")}</option>)}
            </select>
            <span style={{ color: "var(--text-muted)" }}>power {p.min_power}-{p.max_power} (default {p.default_power})</span>
            {p.daily_limit && <span className="or-chip text-[8.5px]">{p.daily_limit}/day</span>}
            <span className="or-chip text-[8.5px]">v{p.version}</span>
            <button className="or-btn or-btn-ghost text-[9px] ml-auto" data-testid={`orai-policy-toggle-${p.capability}`}
              onClick={() => edit(p.capability, { enabled: !p.enabled })}
              style={{ color: p.enabled ? "#10E670" : "#FF5A6E" }}>{p.enabled ? "enabled" : "DISABLED"}</button>
            <button className="or-btn or-btn-ghost text-[9px]" data-testid={`orai-policy-emergency-${p.capability}`}
              onClick={() => edit(p.capability, { emergency_disabled: !p.emergency_disabled })}
              style={{ color: p.emergency_disabled ? "#FF5A6E" : "var(--text-muted)" }}>
              {p.emergency_disabled ? "EMERGENCY OFF" : "emergency"}</button>
            <button className="or-btn or-btn-ghost text-[9px]" title="Roll back one version" data-testid={`orai-policy-rollback-${p.capability}`}
              onClick={async () => { if (p.version < 2) { toast.info("No earlier version"); return; }
                await apiClient.post(`/admin/orai-access/policies/${p.capability}/rollback`, { version: p.version - 1 });
                toast.success("Rolled back"); load(); }}><History size={10} /></button>
          </div>))}
      </div>
    </div>
  );
};
