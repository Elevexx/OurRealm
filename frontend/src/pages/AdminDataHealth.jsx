/**
 * AdminDataHealth — Founder-only production data audit & repair console.
 *
 * Tabs:
 *   • Overview      — environment identity, DB/bucket checks, real member count
 *   • Media Audit   — avatar/post media classification + non-destructive repair
 *   • Synthetic     — demo/test/bot account dry-run classifier + confirm workflow
 *   • Signup Health — success/failure telemetry (redacted)
 *   • Orphans       — dangling records + missing storage objects
 *   • Audit Log     — every bulk action ever executed
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import AdminBackButton from "@/components/AdminBackButton";
import {
  Database, Image as ImageIcon, Users, Activity, Unlink, ScrollText,
  RefreshCw, ShieldCheck, AlertTriangle, Trash2, CheckCircle2, Link2, GitMerge,
} from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { id: "overview", label: "Overview",      Icon: Database },
  { id: "media",    label: "Media Audit",   Icon: ImageIcon },
  { id: "accounts", label: "Synthetic Accounts", Icon: Users },
  { id: "relationships", label: "Relationships", Icon: Link2 },
  { id: "migrations", label: "Migrations",  Icon: GitMerge },
  { id: "signup",   label: "Signup Health", Icon: Activity },
  { id: "orphans",  label: "Orphans",       Icon: Unlink },
  { id: "audit",    label: "Audit Log",     Icon: ScrollText },
];

const CLS_COLORS = {
  real: "#10E670",
  system_required: "#2EA0FF",
  likely_synthetic: "#F4C84A",
  confirmed_synthetic: "#FF3F5A",
};

function Panel({ children, testid }) {
  return <div className="or-surface p-4 mb-4" data-testid={testid}>{children}</div>;
}

function Stat({ label, value, color }) {
  return (
    <div className="or-surface p-3 text-center">
      <div className="text-xl font-bold" style={{ color: color || "var(--text-main)" }}>{value ?? "—"}</div>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────
function OverviewTab() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/identity"); setData(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed to load identity"); }
    setBusy(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const backfill = async () => {
    if (!window.confirm("Stamp account_type / is_synthetic / analytics_eligible on every user (based on verified evidence + your reviews)?")) return;
    try {
      const { data } = await apiClient.post("/admin/data-health/backfill-eligibility");
      toast.success(`Backfill complete — real members: ${data.real_member_count}`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Backfill failed"); }
  };

  if (!data) return <Panel testid="dh-overview-loading">{busy ? "Checking environment…" : "No data"}</Panel>;
  const prod = data.env_label === "production";
  return (
    <div data-testid="dh-overview">
      <Panel testid="dh-env-banner">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="px-3 py-1 rounded-full text-xs font-bold"
                style={{ background: prod ? "#FF3F5A22" : "#2EA0FF22", color: prod ? "#FF3F5A" : "#2EA0FF", border: `1px solid ${prod ? "#FF3F5A" : "#2EA0FF"}` }}
                data-testid="dh-env-label">
            {prod ? "● PRODUCTION" : "● PREVIEW"}
          </span>
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>DB: <b style={{ color: "var(--text-main)" }}>{data.db_name}</b> @ {data.mongo_host}</span>
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>Bucket: <b style={{ color: "var(--text-main)" }}>{data.r2_bucket}</b></span>
          <button className="or-btn ml-auto" onClick={load} disabled={busy} data-testid="dh-refresh-identity" style={{ padding: "0.35rem 0.8rem", fontSize: "0.8rem" }}>
            <RefreshCw size={13} className="inline mr-1" /> Refresh
          </button>
        </div>
        {!data.founder_present && (
          <div className="mt-3 text-sm flex items-center gap-2" style={{ color: "#FF3F5A" }}>
            <AlertTriangle size={14} /> Founder account @stealth NOT found — you may be pointed at the wrong database!
          </div>
        )}
      </Panel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Real Members" value={data.real_member_count} color="#10E670" />
        <Stat label="All User Docs" value={data.collection_counts?.users} />
        <Stat label="Posts" value={data.collection_counts?.posts} />
        <Stat label="Realms" value={data.collection_counts?.realms} />
      </div>
      <Panel testid="dh-collection-counts">
        <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>Collection counts</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {Object.entries(data.collection_counts || {}).map(([k, v]) => (
            <div key={k} className="flex justify-between"><span style={{ color: "var(--text-muted)" }}>{k}</span><b style={{ color: "var(--text-main)" }}>{v ?? "—"}</b></div>
          ))}
        </div>
      </Panel>
      <Panel testid="dh-backfill">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-bold" style={{ color: "var(--text-main)" }}>Analytics eligibility backfill</h4>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Stamps durable account_type / is_synthetic / analytics_eligible flags so every admin metric counts real humans only.
            </p>
          </div>
          <button className="or-btn" onClick={backfill} data-testid="dh-backfill-btn"><ShieldCheck size={14} className="inline mr-1" /> Run Backfill</button>
        </div>
      </Panel>
    </div>
  );
}

// ── Media Audit ───────────────────────────────────────────────────────
function MediaTab() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/media-audit"); setReport(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Audit failed"); }
    setBusy(false);
  };
  const repair = async (dryRun) => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/data-health/media-repair", { dry_run: dryRun });
      toast.success(`${dryRun ? "Dry-run" : "Repair"} — repairable: ${data.counts.repaired}, skipped: ${data.counts.skipped}`);
      if (!dryRun) load();
    } catch (e) { toast.error(e.response?.data?.detail || "Repair failed"); }
    setBusy(false);
  };
  const broken = useMemo(() => (report?.rows || []).filter((r) => !["ok", "external_ok", "none"].includes(r.repair_status)), [report]);
  return (
    <div data-testid="dh-media">
      <Panel testid="dh-media-actions">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="or-btn" onClick={load} disabled={busy} data-testid="dh-media-run">Run Media Audit</button>
          <button className="or-btn" onClick={() => repair(true)} disabled={busy} data-testid="dh-media-dryrun">Repair (dry-run)</button>
          <button className="or-btn" onClick={() => { if (window.confirm("Rewrite all repairable stored URLs to the stable /api/media proxy path? Working values are never touched.")) repair(false); }}
                  disabled={busy} data-testid="dh-media-repair" style={{ background: "#10E670", color: "#04150a" }}>
            Apply Repairs
          </button>
          {busy && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Working…</span>}
        </div>
        {report && (
          <div className="flex gap-4 mt-3 text-xs flex-wrap">
            {Object.entries(report.summary || {}).map(([k, v]) => (
              <span key={k} style={{ color: "var(--text-muted)" }}>{k}: <b style={{ color: "var(--text-main)" }}>{v}</b></span>
            ))}
          </div>
        )}
      </Panel>
      {report && (
        <Panel testid="dh-media-table">
          <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>
            Issues ({broken.length}) — healthy rows hidden
          </h4>
          {broken.length === 0 ? (
            <div className="text-sm flex items-center gap-2" style={{ color: "#10E670" }}><CheckCircle2 size={14} /> All stored media values are healthy.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr style={{ color: "var(--text-muted)" }} className="text-left">
                  <th className="py-1 pr-3">Record</th><th className="py-1 pr-3">Field</th><th className="py-1 pr-3">Who</th>
                  <th className="py-1 pr-3">Classification</th><th className="py-1 pr-3">Object exists</th><th className="py-1">Status</th>
                </tr></thead>
                <tbody>
                  {broken.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--surface-2)" }}>
                      <td className="py-1.5 pr-3">{r.record_type}</td>
                      <td className="py-1.5 pr-3">{r.field}</td>
                      <td className="py-1.5 pr-3">{r.username || r.author_name || r.post_id || r.user_id}</td>
                      <td className="py-1.5 pr-3">{r.classification}</td>
                      <td className="py-1.5 pr-3">{r.object_exists === null ? "n/a" : String(r.object_exists)}</td>
                      <td className="py-1.5" style={{ color: r.repair_status === "repairable" ? "#F4C84A" : "#FF3F5A" }}>{r.repair_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Synthetic Accounts ────────────────────────────────────────────────
function AccountsTab() {
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [dryRun, setDryRun] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  const load = async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/synthetic-scan"); setScan(data); setSelected(new Set()); setDryRun(null); }
    catch (e) { toast.error(e.response?.data?.detail || "Scan failed"); }
    setBusy(false);
  };

  const review = async (userId, decision) => {
    try {
      await apiClient.post("/admin/data-health/review", { user_id: userId, decision });
      toast.success(decision === "real" ? "Marked as real user" : decision === "synthetic" ? "Confirmed synthetic" : "Review cleared");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Review failed"); }
  };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const runDryRun = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/data-health/cleanup/dry-run", { user_ids: [...selected] });
      setDryRun(data);
    } catch (e) { toast.error(e.response?.data?.detail || "Dry-run failed"); }
    setBusy(false);
  };

  const execute = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/data-health/cleanup/execute", {
        user_ids: [...selected], confirm: confirmText,
        delete_seed_poll_widgets: !!dryRun?.include_seed_polls,
      });
      toast.success(`Deleted ${data.results.length} synthetic accounts (${data.r2_deleted.length} storage objects removed)`);
      setConfirmText(""); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Cleanup failed"); }
    setBusy(false);
  };

  const rows = scan?.rows || [];
  const confirmable = rows.filter((r) => r.classification === "confirmed_synthetic");
  return (
    <div data-testid="dh-accounts">
      <Panel testid="dh-accounts-actions">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="or-btn" onClick={load} disabled={busy} data-testid="dh-scan-run">Run Synthetic Scan</button>
          {busy && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Scanning…</span>}
        </div>
        {scan && (
          <div className="flex gap-4 mt-3 text-xs flex-wrap">
            {Object.entries(scan.totals).map(([k, v]) => (
              <span key={k}><b style={{ color: CLS_COLORS[k] || "var(--text-main)" }}>{v}</b> <span style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</span></span>
            ))}
            <span style={{ color: "var(--text-muted)" }}>seeded realm poll widgets: <b style={{ color: "var(--text-main)" }}>{scan.other_synthetic?.seeded_realm_poll_widgets}</b></span>
          </div>
        )}
      </Panel>
      {scan && (
        <Panel testid="dh-accounts-table">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr style={{ color: "var(--text-muted)" }} className="text-left">
                <th className="py-1 pr-2"></th><th className="py-1 pr-3">User</th><th className="py-1 pr-3">Email</th>
                <th className="py-1 pr-3">Created</th><th className="py-1 pr-3">Class</th>
                <th className="py-1 pr-3">Posts</th><th className="py-1 pr-3">Msgs</th><th className="py-1 pr-3">Friends</th>
                <th className="py-1 pr-3">Reasons</th><th className="py-1">Review</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id} style={{ borderTop: "1px solid var(--surface-2)" }} data-testid={`dh-account-row-${r.username || r.user_id}`}>
                    <td className="py-1.5 pr-2">
                      {r.classification === "confirmed_synthetic" && (
                        <input type="checkbox" checked={selected.has(r.user_id)} onChange={() => toggle(r.user_id)} data-testid={`dh-select-${r.username || r.user_id}`} />
                      )}
                    </td>
                    <td className="py-1.5 pr-3" style={{ color: "var(--text-main)" }}>@{r.username || "—"}</td>
                    <td className="py-1.5 pr-3">{r.email || "—"}</td>
                    <td className="py-1.5 pr-3">{(r.created_at || "").slice(0, 10)}</td>
                    <td className="py-1.5 pr-3 font-semibold" style={{ color: CLS_COLORS[r.classification] }}>{r.classification.replace(/_/g, " ")}</td>
                    <td className="py-1.5 pr-3">{r.linked?.posts ?? "—"}</td>
                    <td className="py-1.5 pr-3">{r.linked?.messages ?? "—"}</td>
                    <td className="py-1.5 pr-3">{r.friendships}</td>
                    <td className="py-1.5 pr-3" style={{ color: "var(--text-muted)", maxWidth: 260 }}>{(r.reasons || []).join("; ")}</td>
                    <td className="py-1.5 whitespace-nowrap">
                      {r.classification !== "system_required" && (
                        <>
                          <button className="underline mr-2" style={{ color: "#10E670" }} onClick={() => review(r.user_id, "real")}>real</button>
                          <button className="underline" style={{ color: "#FF3F5A" }} onClick={() => review(r.user_id, "synthetic")}>synthetic</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {scan && confirmable.length > 0 && (
        <Panel testid="dh-cleanup">
          <h4 className="text-sm font-bold mb-2" style={{ color: "#FF3F5A" }}><Trash2 size={14} className="inline mr-1" /> Cleanup (confirmed synthetic only)</h4>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Select confirmed-synthetic accounts above, run the dry-run to see the exact cascade, then execute.
            The backend refuses to delete anything not classified confirmed_synthetic.
          </p>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button className="or-btn" onClick={runDryRun} disabled={busy || selected.size === 0} data-testid="dh-cleanup-dryrun">
              Dry-run ({selected.size} selected)
            </button>
          </div>
          {dryRun && (
            <div className="mb-3">
              <div className="text-xs font-bold mb-1" style={{ color: "var(--text-main)" }}>Proposed deletion totals by collection:</div>
              <div className="flex gap-3 flex-wrap text-xs mb-2" data-testid="dh-dryrun-totals">
                {Object.entries(dryRun.proposed_totals_by_collection || {}).map(([k, v]) => (
                  <span key={k} style={{ color: "var(--text-muted)" }}>{k}: <b style={{ color: "#FF3F5A" }}>{v}</b></span>
                ))}
              </div>
              {(dryRun.rejected || []).length > 0 && (
                <div className="text-xs" style={{ color: "#F4C84A" }}>
                  Rejected: {dryRun.rejected.map((x) => `${x.username || x.user_id} (${x.reason})`).join("; ")}
                </div>
              )}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <input
                  className="or-input text-xs px-2 py-1.5"
                  style={{ minWidth: 280, background: "var(--surface-2)", border: "1px solid var(--surface-2)", borderRadius: 8, color: "var(--text-main)" }}
                  placeholder='Type: DELETE CONFIRMED SYNTHETIC DATA'
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  data-testid="dh-confirm-input"
                />
                <button
                  className="or-btn"
                  style={{ background: "#FF3F5A", color: "#fff" }}
                  disabled={busy || confirmText !== "DELETE CONFIRMED SYNTHETIC DATA" || dryRun.plans?.length === 0}
                  onClick={execute}
                  data-testid="dh-cleanup-execute"
                >
                  Execute Cleanup
                </button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

// ── Relationships ─────────────────────────────────────────────────────
function RelationshipsTab() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const load = async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/relationships"); setReport(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Audit failed"); }
    setBusy(false);
  };
  const repair = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/data-health/relationships/repair", { confirm: confirmText });
      toast.success(`Repaired — ${JSON.stringify(data.actions)}`);
      setConfirmText(""); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Repair failed"); }
    setBusy(false);
  };
  const totals = report?.totals || {};
  return (
    <div data-testid="dh-relationships">
      <Panel testid="dh-rel-actions">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="or-btn" onClick={load} disabled={busy} data-testid="dh-rel-run">Run Relationship Audit</button>
          {busy && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Working…</span>}
        </div>
        {report && (
          <div className="flex gap-4 mt-3 text-xs flex-wrap">
            <span style={{ color: "var(--text-muted)" }}>users with issues: <b style={{ color: totals.users_with_issues ? "#F4C84A" : "#10E670" }}>{totals.users_with_issues}</b></span>
            <span style={{ color: "var(--text-muted)" }}>dangling refs: <b style={{ color: "var(--text-main)" }}>{totals.dangling_refs}</b></span>
            <span style={{ color: "var(--text-muted)" }}>synthetic refs: <b style={{ color: "var(--text-main)" }}>{totals.synthetic_refs}</b></span>
            <span style={{ color: "var(--text-muted)" }}>asymmetric: <b style={{ color: "var(--text-main)" }}>{totals.asymmetric}</b></span>
            <span style={{ color: "var(--text-muted)" }}>count drift: <b style={{ color: "var(--text-main)" }}>{totals.count_drift}</b></span>
          </div>
        )}
      </Panel>
      {report && (report.rows || []).length > 0 && (
        <>
          <Panel testid="dh-rel-table">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr style={{ color: "var(--text-muted)" }} className="text-left">
                  <th className="py-1 pr-3">User</th><th className="py-1 pr-3">Stored count</th>
                  <th className="py-1 pr-3">Recalculated</th><th className="py-1 pr-3">Dangling</th>
                  <th className="py-1 pr-3">Synthetic refs</th><th className="py-1">Asymmetric (proposed action)</th>
                </tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.user_id} style={{ borderTop: "1px solid var(--surface-2)" }} data-testid={`dh-rel-row-${r.username}`}>
                      <td className="py-1.5 pr-3" style={{ color: "var(--text-main)" }}>@{r.username}</td>
                      <td className="py-1.5 pr-3">{String(r.stored_follower_count)}</td>
                      <td className="py-1.5 pr-3" style={{ color: r.stored_follower_count !== r.recalculated_count ? "#F4C84A" : "var(--text-main)" }}>{r.recalculated_count}</td>
                      <td className="py-1.5 pr-3">{r.dangling_refs.length}</td>
                      <td className="py-1.5 pr-3">{r.synthetic_refs.map((s) => `@${s.username}`).join(", ") || "—"}</td>
                      <td className="py-1.5" style={{ color: "var(--text-muted)", maxWidth: 340 }}>
                        {r.asymmetric.length === 0 ? "—" : r.asymmetric.map((a, i) => (
                          <div key={i}>
                            @{a.other_username}: <b style={{ color: a.proposal === "restore_reciprocal" ? "#10E670" : "#FF3F5A" }}>
                              {a.proposal === "restore_reciprocal" ? "restore" : "remove one-way"}</b> — {a.reason}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel testid="dh-rel-repair">
            <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
              Repair strips dangling references, applies the exact evidence-based proposals shown above,
              and resyncs every follower count. Synthetic references are left for the account cleanup engine.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="text-xs px-2 py-1.5"
                style={{ minWidth: 240, background: "var(--surface-2)", border: "1px solid var(--surface-2)", borderRadius: 8, color: "var(--text-main)" }}
                placeholder="Type: REPAIR RELATIONSHIPS"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                data-testid="dh-rel-confirm-input"
              />
              <button className="or-btn" style={{ background: "#F4C84A", color: "#1a1200" }}
                      disabled={busy || confirmText !== "REPAIR RELATIONSHIPS"} onClick={repair}
                      data-testid="dh-rel-execute">
                Execute Repair
              </button>
            </div>
          </Panel>
        </>
      )}
      {report && (report.rows || []).length === 0 && (
        <Panel testid="dh-rel-clean">
          <div className="text-sm flex items-center gap-2" style={{ color: "#10E670" }}>
            <CheckCircle2 size={14} /> Relationship graph is healthy — all counts match.
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Migrations (polls + realm widgets) ────────────────────────────────
function MigrationsTab() {
  const [polls, setPolls] = useState(null);
  const [widgets, setWidgets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pollConfirm, setPollConfirm] = useState("");
  const [widgetConfirm, setWidgetConfirm] = useState("");

  const loadPolls = async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/poll-migration/dry-run"); setPolls(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Dry-run failed"); }
    setBusy(false);
  };
  const execPolls = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/data-health/poll-migration/execute", { confirm: pollConfirm });
      toast.success(`Migrated ${data.migrated} polls`); setPollConfirm(""); loadPolls();
    } catch (e) { toast.error(e.response?.data?.detail || "Migration failed"); }
    setBusy(false);
  };
  const loadWidgets = async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/realm-widgets/dry-run"); setWidgets(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Dry-run failed"); }
    setBusy(false);
  };
  const execWidgets = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/data-health/realm-widgets/execute", { confirm: widgetConfirm });
      toast.success(`Normalized ${data.fixed} widgets`); setWidgetConfirm(""); loadWidgets();
    } catch (e) { toast.error(e.response?.data?.detail || "Normalize failed"); }
    setBusy(false);
  };

  return (
    <div data-testid="dh-migrations">
      <Panel testid="dh-poll-migration">
        <h4 className="text-sm font-bold mb-1" style={{ color: "var(--text-main)" }}>Poll media_type migration</h4>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Reclassifies posts that carry a poll but were saved as "thought". Only the media_type field changes —
          votes, comments, reactions, ownership and timestamps are untouched.
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <button className="or-btn" onClick={loadPolls} disabled={busy} data-testid="dh-poll-dryrun">Dry-run</button>
          {polls && <span className="text-xs" style={{ color: "var(--text-muted)" }}>affected: <b style={{ color: polls.count ? "#F4C84A" : "#10E670" }}>{polls.count}</b></span>}
        </div>
        {polls && polls.count > 0 && (
          <>
            <div className="overflow-x-auto mb-2">
              <table className="w-full text-xs">
                <thead><tr style={{ color: "var(--text-muted)" }} className="text-left">
                  <th className="py-1 pr-3">Post</th><th className="py-1 pr-3">Author</th>
                  <th className="py-1 pr-3">Question</th><th className="py-1 pr-3">Current type</th><th className="py-1">Created</th>
                </tr></thead>
                <tbody>
                  {polls.rows.map((r) => (
                    <tr key={r.post_id} style={{ borderTop: "1px solid var(--surface-2)" }}>
                      <td className="py-1.5 pr-3">{r.post_id.slice(0, 8)}…</td>
                      <td className="py-1.5 pr-3">@{r.author}</td>
                      <td className="py-1.5 pr-3" style={{ color: "var(--text-main)" }}>{r.question}</td>
                      <td className="py-1.5 pr-3">{r.current_media_type} → <b style={{ color: "#10E670" }}>poll</b></td>
                      <td className="py-1.5">{(r.created_at || "").slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input className="text-xs px-2 py-1.5"
                     style={{ minWidth: 200, background: "var(--surface-2)", border: "1px solid var(--surface-2)", borderRadius: 8, color: "var(--text-main)" }}
                     placeholder="Type: MIGRATE POLLS" value={pollConfirm}
                     onChange={(e) => setPollConfirm(e.target.value)} data-testid="dh-poll-confirm-input" />
              <button className="or-btn" style={{ background: "#10E670", color: "#04150a" }}
                      disabled={busy || pollConfirm !== "MIGRATE POLLS"} onClick={execPolls}
                      data-testid="dh-poll-execute">Execute Migration</button>
            </div>
          </>
        )}
        {polls && polls.count === 0 && (
          <div className="text-sm flex items-center gap-2" style={{ color: "#10E670" }}>
            <CheckCircle2 size={14} /> All polls are correctly classified.
          </div>
        )}
      </Panel>

      <Panel testid="dh-widget-migration">
        <h4 className="text-sm font-bold mb-1" style={{ color: "var(--text-main)" }}>Realm widget type normalization</h4>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Fixes realm widgets saved with a registry UUID (old picker bug) or the "polls" alias, and flags
          legacy widget types that have no Realm renderer.
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <button className="or-btn" onClick={loadWidgets} disabled={busy} data-testid="dh-widget-dryrun">Dry-run</button>
          {widgets && <span className="text-xs" style={{ color: "var(--text-muted)" }}>issues: <b style={{ color: widgets.rows.length ? "#F4C84A" : "#10E670" }}>{widgets.rows.length}</b> (fixable: {widgets.fixable})</span>}
        </div>
        {widgets && widgets.rows.length > 0 && (
          <>
            <div className="text-xs space-y-1 mb-2">
              {widgets.rows.map((r) => (
                <div key={r.widget_id} style={{ color: "var(--text-muted)" }}>
                  {r.widget_id.slice(0, 8)}… · realm {String(r.realm_id).slice(0, 8)}… · <b style={{ color: "var(--text-main)" }}>{r.current_type.slice(0, 20)}</b>
                  {r.proposed_type ? <> → <b style={{ color: "#10E670" }}>{r.proposed_type}</b></> : null} — {r.reason}
                </div>
              ))}
            </div>
            {widgets.fixable > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <input className="text-xs px-2 py-1.5"
                       style={{ minWidth: 220, background: "var(--surface-2)", border: "1px solid var(--surface-2)", borderRadius: 8, color: "var(--text-main)" }}
                       placeholder="Type: NORMALIZE WIDGETS" value={widgetConfirm}
                       onChange={(e) => setWidgetConfirm(e.target.value)} data-testid="dh-widget-confirm-input" />
                <button className="or-btn" style={{ background: "#10E670", color: "#04150a" }}
                        disabled={busy || widgetConfirm !== "NORMALIZE WIDGETS"} onClick={execWidgets}
                        data-testid="dh-widget-execute">Execute Normalize</button>
              </div>
            )}
          </>
        )}
        {widgets && widgets.rows.length === 0 && (
          <div className="text-sm flex items-center gap-2" style={{ color: "#10E670" }}>
            <CheckCircle2 size={14} /> All realm widgets use canonical types.
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Signup Health ─────────────────────────────────────────────────────
function SignupTab() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try { const { data } = await apiClient.get("/admin/data-health/signup-health"); setData(data); }
      catch { /* */ }
    })();
  }, []);
  if (!data) return <Panel testid="dh-signup-loading">Loading signup telemetry…</Panel>;
  return (
    <div data-testid="dh-signup">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Successful" value={data.successful} color="#10E670" />
        <Stat label="Failed" value={data.failed} color="#FF3F5A" />
      </div>
      <Panel testid="dh-signup-categories">
        <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>By category</h4>
        <div className="flex gap-4 flex-wrap text-xs">
          {Object.entries(data.by_category || {}).map(([k, v]) => (
            <span key={k} style={{ color: "var(--text-muted)" }}>{k}: <b style={{ color: "var(--text-main)" }}>{v}</b></span>
          ))}
          {Object.keys(data.by_category || {}).length === 0 && <span style={{ color: "var(--text-muted)" }}>No signup events recorded yet.</span>}
        </div>
      </Panel>
      <Panel testid="dh-signup-recent">
        <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>Recent events (redacted)</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr style={{ color: "var(--text-muted)" }} className="text-left">
              <th className="py-1 pr-3">When</th><th className="py-1 pr-3">OK</th><th className="py-1 pr-3">Category</th>
              <th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Email domain</th><th className="py-1">Detail</th>
            </tr></thead>
            <tbody>
              {(data.recent || []).map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--surface-2)" }}>
                  <td className="py-1.5 pr-3">{(r.at || "").replace("T", " ").slice(0, 19)}</td>
                  <td className="py-1.5 pr-3" style={{ color: r.ok ? "#10E670" : "#FF3F5A" }}>{r.ok ? "✓" : "✗"}</td>
                  <td className="py-1.5 pr-3">{r.category}</td>
                  <td className="py-1.5 pr-3">{r.status_code}</td>
                  <td className="py-1.5 pr-3">{r.email_domain || "—"}</td>
                  <td className="py-1.5" style={{ color: "var(--text-muted)" }}>{r.detail || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ── Orphans ───────────────────────────────────────────────────────────
function OrphansTab() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { const { data } = await apiClient.get("/admin/data-health/orphans"); setData(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Scan failed"); }
    setBusy(false);
  };
  return (
    <div data-testid="dh-orphans">
      <Panel testid="dh-orphans-actions">
        <button className="or-btn" onClick={load} disabled={busy} data-testid="dh-orphans-run">Scan for Orphans</button>
        {busy && <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>Scanning…</span>}
      </Panel>
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Orphan Posts" value={data.orphan_posts?.length} color={data.orphan_posts?.length ? "#F4C84A" : "#10E670"} />
            <Stat label="Orphan Comments" value={data.orphan_comment_count} />
            <Stat label="Orphan Memberships" value={data.orphan_membership_count} />
            <Stat label="Missing Storage Objects" value={data.media_records_missing_object?.length} />
          </div>
          {(data.orphan_posts || []).length > 0 && (
            <Panel testid="dh-orphan-posts">
              <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>Posts whose author no longer exists</h4>
              <div className="text-xs space-y-1">
                {data.orphan_posts.map((p) => (
                  <div key={p.id} style={{ color: "var(--text-muted)" }}>
                    {p.id} · {p.author_name || p.author_id} · {p.media_type} · {(p.created_at || "").slice(0, 10)}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

// ── Audit Log ─────────────────────────────────────────────────────────
function AuditTab() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    (async () => {
      try { const { data } = await apiClient.get("/admin/data-health/cleanup/audit"); setRows(data.rows || []); }
      catch { /* */ }
    })();
  }, []);
  return (
    <Panel testid="dh-audit">
      <h4 className="text-sm font-bold mb-2" style={{ color: "var(--text-main)" }}>Bulk action audit log</h4>
      {rows.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>No bulk actions recorded yet.</div>
      ) : (
        <div className="space-y-2 text-xs">
          {rows.map((r) => (
            <div key={r.id} className="p-2 rounded" style={{ background: "var(--surface-2)" }}>
              <div style={{ color: "var(--text-main)" }}>
                <b>{r.action}</b> by @{r.by} — {(r.at || "").replace("T", " ").slice(0, 19)}
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                {r.action === "synthetic_cleanup" && `users: ${r.users_deleted}, seed polls: ${r.seed_poll_widgets_deleted}, R2 deleted: ${(r.r2_objects_deleted || []).length}, kept shared: ${(r.r2_objects_kept_shared || []).length}`}
                {r.action === "media_repair" && `repaired: ${r.repaired_count}, skipped: ${r.skipped_count}`}
                {r.action === "backfill_eligibility" && JSON.stringify(r.stamped)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function AdminDataHealth() {
  const { user } = useAuth();
  const [tab, setTab] = useState("overview");
  if (!user?.is_founder) {
    return <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="dh-forbidden">Founder access only.</div>;
  }
  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-data-health">
      <AdminBackButton />
      <div className="mb-5">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>Data Health & Audit</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Production data audit, media repair, synthetic-account cleanup, and signup monitoring. Nothing is deleted without your explicit confirmation.
        </p>
      </div>
      <div className="flex gap-2 mb-5 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className="or-btn whitespace-nowrap" onClick={() => setTab(id)}
                  data-testid={`dh-tab-${id}`}
                  style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem",
                           background: tab === id ? "var(--accent, #10E670)" : "var(--surface-2)",
                           color: tab === id ? "#04150a" : "var(--text-main)" }}>
            <Icon size={13} className="inline mr-1" /> {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "media" && <MediaTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "relationships" && <RelationshipsTab />}
      {tab === "migrations" && <MigrationsTab />}
      {tab === "signup" && <SignupTab />}
      {tab === "orphans" && <OrphansTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}
