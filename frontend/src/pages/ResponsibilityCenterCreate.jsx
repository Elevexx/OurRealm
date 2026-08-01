import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Flame, Check, LayoutTemplate, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RC_TYPES, rcTypeMeta } from "@/lib/rcTypes";
import { RcImg } from "@/lib/rcAssets";

const uuid = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const WIDGET_NAMES = {
  center_status: "Center Status", my_work: "My Work", due_today: "Due Today",
  overdue: "Overdue", pending_approvals: "Pending Approvals", upcoming_calendar: "Upcoming Calendar",
  unit_summary: "Groups Summary", member_summary: "Members Summary", vault_balance: "Center Vault",
  recent_activity: "Recent Activity", attendance_summary: "My Attendance",
  birthdays_upcoming: "Birthdays & Important Dates",
};

const SETUP_MODES = [
  { id: "recommended", label: "Recommended Setup", desc: "Starter groups, categories, work items, and dashboard — everything ready to go." },
  { id: "simple", label: "Simple Setup", desc: "Categories and dashboard only. No starter groups or work items." },
  { id: "custom", label: "Customize", desc: "Choose exactly which starter groups and items to include." },
  { id: "skip", label: "Skip Starter Content", desc: "Start completely empty and build your own structure." },
];

// Responsibility Center — creation wizard (Bundle G).
// Step 1: type · Step 2: details · Step 3: starter setup · Step 4: confirm 1,000 🔥 burn.
export default function ResponsibilityCenterCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [centerType, setCenterType] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState(null);
  const [template, setTemplate] = useState(null);
  const [setupMode, setSetupMode] = useState("recommended");
  const [includeUnits, setIncludeUnits] = useState(true);
  const [includeItems, setIncludeItems] = useState(true);
  const [excludedUnits, setExcludedUnits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [retryCenterId, setRetryCenterId] = useState(null);
  const clientToken = useMemo(() => uuid(), []);

  useEffect(() => {
    apiClient.get("/responsibility-center/config")
      .then((r) => setConfig(r.data))
      .catch(() => toast.error("Could not load Center configuration"));
  }, []);

  useEffect(() => {
    if (!centerType) return;
    setTemplate(null);
    setExcludedUnits([]);
    apiClient.get(`/responsibility-center/templates/${centerType}`)
      .then((r) => setTemplate(r.data.template))
      .catch(() => apiClient.get("/responsibility-center/templates/custom")
        .then((r) => setTemplate(r.data.template)).catch(() => {}));
  }, [centerType]);

  const applyTemplate = async (cid) => {
    try {
      const body = {
        template_key: template?.template_key, application_type: "initial",
        mode: setupMode === "custom" ? "recommended" : setupMode,
      };
      if (setupMode === "custom") {
        body.include_units = includeUnits;
        body.include_items = includeItems;
        body.excluded_units = excludedUnits;
      }
      await apiClient.post(`/responsibility-center/${cid}/apply-template`, body);
      return true;
    } catch (e) {
      return false;
    }
  };

  const createCost = config?.create_cost ?? 1000;
  const balance = config?.my_fire_vault_balance ?? 0;
  const canAfford = balance >= createCost;

  const submit = async () => {
    setBusy(true);
    try {
      let cid = retryCenterId;
      if (!cid) {
        const r = await apiClient.post("/responsibility-center/create", {
          name: name.trim(), center_type: centerType,
          description: description.trim(), client_token: clientToken,
        });
        cid = r.data.center.id;
        toast.success(`"${r.data.center.name}" created — ${createCost.toLocaleString()} 🔥 burned from your Vault`);
      }
      const ok = await applyTemplate(cid);
      if (!ok) {
        // Center is safe; setup can be retried without burning more Fire Power
        setRetryCenterId(cid);
        toast.error("Center created, but starter setup didn't finish — you can retry without any extra Fire Power.");
        setBusy(false);
        return;
      }
      navigate(`/responsibility-center/${cid}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Center creation failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleUnit = (uName) =>
    setExcludedUnits((prev) => prev.includes(uName) ? prev.filter((x) => x !== uName) : [...prev, uName]);

  const STEPS = ["Type", "Details", "Starter Setup", "Confirm"];

  return (
    <div className="max-w-2xl mx-auto" data-testid="rc-create-page">
      <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate("/responsibility-center")} data-testid="rc-create-back">
        <ChevronLeft size={14} /> Responsibility Center
      </button>
      <h1 className="text-3xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Create a Center</h1>
      <div className="flex items-center gap-2 my-4 flex-wrap" data-testid="rc-create-steps">
        {STEPS.map((label, idx) => {
          const s = idx + 1;
          return (
            <div key={s} className="flex items-center gap-2">
              <div className="rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  width: 26, height: 26,
                  background: step >= s ? "var(--primary)" : "var(--surface-1, #101826)",
                  color: step >= s ? "#0a0a0a" : "var(--text-muted)",
                  border: "1px solid var(--border-col, rgba(255,255,255,0.12))",
                }}>
                {step > s ? <Check size={13} /> : s}
              </div>
              <span className="text-xs" style={{ color: step === s ? "var(--text-main)" : "var(--text-muted)" }}>{label}</span>
              {s < STEPS.length && <div style={{ width: 18, height: 1, background: "var(--border-col, rgba(255,255,255,0.12))" }} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div data-testid="rc-create-step-type">
          <RcImg assetKey="responsibility_center.landing.create_center" className="w-full rounded-xl mb-3"
            style={{ maxHeight: 180, objectFit: "cover" }} fallback={null} />
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            What kind of group will this Center be responsible for?
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {RC_TYPES.map(({ id, label, Icon, color, desc }) => (
              <button key={id} className="or-surface p-4 text-left transition-transform hover:-translate-y-0.5"
                style={centerType === id ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
                onClick={() => setCenterType(id)} data-testid={`rc-type-${id}`}>
                <div className="flex items-center gap-2 mb-1" style={{ color }}>
                  <Icon size={16} /><span className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{label}</span>
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>{desc}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <button className="or-btn" disabled={!centerType} onClick={() => setStep(2)} data-testid="rc-create-next-1">
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="or-surface p-5" data-testid="rc-create-step-details">
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Center name *</label>
          <input className="or-input w-full mt-1 mb-4" maxLength={60} value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. "The Rivera Family" or "Nightshift Crew"`}
            data-testid="rc-create-name-input" />
          <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Description (optional)</label>
          <textarea className="or-input w-full mt-1" rows={3} maxLength={500} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this Center responsible for?"
            data-testid="rc-create-desc-input" />
          <div className="flex justify-between mt-4">
            <button className="or-btn or-btn-ghost" onClick={() => setStep(1)} data-testid="rc-create-back-2">Back</button>
            <button className="or-btn" disabled={!name.trim()} onClick={() => setStep(3)} data-testid="rc-create-next-2">
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3" data-testid="rc-create-step-template">
          {template ? (
            <div className="or-surface p-5" data-testid="rc-template-preview">
              <div className="flex items-center gap-2 mb-1">
                <LayoutTemplate size={16} style={{ color: "var(--primary)" }} />
                <h3 className="text-base font-semibold" data-testid="rc-template-name">
                  {template.name} template
                  <span className="text-[10px] uppercase ml-2 px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }} data-testid="rc-template-version">
                    v{template.version}
                  </span>
                </h3>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>{template.short_description}</p>
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
                    Starter {template.unit_label || "Groups"}
                  </div>
                  {(template.units || []).length === 0
                    ? <div style={{ color: "var(--text-muted)" }}>None — you'll add your own.</div>
                    : (template.units || []).map((u) => <div key={u.name} data-testid={`rc-tpl-unit-${u.name}`}>• {u.name}</div>)}
                </div>
                <div>
                  <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Starter work items</div>
                  {(template.starter_items || []).length === 0
                    ? <div style={{ color: "var(--text-muted)" }}>None.</div>
                    : (template.starter_items || []).map((it) => (
                      <div key={it.title}>• {it.title} <span style={{ color: "var(--text-muted)" }}>({it.item_type})</span></div>
                    ))}
                </div>
                <div>
                  <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Dashboard modules</div>
                  <div style={{ color: "var(--text-main)" }}>
                    {(template.default_widgets || []).map((w) => WIDGET_NAMES[w] || w).join(", ") || "Standard dashboard"}
                  </div>
                  <div className="mt-1" style={{ color: "var(--text-muted)" }}>Reports unlock by member role.</div>
                </div>
                <div>
                  <div className="uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--text-muted)" }}>Defaults</div>
                  <div data-testid="rc-tpl-selftask-default">Member self-tasks: {template.default_settings?.allow_member_self_tasks === true ? "Enabled" : template.default_settings?.allow_member_self_tasks === false ? "Disabled" : "Center owner decides"}</div>
                  <div data-testid="rc-tpl-attendance-default">Attendance on events: {template.default_settings?.attendance_default ? "On by default" : "Off by default"}</div>
                  <div data-testid="rc-tpl-privacy-default">Privacy: visible to Center members only</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="or-surface p-5 text-sm" style={{ color: "var(--text-muted)" }} data-testid="rc-template-loading">
              Loading starter template…
            </div>
          )}

          <div className="or-surface p-5" data-testid="rc-setup-mode-panel">
            <div className="text-sm font-semibold mb-2">How should we set it up?</div>
            <div className="space-y-2" role="radiogroup" aria-label="Starter setup options">
              {SETUP_MODES.map((m) => (
                <button key={m.id} className="w-full text-left p-3 rounded transition-colors"
                  role="radio" aria-checked={setupMode === m.id}
                  style={{
                    background: setupMode === m.id ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "rgba(255,255,255,0.03)",
                    border: setupMode === m.id ? "1px solid var(--primary)" : "1px solid var(--border-col, rgba(255,255,255,0.1))",
                  }}
                  onClick={() => setSetupMode(m.id)} data-testid={`rc-setup-mode-${m.id}`}>
                  <div className="text-sm font-semibold">{m.label}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>{m.desc}</div>
                </button>
              ))}
            </div>
            {setupMode === "custom" && template && (
              <div className="mt-3 p-3 rounded" style={{ background: "rgba(255,255,255,0.03)" }} data-testid="rc-setup-custom-panel">
                <label className="flex items-center gap-2 text-sm mb-1">
                  <input type="checkbox" checked={includeUnits} onChange={(e) => setIncludeUnits(e.target.checked)}
                    data-testid="rc-custom-include-units" />
                  Include starter {String(template.unit_label || "groups").toLowerCase()}
                </label>
                {includeUnits && (template.units || []).map((u) => (
                  <label key={u.name} className="flex items-center gap-2 text-xs ml-6 py-0.5">
                    <input type="checkbox" checked={!excludedUnits.includes(u.name)} onChange={() => toggleUnit(u.name)}
                      data-testid={`rc-custom-unit-${u.name}`} />
                    {u.name}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={includeItems} onChange={(e) => setIncludeItems(e.target.checked)}
                    data-testid="rc-custom-include-items" />
                  Include starter work items
                </label>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button className="or-btn or-btn-ghost" onClick={() => setStep(2)} data-testid="rc-create-back-3">Back</button>
            <button className="or-btn" onClick={() => setStep(4)} data-testid="rc-create-next-3">Review</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="or-surface p-5" data-testid="rc-create-step-confirm">
          <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Review & Confirm</h3>
          <div className="space-y-2 text-sm mb-4">
            <div><span style={{ color: "var(--text-muted)" }}>Type: </span><b>{rcTypeMeta(centerType).label}</b></div>
            <div><span style={{ color: "var(--text-muted)" }}>Name: </span><b data-testid="rc-create-review-name">{name.trim()}</b></div>
            {description.trim() && (
              <div><span style={{ color: "var(--text-muted)" }}>Description: </span>{description.trim()}</div>
            )}
            <div data-testid="rc-create-review-setup">
              <span style={{ color: "var(--text-muted)" }}>Starter setup: </span>
              <b>{SETUP_MODES.find((m) => m.id === setupMode)?.label}</b>
              {template && setupMode !== "skip" && (
                <span style={{ color: "var(--text-muted)" }}> · {template.name} template v{template.version}</span>
              )}
            </div>
          </div>
          {retryCenterId && (
            <div className="p-3 rounded mb-4 text-xs" data-testid="rc-create-retry-panel"
              style={{ background: "rgba(90,178,255,0.08)", border: "1px solid rgba(90,178,255,0.35)" }}>
              <b style={{ color: "#5AB2FF" }}><RotateCcw size={12} className="inline mr-1" /> Your Center is already created.</b>{" "}
              Only the starter setup needs to finish. Retrying is free — no extra Fire Power will be burned and
              nothing will be duplicated.
            </div>
          )}
          {!retryCenterId && (
            <div className="p-4 rounded mb-4" style={{ background: "rgba(255,138,90,0.08)", border: "1px solid rgba(255,138,90,0.35)" }}
              data-testid="rc-create-cost-panel">
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#FF8A5A" }}>
                <Flame size={16} /> {createCost.toLocaleString()} Fire Power will be burned from your Fire Vault
              </div>
              <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                Your Vault: <b style={{ color: canAfford ? "var(--brand-green, #7BD88F)" : "#FF6B6B" }} data-testid="rc-create-balance">
                  {balance.toLocaleString()} 🔥
                </b>{" "}
                · Includes your first {config?.seat_days ?? 30}-day owner seat. This cannot be undone.
              </div>
              {!canAfford && (
                <div className="text-xs mt-2" style={{ color: "#FF6B6B" }} data-testid="rc-create-insufficient">
                  You need {(createCost - balance).toLocaleString()} more Fire Power to create a Center.
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between">
            <button className="or-btn or-btn-ghost" onClick={() => setStep(3)} disabled={busy} data-testid="rc-create-back-4">Back</button>
            <button className="or-btn" disabled={(!retryCenterId && !canAfford) || busy} onClick={submit} data-testid="rc-create-confirm-btn">
              {busy ? "Working…" : retryCenterId ? "Retry Setup (no Fire Power)" : `Burn ${createCost.toLocaleString()} 🔥 & Create`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
