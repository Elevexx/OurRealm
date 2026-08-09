/* Phase 2 — Engine Registry Control Center (founder-only tab in
   /admin/gamemaker). Versioned engines/runtimes/pipelines/schemas:
   inventory, migration pinning, drafts, capability editing, contract
   tests, sandbox demos, compare, promote/rollback, pinned games. */
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";

const ST_COLOR = { draft: "#8892a6", internal: "#4DA3FF", beta: "#F4A73B", live: "#10E670", disabled: "#ff8080" };
const Chip = ({ s }) => (
  <span className="or-chip text-[8.5px] uppercase font-bold" style={{ color: ST_COLOR[s] || "#fff" }}>{s}</span>
);

const pollJob = async (jobId, onDone, onFail) => {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const { data } = await apiClient.get(`/jobs/${jobId}`);
      const j = data.job || data;
      if (j.phase === "completed") return onDone(j);
      if (["failed", "cancelled"].includes(j.phase)) return onFail(j);
    } catch { /* keep polling */ }
  }
  onFail({ error: "Timed out polling job" });
};

function InventoryPanel() {
  const [inv, setInv] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState(() => localStorage.getItem("gm.reg.lastRun") || "");
  useEffect(() => { apiClient.get("/admin/gamemaker/registry/inventory").then((r) => setInv(r.data)); }, []);
  const loadPreview = () => apiClient.get("/admin/gamemaker/registry/migration/preview").then((r) => setPreview(r.data));
  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.post("/admin/gamemaker/registry/migration/apply", {});
      localStorage.setItem("gm.reg.lastRun", data.run_id); setLastRun(data.run_id);
      pollJob(data.job_id,
        (j) => { toast.success(`Pinned ${j.result?.pinned ?? "all"} games (run ${data.run_id.slice(0, 8)})`); setBusy(false); loadPreview(); },
        (j) => { toast.error(j.error || "Migration job failed"); setBusy(false); });
    } catch (e) { toast.error(e?.response?.data?.detail || "Apply failed"); setBusy(false); }
  };
  const rollback = async () => {
    try {
      const { data } = await apiClient.post("/admin/gamemaker/registry/migration/rollback", { run_id: lastRun });
      toast.success(`Rolled back — ${data.deactivated} pins deactivated`); loadPreview();
    } catch (e) { toast.error(e?.response?.data?.detail || "Rollback failed"); }
  };
  if (!inv) return <p className="text-xs">Loading inventory…</p>;
  return (
    <div className="or-surface p-3 rounded-xl mb-3" data-testid="reg-inventory-panel">
      <b className="text-xs uppercase tracking-widest block mb-2">Inventory & Migration Map</b>
      <div className="text-[11px] flex gap-4 flex-wrap mb-2" style={{ color: "var(--text-muted)" }}>
        <span data-testid="reg-inv-games">Games: <b style={{ color: "var(--text-main)" }}>{inv.games_total}</b></span>
        <span>Engines: <b style={{ color: "var(--text-main)" }}>{inv.engines.length}</b></span>
        <span>Implemented runtimes: <b style={{ color: "#10E670" }}>{inv.implemented_runtimes.length}</b></span>
        <span>Planned: <b style={{ color: "#F4A73B" }}>{inv.planned_runtimes.join(", ")}</b></span>
        <span>Pipelines: <b style={{ color: "var(--text-main)" }}>{inv.pipelines.length}</b></span>
      </div>
      <div className="text-[10px] mb-2 flex gap-x-3 gap-y-0.5 flex-wrap" style={{ color: "var(--text-muted)" }}>
        {Object.entries(inv.games_by_runtime).map(([k, v]) => <span key={k}>{k}: <b>{v}</b></span>)}
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="or-btn or-btn-ghost text-[10px]" onClick={loadPreview} data-testid="reg-migration-preview-btn">Migration Preview</button>
        {preview && (
          <button className="or-btn text-[10px]" onClick={apply} disabled={busy || !preview.will_pin} data-testid="reg-migration-apply-btn">
            {busy ? "Pinning…" : `Apply — pin ${preview.will_pin} games`}
          </button>)}
        {lastRun && <button className="or-btn or-btn-ghost text-[10px]" onClick={rollback} data-testid="reg-migration-rollback-btn">Rollback last run</button>}
      </div>
      {preview && (
        <div className="mt-2 text-[10px]" data-testid="reg-migration-preview">
          <span style={{ color: "#10E670" }}>Will pin: {preview.will_pin}</span> · <span style={{ color: "#F4A73B" }}>Skipped: {preview.skipped}</span>
          <span className="block mt-0.5" style={{ color: "var(--text-muted)" }}>{preview.note}</span>
          {preview.skipped_games.slice(0, 6).map((g) => (
            <div key={g.game_id} style={{ color: "var(--text-muted)" }}>· {g.title} — {g.reason}</div>))}
        </div>)}
    </div>
  );
}

const CAP_ON = { color: "#10E670", borderColor: "#10E670" };

function VersionDetail({ fam, itemKey, ver, onChanged }) {
  const [caps, setCaps] = useState(ver.definition?.capabilities || {});
  const [busy, setBusy] = useState(false);
  const [games, setGames] = useState(null);
  const [compare, setCompare] = useState(null);
  const d = ver.definition || {};
  const isDraft = ver.status === "draft";
  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };
  const promoteNext = { draft: "internal", internal: "beta", beta: "live" }[ver.status];
  return (
    <div className="mt-2 p-2.5 rounded-xl text-[10.5px]" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-col)" }}
      data-testid={`reg-version-detail-${itemKey}-${ver.version}`}>
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <b>v{ver.version}</b> <Chip s={ver.status} />
        {ver.last_contract_test && (
          <span className="or-chip text-[8.5px]" style={{ color: ver.last_contract_test.passed ? "#10E670" : "#ff8080" }}
            data-testid={`reg-ct-result-${itemKey}-${ver.version}`}>
            contract: {ver.last_contract_test.passed ? "PASS" : "FAIL"}
          </span>)}
        {!isDraft && <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>immutable — clone to edit</span>}
      </div>
      {fam === "runtime" && (
        <>
          <div style={{ color: "var(--text-muted)" }} className="mb-1">
            engine {d.engine_key}@v{d.engine_version} · spec {d.spec_schema} · save {d.save_schema} · resources {d.resource_manifest}
            <br />controls: kb={String(d.controls?.keyboard)} touch={String(d.controls?.touch)} pad={String(d.controls?.gamepad)}
            · assets: {(d.asset_slots || []).join(", ") || "none"}
          </div>
          <div className="flex gap-1 flex-wrap mb-1.5">
            {Object.entries(caps).map(([c, v]) => (
              <button key={c} className="or-chip text-[8.5px]" disabled={!isDraft}
                style={v ? CAP_ON : { opacity: isDraft ? 0.65 : 0.35 }}
                data-testid={`reg-cap-${itemKey}-${ver.version}-${c}`}
                onClick={() => isDraft && setCaps({ ...caps, [c]: !v })}>{c}</button>))}
          </div>
        </>)}
      {fam === "pipeline" && <div style={{ color: "var(--text-muted)" }} className="mb-1">stages: {(d.stages || []).join(" → ")}</div>}
      {fam === "schema" && <div style={{ color: "var(--text-muted)" }} className="mb-1">{d.kind} — {d.doc}</div>}
      {fam === "engine" && <div style={{ color: "var(--text-muted)" }} className="mb-1">{d.impl_ref}</div>}
      <div className="flex gap-1.5 flex-wrap">
        {isDraft && fam === "runtime" && (
          <button className="or-btn text-[9.5px]" disabled={busy} data-testid={`reg-save-caps-${itemKey}-${ver.version}`}
            onClick={() => act(async () => apiClient.patch(`/admin/gamemaker/registry/${fam}/${itemKey}/versions/${ver.version}`,
              { capabilities: caps }), "Draft capabilities saved")}>Save capabilities</button>)}
        {fam === "runtime" && (
          <button className="or-btn or-btn-ghost text-[9.5px]" disabled={busy} data-testid={`reg-ct-run-${itemKey}-${ver.version}`}
            onClick={() => act(async () => {
              const { data } = await apiClient.post(`/admin/gamemaker/registry/runtime/${itemKey}/versions/${ver.version}/contract-test`, {});
              toast.info("Contract test job started…");
              await new Promise((res) => pollJob(data.job_id,
                (j) => { toast[j.result?.passed ? "success" : "error"](`Contract tests ${j.result?.passed ? "PASSED" : "FAILED"}`); res(); },
                (j) => { toast.error(j.error || "Test job failed"); res(); }));
            })}>Run contract tests</button>)}
        {fam === "runtime" && (
          <button className="or-btn or-btn-ghost text-[9.5px]" disabled={busy} data-testid={`reg-sandbox-${itemKey}-${ver.version}`}
            onClick={() => act(async () => {
              const { data } = await apiClient.post(`/admin/gamemaker/registry/runtime/${itemKey}/versions/${ver.version}/sandbox-demo`, {});
              toast.info("Sandbox demo job started…");
              await new Promise((res) => pollJob(data.job_id,
                (j) => { toast.success(`Sandbox created: ${j.result?.title || j.result?.game_id} — see Saved Games`); res(); },
                (j) => { toast.error(j.error || "Sandbox job failed"); res(); }));
            })}>Sandbox demo</button>)}
        {promoteNext && (
          <button className="or-btn text-[9.5px]" disabled={busy} data-testid={`reg-promote-${itemKey}-${ver.version}`}
            onClick={() => act(async () => apiClient.post(`/admin/gamemaker/registry/${fam}/${itemKey}/versions/${ver.version}/promote`,
              { to: promoteNext }), `Promoted to ${promoteNext}`)}>Promote → {promoteNext}</button>)}
        {ver.status !== "disabled" && (
          <button className="or-btn or-btn-ghost text-[9.5px]" disabled={busy} data-testid={`reg-disable-${itemKey}-${ver.version}`}
            onClick={() => act(async () => apiClient.post(`/admin/gamemaker/registry/${fam}/${itemKey}/versions/${ver.version}/disable`),
              "Disabled — existing games unaffected, new use blocked")}>Disable</button>)}
        {ver.status !== "live" && ver.released_at && (
          <button className="or-btn or-btn-ghost text-[9.5px]" disabled={busy} data-testid={`reg-rollback-${itemKey}-${ver.version}`}
            onClick={() => act(async () => apiClient.post(`/admin/gamemaker/registry/${fam}/${itemKey}/rollback`,
              { to_version: ver.version }), `v${ver.version} rolled back to Live`)}>Make Live (rollback)</button>)}
        {fam === "runtime" && (
          <button className="or-chip text-[9px]" data-testid={`reg-games-${itemKey}-${ver.version}`}
            onClick={async () => {
              const { data } = await apiClient.get(`/admin/gamemaker/registry/runtime/${itemKey}/versions/${ver.version}/games`);
              setGames(games ? null : data.games);
            }}>Pinned games</button>)}
        {fam === "runtime" && ver.version > 1 && (
          <button className="or-chip text-[9px]" data-testid={`reg-compare-${itemKey}-${ver.version}`}
            onClick={async () => {
              const { data } = await apiClient.get(`/admin/gamemaker/registry/runtime/${itemKey}/compare`,
                { params: { v_from: ver.version - 1, v_to: ver.version } });
              setCompare(compare ? null : data);
            }}>Compare v{ver.version - 1}→v{ver.version}</button>)}
      </div>
      {ver.last_contract_test?.checks && (
        <div className="mt-1.5" data-testid={`reg-ct-checks-${itemKey}-${ver.version}`}>
          {ver.last_contract_test.checks.map((c) => (
            <div key={c.check} className="text-[9.5px]" style={{ color: c.passed ? "var(--text-muted)" : "#ff8080" }}>
              {c.passed ? "✓" : "✗"} {c.check}: {c.detail}
            </div>))}
        </div>)}
      {games && (
        <div className="mt-1.5 max-h-40 overflow-y-auto" data-testid={`reg-games-list-${itemKey}-${ver.version}`}>
          {games.length === 0 ? <span style={{ color: "var(--text-muted)" }}>No games pinned to this version.</span>
            : games.map((g) => (
              <div key={g.game_id} className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>
                · {g.title} <span className="uppercase">({g.game_status})</span></div>))}
        </div>)}
      {compare && (
        <div className="mt-1.5 text-[9.5px]" data-testid={`reg-compare-result-${itemKey}`}>
          <b style={{ color: compare.risk.startsWith("HIGH") ? "#ff8080" : "#10E670" }}>{compare.risk}</b>
          <pre className="whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>{JSON.stringify(compare.diff, null, 1)}</pre>
          <span style={{ color: "var(--text-muted)" }}>{compare.affected_games_on_from.length} games on v{compare.from.version}</span>
        </div>)}
    </div>
  );
}

function ItemRow({ fam, item, onChanged }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const load = useCallback(() =>
    apiClient.get(`/admin/gamemaker/registry/${fam}/${item.key}`).then((r) => setDetail(r.data)), [fam, item.key]);
  return (
    <div className="py-1.5" style={{ borderTop: "1px solid var(--border-col)" }} data-testid={`reg-item-${fam}-${item.key}`}>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <button className="flex-1 text-left font-bold" style={{ color: item.disabled ? "#ff8080" : "var(--text-main)" }}
          data-testid={`reg-item-toggle-${item.key}`}
          onClick={() => { setOpen(!open); if (!open) load(); }}>
          {item.name} <code className="text-[9px] font-normal" style={{ color: "var(--text-muted)" }}>{item.key}</code>
          {item.disabled && <span className="or-chip text-[8px] ml-1" style={{ color: "#ff8080" }}>DISABLED</span>}
        </button>
        {fam === "runtime" && <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{item.pinned_games} pinned</span>}
        {(item.versions || []).map((v) => <Chip key={v.version} s={v.status} />)}
      </div>
      {open && detail && (
        <div className="pl-2">
          <div className="flex gap-1.5 mt-1">
            <button className="or-chip text-[9px]" data-testid={`reg-clone-version-${item.key}`}
              onClick={async () => {
                try {
                  await apiClient.post(`/admin/gamemaker/registry/${fam}/${item.key}/versions`, {});
                  toast.success("New draft version cloned"); load(); onChanged();
                } catch (e) { toast.error(e?.response?.data?.detail || "Clone failed"); }
              }}>+ Clone new draft version</button>
            <button className="or-chip text-[9px]" data-testid={`reg-item-disable-${item.key}`}
              onClick={async () => {
                await apiClient.post(`/admin/gamemaker/registry/${fam}/${item.key}/item-disable`, { disabled: !item.disabled });
                toast.success(item.disabled ? "Enabled" : "Disabled for new use"); onChanged();
              }}>{item.disabled ? "Enable" : "Disable entirely"}</button>
          </div>
          {detail.versions.map((v) => (
            <VersionDetail key={v.version} fam={fam} itemKey={item.key} ver={v}
              onChanged={() => { load(); onChanged(); }} />))}
        </div>)}
    </div>
  );
}

export default function GameMakerRegistry() {
  const [ov, setOv] = useState(null);
  const [fam, setFam] = useState("runtime");
  const [newForm, setNewForm] = useState(null);
  const load = useCallback(() => apiClient.get("/admin/gamemaker/registry/overview").then((r) => setOv(r.data)), []);
  useEffect(() => { load(); }, [load]);
  if (!ov) return <p className="text-xs">Loading registry…</p>;
  return (
    <div data-testid="gm-registry-center">
      <InventoryPanel />
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {["runtime", "engine", "pipeline", "schema"].map((f) => (
          <button key={f} className="or-chip text-[10px] uppercase" data-testid={`reg-family-${f}`}
            style={fam === f ? { color: "var(--primary)", borderColor: "var(--primary)" } : undefined}
            onClick={() => setFam(f)}>{f}s ({(ov[f] || []).length})</button>))}
        <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="reg-pins-total">
          {ov.pins_total} active game pins</span>
      </div>
      <div className="or-surface p-3 rounded-xl">
        {fam === "runtime" && (
          <button className="or-btn or-btn-ghost text-[10px] mb-1" data-testid="reg-new-runtime-btn"
            onClick={() => setNewForm(newForm ? null : { key: "", name: "", clone_key: "" })}>+ New runtime draft</button>)}
        {newForm && (
          <div className="flex gap-1.5 flex-wrap mb-2 text-[10.5px]" data-testid="reg-new-runtime-form">
            <input className="or-input text-xs" placeholder="key (snake_case)" value={newForm.key}
              onChange={(e) => setNewForm({ ...newForm, key: e.target.value })} data-testid="reg-new-key" />
            <input className="or-input text-xs" placeholder="Display name" value={newForm.name}
              onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} data-testid="reg-new-name" />
            <select className="or-input text-xs" value={newForm.clone_key}
              onChange={(e) => setNewForm({ ...newForm, clone_key: e.target.value })} data-testid="reg-new-clone">
              <option value="">Blank (all capabilities off)</option>
              {ov.runtime.map((r) => <option key={r.key} value={r.key}>Clone from {r.name}</option>)}
            </select>
            <button className="or-btn text-[10px]" data-testid="reg-new-create"
              onClick={async () => {
                try {
                  await apiClient.post("/admin/gamemaker/registry/runtime", {
                    key: newForm.key, name: newForm.name,
                    clone_from: newForm.clone_key ? { key: newForm.clone_key, version: 1 } : null });
                  toast.success("Runtime draft created"); setNewForm(null); load();
                } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
              }}>Create draft</button>
          </div>)}
        {(ov[fam] || []).map((it) => <ItemRow key={it.key} fam={fam} item={it} onChanged={load} />)}
      </div>
    </div>
  );
}
