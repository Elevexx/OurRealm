/**
 * ActivationChecklist — founder-only guided production rollout for the
 * Progression System. 13 steps, strict order, backend-gated. No user
 * data is ever copied between environments: seeding creates CONFIG
 * records only; progress is computed from this environment's own data.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Circle, Loader2, RefreshCw, Rocket,
  Search, ShieldCheck, Trophy, UserCheck,
} from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

function StepRow({ n, title, done, children, blocked }) {
  return (
    <div className="or-surface p-3 mb-2" data-testid={`activation-step-${n}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {done ? <CheckCircle2 size={16} style={{ color: "var(--brand-green, #10E670)" }} />
          : blocked ? <AlertTriangle size={16} style={{ color: "#F4C84A" }} />
            : <Circle size={16} style={{ color: "var(--text-muted)" }} />}
        <span className="text-sm font-semibold" style={{ color: done ? "var(--text-muted)" : "var(--text-main)" }}>
          Step {n} — {title}
        </span>
        {done && <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--brand-green, #10E670)" }}>done</span>}
      </div>
      {children && <div className="mt-2 pl-6 text-xs" style={{ color: "var(--text-muted)" }}>{children}</div>}
    </div>
  );
}

const FLAG_STEPS = [
  [7, "calculations", "Enable calculations"],
  [8, "display", "Enable display"],
  [9, "events", "Enable events"],
  [10, "notifications", "Enable notifications"],
  [11, "claims", "Enable claims"],
  [12, "rewards", "Enable rewards"],
];

export const ActivationChecklist = () => {
  const [data, setData] = useState(null);
  const [seedResult, setSeedResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [inspect, setInspect] = useState(null);
  const [inspectName, setInspectName] = useState("stealth");
  const [lbCheck, setLbCheck] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get("/admin/progression/activation");
      setData(r.data);
      return r.data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load activation status.");
    }
  }, []);

  useEffect(() => { load(); return () => clearInterval(pollRef.current); }, [load]);

  const pollUntilDone = () => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const d = await load();
      if (d && !d.jobs?.running) clearInterval(pollRef.current);
    }, 3000);
  };

  const seedLaunch = async () => {
    if (!window.confirm(
      "SEED LAUNCH LEVELS\n\nThis creates any MISSING launch levels (Newbie → Legend) with the approved tasks and rewards, publishes them, and ensures database indexes.\n\n• Idempotent — existing levels are never touched or duplicated\n• No user data is created or modified\n• Fully audited\n\nProceed?")) return;
    setBusy("seed");
    try {
      const r = await apiClient.post("/admin/progression/seed-launch", { confirm: true });
      setSeedResult(r.data);
      toast.success(`Seed complete — created: ${r.data.created.length}, already existed: ${r.data.existed.length}`);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Seed failed"); }
    finally { setBusy(""); }
  };

  const runJob = async (dryRun) => {
    setBusy(dryRun ? "dry" : "backfill");
    try {
      const body = { dry_run: dryRun };
      if (!dryRun) body.confirmation_phrase = confirmPhrase;
      await apiClient.post("/admin/progression/jobs/start", body);
      toast.success(`${dryRun ? "Dry Run" : "Backfill"} started — progress updates below.`);
      pollUntilDone();
    } catch (e) { toast.error(e?.response?.data?.detail || "Job failed to start"); }
    finally { setBusy(""); }
  };

  const setFlag = async (key, value) => {
    setBusy(key);
    try {
      await apiClient.patch("/admin/progression/flags", { key, value });
      toast.success(`Flag "${key}" ${value ? "enabled" : "disabled"}.`);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Flag change rejected"); }
    finally { setBusy(""); }
  };

  const doInspect = async () => {
    setBusy("inspect");
    try {
      const r = await apiClient.get(`/admin/progression/inspect/${inspectName.trim().replace(/^@/, "")}`);
      setInspect(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "User not found"); }
    finally { setBusy(""); }
  };

  const verifyLeaderboards = async () => {
    setBusy("lb");
    try {
      const r = await apiClient.get("/leaderboards", { params: { category: "reputation", period: "all" } });
      setLbCheck({ total: r.data.total, top: r.data.rows.slice(0, 3) });
      toast.success(`Leaderboards OK — ${r.data.total} ranked members.`);
      await load();
    } catch (e) { setLbCheck({ error: e?.response?.data?.detail || "failed" }); toast.error("Leaderboard check failed"); }
    finally { setBusy(""); }
  };

  if (!data) return <div className="or-surface p-8 flex justify-center"><Loader2 className="animate-spin" style={{ color: "var(--primary)" }} /></div>;

  const c = data.checklist;
  const jobs = data.jobs || {};
  const dry = jobs.last_dry_run;
  const bf = jobs.last_backfill;
  const running = jobs.running;
  const rec = data.reconciliation || {};

  const jobLine = (j) => j && (
    <>scanned <b>{j.totals?.scanned}</b> · changed <b>{j.totals?.changed}</b> · unchanged <b>{j.totals?.unchanged}</b> · claim-ready <b>{j.totals?.claim_ready}</b> · failed <b style={{ color: j.totals?.failed ? "#ff8080" : undefined }}>{j.totals?.failed}</b>{j.finished_at && <> · finished {j.finished_at}</>}</>
  );

  return (
    <div data-testid="activation-checklist">
      <div className="or-surface p-3 mb-3 flex items-center gap-3">
        <Rocket size={18} style={{ color: "var(--primary)" }} />
        <div className="flex-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <b style={{ color: "var(--text-main)" }}>Production Activation.</b> Complete the 13 steps in order.
          Seeding creates configuration only — user progress is always calculated from THIS environment's real data.
          Claims and rewards are backend-blocked until a successful backfill completes.
        </div>
        <button className="or-chip" onClick={load} data-testid="activation-refresh"><RefreshCw size={12} /> Refresh</button>
      </div>

      {running && (
        <div className="or-surface p-3 mb-3 text-xs flex items-center gap-2" data-testid="activation-running-job">
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--primary)" }} />
          <span>Job running ({running.dry_run ? "Dry Run" : "Backfill"}): {jobLine(running)}</span>
        </div>
      )}

      <StepRow n={1} title="Seed Launch Levels" done={c.levels_seeded}>
        <div className="flex gap-1.5 flex-wrap mb-2">
          {data.levels.map((l) => (
            <span key={l.name} className="or-chip" style={{ opacity: l.exists ? 1 : 0.5 }} data-testid={`activation-level-${l.name.toLowerCase().replace(/ /g, "-")}`}>
              {l.exists ? "✓" : "•"} {l.name}{l.exists && ` (v${l.version}, ${l.task_count} tasks)`}
            </span>
          ))}
        </div>
        <button className="or-btn" onClick={seedLaunch} disabled={busy === "seed"} data-testid="seed-launch-levels-button">
          {busy === "seed" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} SEED LAUNCH LEVELS
        </button>
        {seedResult && (
          <div className="mt-2" data-testid="seed-launch-result">
            Created: <b>{seedResult.created.join(", ") || "none"}</b> · Already existed (untouched): <b>{seedResult.existed.join(", ") || "none"}</b> · Indexes ensured: {seedResult.indexes.length}
          </div>
        )}
        <div className="mt-1">Indexes present: {c.indexes_present ? "yes" : "no (seeding will create them)"}</div>
      </StepRow>

      <StepRow n={2} title="Run Dry Run (read-only)" done={c.dry_run_completed} blocked={!c.levels_seeded}>
        <button className="or-btn" onClick={() => runJob(true)} disabled={!c.levels_seeded || !!running || busy === "dry"} data-testid="activation-dry-run">
          <Search size={13} /> Run Dry Run
        </button>
        {dry && <div className="mt-2">Last Dry Run: {jobLine(dry)}</div>}
      </StepRow>

      <StepRow n={3} title="Review proposed changes" done={c.dry_run_completed}>
        {dry ? (
          <>
            {(dry.samples || []).slice(0, 10).map((s, i) => (
              <div key={i}>· @{s.username}: {s.level} {s.proposed}{s.claim_ready ? " (claim ready)" : ""}</div>
            ))}
            {(dry.errors || []).map((e, i) => (
              <div key={i} style={{ color: "#ff8080" }}>! @{e.user}: {e.error}</div>
            ))}
            {(dry.samples || []).length === 0 && "No changes proposed — everyone already up to date."}
          </>
        ) : "Run the Dry Run first, then review the proposed levels/tasks here before writing anything."}
      </StepRow>

      <StepRow n={4} title="Run batched backfill" done={c.backfill_completed} blocked={!c.dry_run_completed}>
        <div className="flex gap-2 flex-wrap items-center">
          <input className="or-input" style={{ width: 220 }} placeholder='Type "RECALCULATE ALL"'
            value={confirmPhrase} onChange={(e) => setConfirmPhrase(e.target.value)} data-testid="activation-confirm-phrase" />
          <button className="or-btn" onClick={() => runJob(false)}
            disabled={!c.dry_run_completed || !!running || busy === "backfill"} data-testid="activation-backfill">
            Run full backfill
          </button>
        </div>
        <div className="mt-1">Batched (100/batch) · resumable · idempotent · audited · duplicate-job protected.</div>
        {bf && <div className="mt-1">Last backfill: {jobLine(bf)}</div>}
      </StepRow>

      <StepRow n={5} title="Reconcile all real users" done={c.reconciliation_ok} blocked={!c.backfill_completed}>
        Eligible real users: <b>{rec.eligible_users}</b> · Tracked (have progress records): <b>{rec.tracked_users}</b> · Failed in last backfill: <b>{rec.failed_in_last_backfill ?? "—"}</b>
        {!c.reconciliation_ok && c.backfill_completed && <div style={{ color: "#F4C84A" }}>Numbers don't reconcile yet — re-run the backfill or inspect failures.</div>}
      </StepRow>

      <StepRow n={6} title="Verify a real account (@stealth)" done={!!inspect}>
        <div className="flex gap-2 mb-2">
          <input className="or-input" style={{ width: 180 }} value={inspectName} onChange={(e) => setInspectName(e.target.value)} data-testid="activation-inspect-name" />
          <button className="or-btn" onClick={doInspect} disabled={busy === "inspect"} data-testid="activation-inspect-go"><UserCheck size={13} /> Inspect</button>
        </div>
        {inspect && (
          <div data-testid="activation-inspect-result">
            <div><b style={{ color: "var(--text-main)" }}>@{inspect.user.username}</b> (id {inspect.user.id.slice(0, 8)}…) — level <b>{inspect.live?.level?.name}</b> · {inspect.live?.summary?.completed_task_count}/{inspect.live?.summary?.required_task_count} tasks · claim {inspect.live?.summary?.claim_available ? "READY" : "not ready"}</div>
            {(inspect.live?.tasks || []).map((t) => (
              <div key={t.id}>· {t.name}: {Math.min(t.current_value, t.required_value)}/{t.required_value} {t.completed ? "✓" : ""}</div>
            ))}
            <div className="mt-1">Completed levels: {inspect.history.length} · Claims: {inspect.claims.length} · Rewards: {inspect.rewards.length}</div>
          </div>
        )}
      </StepRow>

      {FLAG_STEPS.map(([n, key, title]) => {
        const on = data.flags?.[key];
        const gated = (key === "claims" || key === "rewards") && !data.claims_rewards_gate;
        return (
          <StepRow key={key} n={n} title={title} done={!!on} blocked={gated}>
            <button className="or-btn" onClick={() => setFlag(key, !on)} disabled={busy === key || (gated && !on)}
              data-testid={`activation-flag-${key}`}>
              {on ? `Disable ${key}` : `Enable ${key}`}
            </button>
            {gated && !on && <span className="ml-2" style={{ color: "#F4C84A" }}>Blocked until backfill succeeds (Steps 4-5).</span>}
          </StepRow>
        );
      })}

      <StepRow n={13} title="Verify leaderboards" done={c.leaderboards_verified}>
        <button className="or-btn" onClick={verifyLeaderboards} disabled={busy === "lb"} data-testid="activation-verify-leaderboards">
          <Trophy size={13} /> Check /leaderboards now
        </button>
        {lbCheck && !lbCheck.error && (
          <div className="mt-2" data-testid="activation-lb-result">
            <b>{lbCheck.total}</b> ranked members. Top 3: {lbCheck.top.map((r) => `@${r.username} (${r.score})`).join(", ")}
            {" — "}open <a href="/leaderboards" style={{ color: "var(--primary)" }}>/leaderboards</a> to confirm visually.
          </div>
        )}
        {lbCheck?.error && <div style={{ color: "#ff8080" }}>{lbCheck.error}</div>}
      </StepRow>
    </div>
  );
};

export default ActivationChecklist;
