/**
 * /admin/fire-power — Founder-only Fire Power console.
 * Flags (default OFF), per-level Fire configuration, and the safe
 * Like → Fire migration workflow (Dry Run → Execute → Reconcile,
 * with Rollback). Legacy likes are NEVER deleted by any action here.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, Flame, Loader2, RefreshCw, Search, ShieldAlert,
  Undo2, Wand2, CheckCircle2, Scale,
} from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const FLAG_LABELS = {
  fire_reactions: "Fire reactions on public posts (master switch)",
  boosted_fire: "Boosted Fire (2x+ consumes the 24h pool)",
  fire_ranked_feed: "Fire-ranked For You feed (time windows)",
  fire_notifications: "Fire notifications to post authors",
};

function ReportBlock({ title, report, testid }) {
  if (!report) return null;
  return (
    <div className="or-surface p-3 mt-2 text-xs" data-testid={testid}>
      <div className="font-semibold mb-1">{title}</div>
      {Object.entries(report).map(([k, v]) => (
        k === "samples" || k === "mismatch_samples" ? (
          <div key={k} className="mt-1">
            <span style={{ color: "var(--text-muted)" }}>{k}:</span>
            {(v || []).map((s, i) => (
              <div key={i} style={{ color: "var(--text-muted)" }}>· {JSON.stringify(s)}</div>
            ))}
          </div>
        ) : (
          <div key={k}><span style={{ color: "var(--text-muted)" }}>{k}:</span> <b>{String(v)}</b></div>
        )
      ))}
    </div>
  );
}

function LevelFireRow({ level, onSaved }) {
  const fs = level.fire_settings || level.fire_defaults || { max_fire_per_reaction: 1, daily_fire_pool: 0, fire_enabled: true };
  const [form, setForm] = useState({ max_fire_per_reaction: fs.max_fire_per_reaction, daily_fire_pool: fs.daily_fire_pool, fire_enabled: fs.fire_enabled !== false });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch(`/fire/admin/levels/${level.id}`, form);
      toast.success(`Fire config saved for ${level.name}`);
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 text-xs" style={{ borderTop: "1px solid var(--border-col)" }} data-testid={`fire-level-row-${level.id}`}>
      <span className="w-32 shrink-0 font-semibold" style={{ color: "var(--text-main)" }}>
        #{level.level_number} {level.name}
        {!level.fire_settings && <span className="ml-1 text-[9px] uppercase" style={{ color: "#F4C84A" }}>default</span>}
      </span>
      <label className="flex items-center gap-1">Max
        <input type="number" min={1} className="or-input" style={{ width: 70 }} value={form.max_fire_per_reaction}
          onChange={(e) => setForm({ ...form, max_fire_per_reaction: parseInt(e.target.value || "1", 10) })}
          data-testid={`fire-level-max-${level.id}`} />×
      </label>
      <label className="flex items-center gap-1">Pool
        <input type="number" min={0} className="or-input" style={{ width: 80 }} value={form.daily_fire_pool}
          onChange={(e) => setForm({ ...form, daily_fire_pool: parseInt(e.target.value || "0", 10) })}
          data-testid={`fire-level-pool-${level.id}`} />
      </label>
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={form.fire_enabled}
          onChange={(e) => setForm({ ...form, fire_enabled: e.target.checked })}
          data-testid={`fire-level-enabled-${level.id}`} /> boosted enabled
      </label>
      <button className="or-chip" onClick={save} disabled={saving} data-testid={`fire-level-save-${level.id}`}>
        {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Save
      </button>
    </div>
  );
}

export default function AdminFirePower() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [execReport, setExecReport] = useState(null);
  const [reconcile, setReconcile] = useState(null);
  const [rollback, setRollback] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [rollbackPhrase, setRollbackPhrase] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get("/fire/admin/overview");
      setData(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Load failed"); }
  }, []);
  useEffect(() => { if (user?.role === "founder") load(); }, [user, load]);

  if (user && user.role !== "founder") {
    return <div className="or-surface p-8 text-center max-w-md mx-auto" data-testid="fire-admin-guard">Founder access only.</div>;
  }

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="fire-admin-page">
      <button className="or-chip mb-3" onClick={() => navigate("/admin")}><ChevronLeft size={12} /> Admin Hub</button>
      <h1 className="text-2xl sm:text-3xl mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
        <Flame size={26} style={{ color: "#FF7A1A" }} /> Fire Power
      </h1>
      <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
        Progression-based Fire reactions for public posts. Everything here is founder-flag gated and
        defaults OFF. Legacy likes are never deleted. Private-message emoji reactions are untouched.
      </p>

      {!data ? <Loader2 className="animate-spin" /> : (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center" data-testid="fire-admin-stats">
            {[["Active fire reactions", data.stats.fire_reactions_total],
              ["From migration", data.stats.fire_reactions_migrated],
              ["Active boosts (24h)", data.stats.active_boost_transactions],
              ["Public posts w/ likes", data.stats.legacy_public_likes_posts]].map(([k, v]) => (
              <div key={k} className="or-surface p-3">
                <div className="text-xl font-bold" style={{ color: "#FF7A1A" }}>{v}</div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{k}</div>
              </div>
            ))}
          </div>

          {/* Flags */}
          <div className="or-surface p-4" data-testid="fire-admin-flags">
            <div className="text-sm font-semibold mb-2">Feature flags (all default OFF)</div>
            {Object.entries(data.flags).map(([k, v]) => (
              <label key={k} className="flex items-center gap-3 py-1.5 text-sm" data-testid={`fire-flag-${k}`}>
                <input type="checkbox" checked={!!v}
                  onChange={(e) => apiClient.patch("/fire/admin/flags", { key: k, value: e.target.checked })
                    .then((r) => setData((d) => ({ ...d, flags: r.data.flags })))
                    .catch((err) => toast.error(err?.response?.data?.detail || "failed"))}
                  data-testid={`fire-flag-${k}-toggle`} />
                <span className="font-mono">{k}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{FLAG_LABELS[k]}</span>
              </label>
            ))}
            <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
              Rollback = turn flags OFF. All Fire data is preserved; the UI instantly falls back to Likes.
            </div>
          </div>

          {/* Level config */}
          <div className="or-surface p-4" data-testid="fire-admin-levels">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold">Level Fire limits (Max × per reaction · 24h boost pool)</div>
              <button className="or-chip" data-testid="fire-seed-defaults"
                onClick={() => run("seed", async () => {
                  const r = await apiClient.post("/fire/admin/seed-defaults");
                  toast.success(`Defaults written to ${r.data.updated.length} level(s)`);
                  await load();
                })}>
                {busy === "seed" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} Seed defaults
              </button>
            </div>
            <div className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
              1× Fire is always unlimited for everyone. Only boosts (2×+) consume the pool: cost = fire − 1.
            </div>
            {data.levels.map((l) => <LevelFireRow key={l.id} level={l} onSaved={load} />)}
          </div>

          {/* Migration */}
          <div className="or-surface p-4" data-testid="fire-admin-migration">
            <div className="text-sm font-semibold mb-1 flex items-center gap-2">
              <ShieldAlert size={14} style={{ color: "#F4C84A" }} /> Like → Fire migration (safe workflow)
            </div>
            <div className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
              Converts historical PUBLIC post likes into 1× Fire. Consumes zero Fire Pools, deletes zero
              likes, and never touches DM / group / community reactions. Idempotent — safe to re-run.
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button className="or-btn" data-testid="fire-migration-dry-run"
                onClick={() => run("dry", async () => { const r = await apiClient.post("/fire/admin/migration/dry-run"); setDryRun(r.data); })}>
                {busy === "dry" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Dry Run (read-only)
              </button>
              <button className="or-chip" data-testid="fire-migration-reconcile"
                onClick={() => run("rec", async () => { const r = await apiClient.post("/fire/admin/migration/reconcile", { fix: false }); setReconcile(r.data); })}>
                <Scale size={11} /> Reconcile (audit)
              </button>
              <button className="or-chip" data-testid="fire-migration-reconcile-fix"
                onClick={() => run("recfix", async () => { const r = await apiClient.post("/fire/admin/migration/reconcile", { fix: true }); setReconcile(r.data); toast.success("Counters reconciled"); })}>
                <RefreshCw size={11} /> Reconcile + fix counters
              </button>
            </div>
            <ReportBlock title="Dry Run result" report={dryRun} testid="fire-dry-run-report" />
            <ReportBlock title="Reconciliation report" report={reconcile} testid="fire-reconcile-report" />

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input className="or-input" style={{ width: 230 }} placeholder='Type "MIGRATE LIKES TO FIRE"'
                value={phrase} onChange={(e) => setPhrase(e.target.value)} data-testid="fire-migration-phrase" />
              <button className="or-btn" data-testid="fire-migration-execute"
                onClick={() => run("exec", async () => {
                  const r = await apiClient.post("/fire/admin/migration/execute", { confirmation_phrase: phrase });
                  setExecReport(r.data); setPhrase("");
                  toast.success(`Migration complete — ${r.data.reactions_created} fire reactions created`);
                  await load();
                })}>
                {busy === "exec" ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />} Execute migration
              </button>
            </div>
            <ReportBlock title="Execution report" report={execReport} testid="fire-execute-report" />

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input className="or-input" style={{ width: 260 }} placeholder='Type "ROLLBACK FIRE MIGRATION"'
                value={rollbackPhrase} onChange={(e) => setRollbackPhrase(e.target.value)} data-testid="fire-rollback-phrase" />
              <button className="or-chip" style={{ color: "#ff8080" }} data-testid="fire-migration-rollback"
                onClick={() => run("roll", async () => {
                  const r = await apiClient.post("/fire/admin/migration/rollback", { confirmation_phrase: rollbackPhrase });
                  setRollback(r.data); setRollbackPhrase("");
                  toast.success(`Rollback complete — ${r.data.reactions_removed} migrated reactions removed`);
                  await load();
                })}>
                {busy === "roll" ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />} Roll back migration
              </button>
            </div>
            <ReportBlock title="Rollback report" report={rollback} testid="fire-rollback-report" />

            {(data.migration_log || []).length > 0 && (
              <div className="mt-3 text-xs" data-testid="fire-migration-log">
                <div className="font-semibold mb-1">Migration history</div>
                {data.migration_log.map((l) => (
                  <div key={l.id} style={{ color: "var(--text-muted)" }}>
                    · {l.executed_at} — {l.action} by @{l.executed_by}
                    {l.action === "execute" && ` (${l.reactions_created} created)`}
                    {l.action === "rollback" && ` (${l.reactions_removed} removed)`}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
