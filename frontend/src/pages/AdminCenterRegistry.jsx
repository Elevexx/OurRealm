import React, { useEffect, useState } from "react";
import { Shield, Save } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

// Founder Admin Control Center — visual registry management for the
// Universal Center Engine (types, terminology, modules, creator tools).
export default function AdminCenterRegistry() {
  const [reg, setReg] = useState(null);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => apiClient.get("/centers/registry").then((r) => setReg(r.data))
    .catch(() => toast.error("Failed to load registry"));
  useEffect(() => { load(); }, []);

  const pick = (t) => { setSel(t.key); setDraft(JSON.parse(JSON.stringify(t))); };
  const save = async () => {
    setBusy(true);
    try {
      await apiClient.patch(`/admin/centers/registry/${sel}`, {
        terminology: draft.terminology, default_modules: draft.default_modules,
        creator_tools: draft.creator_tools, enabled: draft.enabled });
      toast.success(`${draft.label} registry saved`);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };
  const togList = (field, key) => setDraft((d) => ({
    ...d, [field]: d[field].includes(key) ? d[field].filter((x) => x !== key) : [...d[field], key] }));

  if (!reg) return <div className="or-surface p-8 text-center text-sm">Loading registry…</div>;
  const type = reg.types.find((t) => t.key === sel);
  return (
    <div className="max-w-5xl mx-auto" data-testid="admin-center-registry">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={18} style={{ color: "#2EE6FF" }} />
        <h1 className="text-lg font-bold flex-1">Universal Center Engine — Registry Control</h1>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          {reg.types.map((t) => (
            <button key={t.key} className="or-surface w-full text-left p-3" data-testid={`acr-type-${t.key}`}
              style={sel === t.key ? { borderColor: "#2EE6FF", boxShadow: "0 0 0 1px #2EE6FF" } : undefined}
              onClick={() => pick(t)}>
              <b className="text-xs">{t.label}</b>
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {t.default_modules?.length} modules · {t.creator_tools?.length} creators
                {t.enabled === false && " · DISABLED"}</div>
            </button>))}
        </div>
        <div className="md:col-span-2">
          {!draft && <div className="or-surface p-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Select a Center type to edit its terminology, default modules and creator tools.
            Changes apply to NEW Centers only — existing Centers are never modified.</div>}
          {draft && type && (
            <div className="or-surface p-4 space-y-4" data-testid="acr-editor">
              <div className="flex items-center gap-2">
                <b className="text-sm flex-1">{draft.label}</b>
                <label className="flex items-center gap-1.5 text-[11px]">
                  <input type="checkbox" checked={draft.enabled !== false}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    data-testid="acr-enabled" /> Enabled</label>
              </div>
              <div>
                <b className="text-[10px] uppercase tracking-widest" style={{ color: "#C26BFF" }}>Terminology</b>
                <div className="grid grid-cols-3 gap-2 mt-1.5">
                  {["member", "work", "group"].map((k) => (
                    <div key={k}>
                      <label className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>{k}</label>
                      <input className="or-input text-xs w-full" value={draft.terminology?.[k] || ""}
                        onChange={(e) => setDraft({ ...draft, terminology: { ...draft.terminology, [k]: e.target.value } })}
                        data-testid={`acr-term-${k}`} />
                    </div>))}
                </div>
              </div>
              <div>
                <b className="text-[10px] uppercase tracking-widest" style={{ color: "#2EE6FF" }}>Default modules</b>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {reg.modules.map((m) => {
                    const on = draft.default_modules.includes(m.key);
                    return <button key={m.key} className="px-2 py-1 rounded-full text-[10px]"
                      style={{ background: on ? "rgba(46,230,255,0.13)" : "rgba(255,255,255,0.04)",
                               border: `1px solid ${on ? "#2EE6FF88" : "rgba(255,255,255,0.14)"}`,
                               color: on ? "#2EE6FF" : "var(--text-muted)",
                               opacity: m.core ? 0.6 : 1 }}
                      disabled={m.core}
                      onClick={() => togList("default_modules", m.key)}
                      data-testid={`acr-mod-${m.key}`}>{m.label}{m.core && " (core)"}</button>;
                  })}
                </div>
              </div>
              <div>
                <b className="text-[10px] uppercase tracking-widest" style={{ color: "#10E670" }}>Creator tools</b>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {reg.creator_tools.map((t2) => {
                    const on = draft.creator_tools.includes(t2);
                    return <button key={t2} className="px-2 py-1 rounded-full text-[10px]"
                      style={{ background: on ? "rgba(16,230,112,0.12)" : "rgba(255,255,255,0.04)",
                               border: `1px solid ${on ? "#10E67088" : "rgba(255,255,255,0.14)"}`,
                               color: on ? "#10E670" : "var(--text-muted)" }}
                      onClick={() => togList("creator_tools", t2)}
                      data-testid={`acr-tool-${t2}`}>{t2.replace(/_/g, " ")}</button>;
                  })}
                </div>
              </div>
              <button className="or-btn font-bold" style={{ background: "#10E670", color: "#0a0a0a" }}
                disabled={busy} onClick={save} data-testid="acr-save"><Save size={12} /> Save Registry</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
