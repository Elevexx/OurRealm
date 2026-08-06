/**
 * PrivacyCenter — Settings > Privacy unified dashboard.
 * Reuses: DataExportCard, CloseAccountModal, ImmediateDeleteModal,
 * PrivacyRequestModal, /api/account/privacy-center aggregate.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Download, Flame, Globe2, KeyRound, Loader2, MonitorSmartphone, ScrollText, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import CloseAccountModal from "@/components/account/CloseAccountModal";
import ImmediateDeleteModal from "@/components/account/ImmediateDeleteModal";
import PrivacyRequestModal from "@/components/account/PrivacyRequestModal";
import DataExportCard from "@/components/account/DataExportCard";

function Card({ title, Icon, color, children, testid }) {
  return (
    <div className="or-surface p-4" data-testid={testid}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color: color || "var(--primary)" }} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function PrivacyCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pc, setPc] = useState(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [exportCats, setExportCats] = useState([]);
  const [logoutPwd, setLogoutPwd] = useState("");
  const [extendDays, setExtendDays] = useState(30);

  const load = async () => {
    try {
      const { data } = await apiClient.get("/account/privacy-center");
      setPc(data);
    } catch (e) { /* non-critical */ }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isSystem = ["stealth", "support"].includes((user?.username || "").toLowerCase());

  const withdrawRequest = async (id) => {
    try {
      await apiClient.post(`/account/privacy-requests/${id}/withdraw`);
      toast.success("Request withdrawn"); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not withdraw"); }
  };

  const exportCategories = async () => {
    try {
      const { data } = await apiClient.post("/account/export", { categories: exportCats });
      if (data.export?.token) {
        const res = await apiClient.get(
          `/account/export/${data.export.id}/download?token=${encodeURIComponent(data.export.token)}`,
          { responseType: "blob" });
        const url = URL.createObjectURL(res.data);
        const a = document.createElement("a");
        a.href = url; a.download = `ourrealm-${exportCats.join("-").slice(0, 40) || "data"}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      } else {
        toast.info(data.export?.note || "A recent export of these categories is still available in history.");
      }
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Export failed"); }
  };

  const logoutEverywhere = async () => {
    try {
      await apiClient.post("/account/security/logout-everywhere", { password: logoutPwd });
      toast.success("All sessions revoked — sign in again.");
      setTimeout(() => { window.location.href = "/signin"; }, 1200);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const extendClosure = async () => {
    try {
      const { data } = await apiClient.post("/account/closure/extend", { additional_days: extendDays });
      toast.success(`Recovery window extended to ${String(data.purge_after).slice(0, 10)}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not extend"); }
  };

  if (!pc) return <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>;

  const closure = pc.pending_closure;
  const daysLeft = closure?.purge_after
    ? Math.max(0, Math.ceil((new Date(closure.purge_after) - Date.now()) / 86400000)) : null;

  return (
    <div className="space-y-4" data-testid="privacy-center">
      {/* Recovery — visible only while a recoverable closure is pending */}
      {closure && (
        <Card title={`Account closed — ${daysLeft} days until permanent deletion`} Icon={Clock} color="#FFD166" testid="privacy-recovery-card">
          <p className="text-[12px] mb-2" style={{ color: "var(--text-muted)" }}>
            Scheduled deletion: <b style={{ color: "var(--text-main)" }}>{String(closure.purge_after).slice(0, 10)}</b>
            {closure.reason ? <> · Reason: {closure.reason}</> : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="or-btn text-xs" onClick={async () => {
              try { await apiClient.post("/account/restore"); toast.success("Account restored"); load(); }
              catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
            }} data-testid="privacy-restore-btn">Restore My Account</button>
            <select className="or-input" style={{ width: 110 }} value={extendDays}
              onChange={(e) => setExtendDays(parseInt(e.target.value, 10))} data-testid="privacy-extend-days">
              {[30, 60, 90, 180].map((d) => <option key={d} value={d}>+{d} days</option>)}
            </select>
            <button type="button" className="or-chip text-xs" onClick={extendClosure} data-testid="privacy-extend-btn">Extend recovery window</button>
          </div>
        </Card>
      )}

      {/* Data Map */}
      <Card title="Your Data Map" Icon={Globe2} color="#4DD2FF" testid="privacy-data-map">
        <p className="text-[12px] mb-2" style={{ color: "var(--text-muted)" }}>
          Every category of data OurRealm stores for your account. Select categories to export just those.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-2">
          {pc.data_map.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-xs cursor-pointer p-1.5 rounded"
              style={{ border: "1px solid var(--border-col)" }} data-testid={`data-map-${c.key}`}>
              <input type="checkbox" checked={exportCats.includes(c.key)}
                onChange={(e) => setExportCats((prev) => e.target.checked
                  ? [...prev, c.key] : prev.filter((x) => x !== c.key))} />
              <span className="flex-1 truncate">{c.label}</span>
              <span style={{ color: "var(--text-muted)" }}>{c.count}</span>
            </label>
          ))}
        </div>
        <button type="button" className="or-btn text-xs" disabled={!exportCats.length}
          onClick={exportCategories} data-testid="data-map-export-btn">
          <Download size={13} />&nbsp;Export selected ({exportCats.length})
        </button>
      </Card>

      <DataExportCard exports={pc.exports || []} onRefresh={load} />

      {/* Sessions / devices / login history */}
      <Card title="Active Sessions & Devices" Icon={MonitorSmartphone} color="#9AE66E" testid="privacy-sessions-card">
        <p className="text-[12px] mb-2" style={{ color: "var(--text-muted)" }}>
          Sessions signed in since {pc.security?.sessions_valid_since ? String(pc.security.sessions_valid_since).slice(0, 10) : "account creation"} remain valid.
          Login history shows what the platform actually records: time, IP and browser.
        </p>
        {pc.devices?.length > 0 && (
          <div className="mb-2">
            <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Known devices (browsers)</div>
            <ul className="text-[11px] space-y-0.5" style={{ color: "var(--text-muted)" }}>
              {pc.devices.map((d, i) => <li key={i} className="truncate">• {d}</li>)}
            </ul>
          </div>
        )}
        {pc.login_history?.length > 0 && (
          <div className="mb-2">
            <div className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Recent logins</div>
            <ul className="text-[11px] space-y-0.5" style={{ color: "var(--text-muted)" }} data-testid="privacy-login-history">
              {pc.login_history.map((r, i) => (
                <li key={i}>• {String(r.at).slice(0, 16).replace("T", " ")} — {r.ip || "unknown IP"}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input type="password" className="or-input" style={{ maxWidth: 200 }} placeholder="Password"
            value={logoutPwd} onChange={(e) => setLogoutPwd(e.target.value)} data-testid="privacy-logout-all-pwd" />
          <button type="button" className="or-chip text-xs" disabled={!logoutPwd}
            onClick={logoutEverywhere} data-testid="privacy-logout-all-btn">
            <KeyRound size={12} />&nbsp;Sign out everywhere
          </button>
        </div>
      </Card>

      {/* Connected accounts + third parties */}
      <Card title="Connected Accounts & Third Parties" Icon={ShieldCheck} color="#C084FC" testid="privacy-connected-card">
        <ul className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
          <li>• Google sign-in: <b style={{ color: "var(--text-main)" }}>{pc.connected_accounts?.google ? "Connected" : "Not connected"}</b></li>
          {(pc.third_party_processors || []).map((p) => (
            <li key={p.name}>• {p.name} — {p.purpose}</li>
          ))}
        </ul>
      </Card>

      {/* Fire Power */}
      {pc.fire && (
        <Card title="Fire Power History" Icon={Flame} color="#FF8C42" testid="privacy-fire-card">
          <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
            Vault balance: <b style={{ color: "var(--text-main)" }}>{pc.fire.vault_balance ?? 0}</b> ·
            lifetime received: <b style={{ color: "var(--text-main)" }}>{pc.fire.lifetime_fire_received ?? 0}</b>.
            Transactions are included in the Fire Power export category above.
          </p>
        </Card>
      )}

      {/* Legal */}
      <Card title="Legal & Policies" Icon={ScrollText} color="#4DD2FF" testid="privacy-legal-card">
        <button type="button" className="or-chip text-xs" onClick={() => navigate("/legal")} data-testid="privacy-legal-link">
          Open Legal Center
        </button>
      </Card>

      {/* Closure / erasure / deletion — hidden for system accounts */}
      {!isSystem && (
        <>
          {pc.open_privacy_request && (
            <Card title={`Data Erasure Request — ${pc.open_privacy_request.status.replace(/_/g, " ")}`} Icon={ShieldCheck} color="#4DD2FF" testid="account-privacy-status">
              <p className="text-[12px] mb-2" style={{ color: "var(--text-muted)" }}>
                Received {String(pc.open_privacy_request.received_at).slice(0, 10)} · response due{" "}
                {String(pc.open_privacy_request.extended_due_at || pc.open_privacy_request.response_due_at).slice(0, 10)}
              </p>
              {["received", "identity_pending", "under_review"].includes(pc.open_privacy_request.status) && (
                <button type="button" className="or-chip text-xs"
                  onClick={() => withdrawRequest(pc.open_privacy_request.id)}
                  data-testid="account-privacy-withdraw">Withdraw request</button>
              )}
            </Card>
          )}

          <Card title="Close Account (recoverable)" Icon={Clock} color="#FFD166" testid="account-close-section">
            <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
              Hides your account from public view immediately and signs out all sessions.
              Restore anytime during your chosen window (30 days – 1 year).
            </p>
            <button type="button" onClick={() => setCloseOpen(true)} className="or-btn"
              style={{ background: "#B8860B", color: "#fff" }} data-testid="account-close-open"
              disabled={!!closure}>Close Account</button>
          </Card>

          <Card title="Privacy / Data Erasure Request" Icon={ShieldCheck} color="#4DD2FF" testid="account-privacy-section">
            <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
              Formally request permanent erasure of your personal data. Reviewed by our team
              within the legal response window.
            </p>
            <button type="button" onClick={() => setPrivacyOpen(true)} className="or-btn"
              style={{ background: "#0E7490", color: "#fff" }} data-testid="account-privacy-open"
              disabled={!!pc.open_privacy_request}>Request Data Erasure</button>
          </Card>

          <Card title="Permanently Delete Account" Icon={Trash2} color="#FF8080" testid="account-delete-section">
            <p className="text-[12px] mb-3" style={{ color: "var(--text-muted)" }}>
              This permanently deletes your account and cannot be undone. No recovery period.
            </p>
            <button type="button" onClick={() => setDeleteOpen(true)} className="or-btn"
              style={{ background: "#FF4444", color: "#fff" }} data-testid="account-delete-open">
              <Trash2 size={14} /> Permanently Delete
            </button>
          </Card>
        </>
      )}

      <CloseAccountModal open={closeOpen} onClose={() => setCloseOpen(false)} dataMap={pc.data_map} />
      <ImmediateDeleteModal open={deleteOpen} onClose={() => setDeleteOpen(false)} dataMap={pc.data_map} />
      <PrivacyRequestModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} onSubmitted={load} />
    </div>
  );
}
