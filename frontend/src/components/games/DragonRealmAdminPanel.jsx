import { useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const REWARD_LABELS = [
  ["quest_complete", "Quest complete"], ["dragon_first_defeat", "Dragon first defeat"],
  ["boss_thornbeast", "Boss: Thornbeast"], ["boss_gemnasher", "Boss: Gemnasher"],
  ["boss_duneblaze", "Boss: Duneblaze"], ["boss_frostwyrm", "Boss: Frostwyrm"],
  ["boss_skytitan", "Boss: Skytitan"], ["boss_dragon_king", "Boss: Dragon King (finale)"],
];
const MODES = ["founder_only", "custom", "beta", "live", "maintenance"];

export const DragonRealmAdminPanel = () => {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetUser, setResetUser] = useState("");

  const load = () => apiClient.get("/dragon-realm/admin/config")
    .then((r) => setCfg(r.data)).catch((e) => toast.error(e?.response?.data?.detail || "Could not load Dragon Realm config"));

  const save = async () => {
    const reason = window.prompt("Reason for this Dragon Realm config change (required):");
    if (!reason) return;
    setBusy(true);
    try {
      const r = await apiClient.put("/dragon-realm/admin/config", {
        enabled: cfg.enabled, access_mode: cfg.access_mode, rewards: cfg.rewards,
        eligible_usernames: cfg.eligible_usernames, maintenance_message: cfg.maintenance_message, reason,
      });
      setCfg(r.data);
      toast.success("Dragon Realm config saved");
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const resetProgress = async () => {
    if (!resetUser.trim()) { toast.error("Enter a user ID to reset"); return; }
    const reason = window.prompt(`Reason for resetting Dragon Realm progress of user ${resetUser}:`);
    if (!reason) return;
    if (!window.confirm(`This deletes ALL Dragon Realm progress for user ${resetUser}. Claimed Fire Power stays in their vault and cannot be re-earned. Continue?`)) return;
    setBusy(true);
    try {
      const r = await apiClient.post("/dragon-realm/admin/reset-progress", { user_id: resetUser.trim(), reason });
      toast.success(r.data.deleted ? "Progress reset" : "No save found for that user");
      setResetUser("");
    } catch (e) { toast.error(e?.response?.data?.detail || "Reset failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="or-surface p-3 mb-3" data-testid="dragon-realm-admin-panel">
      <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#F4A73B" }} data-testid="dr-admin-toggle"
        onClick={() => { const n = !open; setOpen(n); if (n && !cfg) load(); }}>
        🐉 Dragon Realm — Fire Quest {open ? "▾" : "▸"}
        <span className="font-normal normal-case tracking-normal" style={{ color: "var(--text-muted)" }}>
          (rewards, access & progress reset)
        </span>
      </button>
      {open && !cfg && <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>Loading…</div>}
      {open && cfg && (
        <div className="mt-3" data-testid="dr-admin-body">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={!!cfg.enabled} className="accent-[#F4A73B]"
                onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} data-testid="dr-admin-enabled" />
              <b>Enabled</b>
            </label>
            <label className="flex items-center gap-1.5 text-[11px]">
              <b>Access:</b>
              <select className="or-input text-xs py-1 w-auto" value={cfg.access_mode}
                onChange={(e) => setCfg({ ...cfg, access_mode: e.target.value })} data-testid="dr-admin-access-mode">
                {MODES.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>v{cfg.game_version}</span>
          </div>
          <div className="text-[9.5px] font-bold uppercase tracking-wider mb-1" style={{ color: "#FF8A5A" }}>🔥 Fire Power reward amounts</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            {REWARD_LABELS.map(([k, l]) => (
              <div key={k}>
                <div className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{l}</div>
                <input type="number" min={0} value={cfg.rewards?.[k] ?? 0} className="or-input w-full text-xs"
                  onChange={(e) => setCfg({ ...cfg, rewards: { ...cfg.rewards, [k]: Math.max(0, Number(e.target.value)) } })}
                  data-testid={`dr-admin-reward-${k}`} />
              </div>
            ))}
          </div>
          <button className="or-btn text-xs" disabled={busy} onClick={save} data-testid="dr-admin-save">Save Dragon Realm Config</button>
          <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--border-col)" }}>
            <div className="text-[9.5px] font-bold uppercase tracking-wider mb-1" style={{ color: "#FF6B6B" }}>Progress reset (per user)</div>
            <div className="flex items-center gap-2 flex-wrap">
              <input className="or-input text-xs w-64" placeholder="User ID" value={resetUser}
                onChange={(e) => setResetUser(e.target.value)} data-testid="dr-admin-reset-user" />
              <button className="or-btn text-xs" style={{ color: "#FF6B6B" }} disabled={busy}
                onClick={resetProgress} data-testid="dr-admin-reset-btn">Reset Progress</button>
            </div>
            <p className="text-[9.5px] mt-1" style={{ color: "var(--text-muted)" }}>
              Deletes the save + trusted progress and starts a fresh reward epoch — the player replays from the start and can earn rewards again.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DragonRealmAdminPanel;
