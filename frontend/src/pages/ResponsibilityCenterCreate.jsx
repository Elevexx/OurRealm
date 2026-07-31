import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Flame, Check } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { RC_TYPES, rcTypeMeta } from "@/lib/rcTypes";

const uuid = () =>
  (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Responsibility Center — 3-step creation wizard (Phase 1).
// Step 1: type · Step 2: details · Step 3: review + confirm 1,000 🔥 burn.
export default function ResponsibilityCenterCreate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [centerType, setCenterType] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const clientToken = useMemo(() => uuid(), []);

  useEffect(() => {
    apiClient.get("/responsibility-center/config")
      .then((r) => setConfig(r.data))
      .catch(() => toast.error("Could not load Center configuration"));
  }, []);

  const createCost = config?.create_cost ?? 1000;
  const balance = config?.my_fire_vault_balance ?? 0;
  const canAfford = balance >= createCost;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await apiClient.post("/responsibility-center/create", {
        name: name.trim(), center_type: centerType,
        description: description.trim(), client_token: clientToken,
      });
      toast.success(`"${r.data.center.name}" created — ${createCost.toLocaleString()} 🔥 burned from your Vault`);
      navigate(`/responsibility-center/${r.data.center.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Center creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto" data-testid="rc-create-page">
      <button className="or-btn or-btn-ghost mb-4" onClick={() => navigate("/responsibility-center")} data-testid="rc-create-back">
        <ChevronLeft size={14} /> Responsibility Center
      </button>
      <h1 className="text-3xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Create a Center</h1>
      <div className="flex items-center gap-2 my-4" data-testid="rc-create-steps">
        {[1, 2, 3].map((s) => (
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
            <span className="text-xs" style={{ color: step === s ? "var(--text-main)" : "var(--text-muted)" }}>
              {s === 1 ? "Type" : s === 2 ? "Details" : "Confirm"}
            </span>
            {s < 3 && <div style={{ width: 24, height: 1, background: "var(--border-col, rgba(255,255,255,0.12))" }} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div data-testid="rc-create-step-type">
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
              Review
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="or-surface p-5" data-testid="rc-create-step-confirm">
          <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Review & Confirm</h3>
          <div className="space-y-2 text-sm mb-4">
            <div><span style={{ color: "var(--text-muted)" }}>Type: </span><b>{rcTypeMeta(centerType).label}</b></div>
            <div><span style={{ color: "var(--text-muted)" }}>Name: </span><b data-testid="rc-create-review-name">{name.trim()}</b></div>
            {description.trim() && (
              <div><span style={{ color: "var(--text-muted)" }}>Description: </span>{description.trim()}</div>
            )}
          </div>
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
          <div className="flex justify-between">
            <button className="or-btn or-btn-ghost" onClick={() => setStep(2)} disabled={busy} data-testid="rc-create-back-3">Back</button>
            <button className="or-btn" disabled={!canAfford || busy} onClick={submit} data-testid="rc-create-confirm-btn">
              {busy ? "Creating…" : `Burn ${createCost.toLocaleString()} 🔥 & Create`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
