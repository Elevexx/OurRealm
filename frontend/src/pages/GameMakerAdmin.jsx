import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Gamepad2, Hammer, Flame, ListTree, Shield, Activity, Database, Sparkles,
  Layers, Image as ImageIcon, ScrollText, Eye, RefreshCw, Coins, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import AdminBackButton from "@/components/AdminBackButton";

const SECTIONS = [
  ["overview", "Overview", Activity], ["saved", "Saved Games", Gamepad2],
  ["jobs", "Builds & Jobs", Hammer], ["published", "Published Games", Eye],
  ["resources", "Engagement Resources", Flame], ["ledger", "Ledger Inspector", ListTree],
  ["economy", "Economy & Pricing", Coins], ["exchange", "Exchange", ArrowLeftRight],
  ["registry", "Runtimes & Styles", Layers], ["diagnostics", "Diagnostics & Migration", Database],
  ["access", "Access & Visibility", Shield],
];

export default function GameMakerAdmin() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const [ov, setOv] = useState(null);
  const [rows, setRows] = useState(null);
  const [ledgerQ, setLedgerQ] = useState({ username: "", resource: "" });
  const [migration, setMigration] = useState(null);
  const [sel, setSel] = useState({});

  useEffect(() => { apiClient.get("/admin/gamemaker/overview").then((r) => setOv(r.data)).catch(() => {}); }, []);

  const loadTab = useCallback(() => {
    setRows(null);
    if (tab === "saved" || tab === "published") apiClient.get("/gamemaker/saved").then((r) => setRows(r.data.games));
    else if (tab === "jobs") apiClient.get("/admin/gamemaker/jobs").then((r) => setRows(r.data.jobs));
    else if (tab === "resources") apiClient.get("/admin/resources").then((r) => setRows(r.data.resources));
    else if (tab === "ledger") apiClient.get("/admin/resources/ledger", { params: ledgerQ }).then((r) => setRows(r.data.transactions));
    else if (tab === "diagnostics") apiClient.get("/admin/gamemaker/migration/report").then((r) => setMigration(r.data)).catch((e) => setMigration({ error: e?.response?.data?.detail }));
  }, [tab, ledgerQ]);
  useEffect(() => { loadTab(); }, [loadTab]);

  const setAccess = async (mode) => {
    await apiClient.post("/admin/gamemaker/access", { mode });
    toast.success(`Game Maker access: ${mode}`);
    apiClient.get("/admin/gamemaker/overview").then((r) => setOv(r.data));
  };

  const applyMigration = async () => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length) { toast.error("Select games from the dry-run report first"); return; }
    const r = await apiClient.post("/admin/gamemaker/migration/apply", { game_ids: ids });
    toast.success(`Migration applied: ${r.data.results.filter((x) => x.result === "inserted").length} inserted`);
    loadTab();
  };

  const Stat = ({ label, value, color }) => (
    <div className="or-surface p-3 text-center rounded-xl">
      <div className="text-xl font-black" style={{ color: color || "var(--primary)" }}>{value ?? "—"}</div>
      <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto pb-12" data-testid="gamemaker-admin-page">
      <AdminBackButton />
      <h1 className="text-xl sm:text-2xl font-black mb-1 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
        <Sparkles size={20} style={{ color: "#C26BFF" }} /> OurRealm Game Maker — Admin</h1>
      <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
        Engines, runtimes, resources, pipelines, jobs, publishing and diagnostics. Founder only.</p>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Link to="/admin/gamemaker/studio" className="or-btn text-[11px]" data-testid="gm-admin-studio-link">
          <ImageIcon size={12} /> Game Maker Studio (projects)</Link>
        <Link to="/admin/games" className="or-btn or-btn-ghost text-[11px]">Game Library / Publishing</Link>
        <Link to="/admin/orai" className="or-btn or-btn-ghost text-[11px]">ORAi Dashboard</Link>
        <Link to="/gamemaker" className="or-btn or-btn-ghost text-[11px]">Public /gamemaker page</Link>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {SECTIONS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setParams({ tab: k })} data-testid={`gm-admin-tab-${k}`}
            className="px-3 py-1.5 rounded-full text-[10.5px] font-bold flex items-center gap-1"
            style={{ background: tab === k ? "var(--primary)" : "rgba(255,255,255,0.06)",
              color: tab === k ? "#04080f" : "var(--text-main)", border: "1px solid var(--border-col)" }}>
            <Icon size={11} /> {label}</button>
        ))}
      </div>

      {tab === "overview" && ov && (
        <div data-testid="gm-admin-overview">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            <Stat label="Published" value={ov.games?.published} color="#10E670" />
            <Stat label="Approved" value={ov.games?.approved} />
            <Stat label="Pending" value={ov.games?.pending_approval} color="#F4A73B" />
            <Stat label="Active Jobs" value={ov.jobs?.active} color="#2EA0FF" />
            <Stat label="Failed Jobs" value={ov.jobs?.failed} color="#FF5A6E" />
            <Stat label="Ledger Entries" value={ov.ledger_entries} color="#C26BFF" />
          </div>
          <div className="or-surface p-3 rounded-xl text-[11px]">
            <b>Access mode:</b> <span data-testid="gm-admin-access-mode">{ov.access?.mode}</span> ·
            <b> Runtimes:</b> {ov.runtimes?.filter((r) => r.status === "live").length} live, {ov.runtimes?.filter((r) => r.status !== "live").length} planned ·
            <b> Styles:</b> {ov.styles?.length}
          </div>
        </div>
      )}

      {(tab === "saved" || tab === "published") && (
        <div className="space-y-2" data-testid="gm-admin-games-list">
          {(rows || []).filter((g) => tab === "published" ? g.status === "published" : true).map((g) => (
            <div key={g.id} className="or-surface p-3 rounded-xl flex items-center gap-3 flex-wrap text-[11.5px]">
              <b className="flex-1 min-w-[140px]">{g.title}</b>
              <span className="or-chip text-[9px] uppercase">{g.status}</span>
              <span style={{ color: "var(--text-muted)" }}>{g.runtime} · v{g.version || 1}</span>
              {g.public_url && <code className="text-[10px]" style={{ color: "#2EE6FF" }}>{g.public_url}</code>}
              {g.foryou_post_id && <span className="or-chip text-[9px]">For You ✓</span>}
              <Link to={`/games?play=${g.id}`} className="or-btn or-btn-ghost text-[10px]">Play</Link>
            </div>
          ))}
          {rows && !rows.length && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No games yet.</p>}
        </div>
      )}

      {tab === "jobs" && (
        <div className="space-y-2" data-testid="gm-admin-jobs-list">
          <button className="or-btn or-btn-ghost text-[10px]" onClick={loadTab}><RefreshCw size={11} /> Refresh</button>
          {(rows || []).map((j) => (
            <div key={j.id} className="or-surface p-3 rounded-xl flex items-center gap-3 flex-wrap text-[11px]">
              <b>{j.kind}</b>
              <span className="or-chip text-[9px] uppercase" style={{
                color: j.phase === "completed" ? "#10E670" : j.phase === "failed" ? "#FF5A6E" : "#2EA0FF" }}>{j.phase}</span>
              <span style={{ color: "var(--text-muted)" }}>{j.pct || 0}% · @{j.username}</span>
              <span className="ml-auto text-[9.5px]" style={{ color: "var(--text-muted)" }}>{(j.created_at || "").slice(0, 19).replace("T", " ")}</span>
              {j.error && <span className="w-full text-[10px]" style={{ color: "#FF8A9A" }}>{j.error}</span>}
            </div>
          ))}
          {rows && !rows.length && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No jobs yet.</p>}
        </div>
      )}

      {tab === "resources" && (
        <div className="space-y-2" data-testid="gm-admin-resources-list">
          {(rows || []).map((r) => (
            <div key={r.key} className="or-surface p-3 rounded-xl flex items-center gap-3 flex-wrap text-[11.5px]">
              <span className="text-lg">{r.icon}</span>
              <b style={{ color: r.color }}>{r.name}</b>
              <code className="text-[10px]" style={{ color: "var(--text-muted)" }}>{r.key}</code>
              {r.adapter && <span className="or-chip text-[9px]">adapter: {r.adapter}</span>}
              <span className="or-chip text-[9px]">{r.enabled ? "enabled" : "disabled"}</span>
              <span className="or-chip text-[9px]">{r.public ? "public" : "internal"}</span>
              {r.frozen && <span className="or-chip text-[9px]" style={{ color: "#FF5A6E" }}>FROZEN</span>}
              {!r.adapter && (
                <button className="or-btn or-btn-ghost text-[10px] ml-auto" data-testid={`gm-res-freeze-${r.key}`}
                  onClick={async () => { await apiClient.patch(`/admin/resources/${r.key}`, { frozen: !r.frozen }); loadTab(); }}>
                  {r.frozen ? "Unfreeze" : "Freeze grants"}</button>)}
            </div>
          ))}
          <AdjustForm onDone={loadTab} />
        </div>
      )}

      {tab === "ledger" && (
        <div data-testid="gm-admin-ledger">
          <div className="flex gap-2 mb-2">
            <input className="or-input text-xs" placeholder="username" value={ledgerQ.username}
              onChange={(e) => setLedgerQ({ ...ledgerQ, username: e.target.value })} data-testid="gm-ledger-user-filter" />
            <input className="or-input text-xs" placeholder="resource key" value={ledgerQ.resource}
              onChange={(e) => setLedgerQ({ ...ledgerQ, resource: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            {(rows || []).map((t) => (
              <div key={t.id} className="or-surface p-2.5 rounded-lg flex items-center gap-2 flex-wrap text-[10.5px]">
                <b style={{ color: t.amount > 0 ? "#10E670" : "#FF8A5A" }}>{t.amount > 0 ? "+" : ""}{t.amount}</b>
                <span>{t.resource_key}</span>
                <span style={{ color: "var(--text-muted)" }}>@{t.username} · {t.source_type}{t.reason ? ` · ${t.reason}` : ""}</span>
                <span className="or-chip text-[8.5px] uppercase">{t.status}</span>
                <span className="ml-auto" style={{ color: "var(--text-muted)" }}>{(t.created_at || "").slice(0, 16).replace("T", " ")}</span>
                {t.status !== "reversed" && t.source_type !== "reversal" && (
                  <button className="or-btn or-btn-ghost text-[9px]" data-testid={`gm-ledger-reverse-${t.id}`}
                    onClick={async () => { const reason = window.prompt("Reversal reason (required):"); if (!reason) return;
                      await apiClient.post(`/admin/resources/transactions/${t.id}/reverse`, { reason }); toast.success("Reversed"); loadTab(); }}>
                    Reverse</button>)}
              </div>
            ))}
            {rows && !rows.length && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No transactions.</p>}
          </div>
        </div>
      )}

      {tab === "economy" && <EconomyTab />}
      {tab === "exchange" && <ExchangeTab />}

      {tab === "registry" && ov && (
        <div className="grid sm:grid-cols-2 gap-3" data-testid="gm-admin-registry">
          <div className="or-surface p-3 rounded-xl">
            <b className="text-xs uppercase tracking-widest block mb-2">Runtime Registry</b>
            {ov.runtimes?.map((r) => (
              <div key={r.key} className="flex items-center gap-2 py-1 text-[11px]">
                <span className="flex-1">{r.name}</span>
                <span className="or-chip text-[9px] uppercase" style={{ color: r.status === "live" ? "#10E670" : "#F4A73B" }}>{r.status}</span>
              </div>))}
          </div>
          <div className="or-surface p-3 rounded-xl">
            <b className="text-xs uppercase tracking-widest block mb-2">Animation Styles</b>
            {ov.styles?.map((s) => (
              <div key={s.key} className="py-1 text-[11px]">{s.name}</div>))}
          </div>
        </div>
      )}

      {tab === "diagnostics" && (
        <div data-testid="gm-admin-diagnostics">
          <div className="or-surface p-3 rounded-xl mb-3 text-[11px]">
            <b>Cloudflare-safe job test:</b>{" "}
            <button className="or-btn or-btn-ghost text-[10px]" data-testid="gm-run-delay-test"
              onClick={async () => { const r = await apiClient.post("/admin/gamemaker/test-delayed-job", { seconds: 90 });
                toast.success(`90s job started instantly — job ${r.data.job_id.slice(0, 8)}. Watch it in Builds & Jobs.`); }}>
              Run 90s delayed-provider simulation</button>
          </div>
          <div className="or-surface p-3 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <b className="text-xs uppercase tracking-widest flex items-center gap-1"><ScrollText size={12} /> Production Migration (dry-run report)</b>
              <button className="or-btn text-[10px] ml-auto" onClick={applyMigration} data-testid="gm-migration-apply">
                Apply selected (insert-only)</button>
            </div>
            {migration?.error && <p className="text-[11px]" style={{ color: "#FF8A9A" }}>{migration.error}</p>}
            {migration?.report && (
              <>
                <p className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>{migration.note}</p>
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {migration.report.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-[10.5px] py-0.5">
                      <input type="checkbox" checked={!!sel[g.id]} disabled={g.in_this_db}
                        onChange={(e) => setSel({ ...sel, [g.id]: e.target.checked })} data-testid={`gm-mig-check-${g.id}`} />
                      <b className="flex-1">{g.title}</b>
                      <span className="or-chip text-[8.5px]">{g.bundle_status}</span>
                      <span className="or-chip text-[8.5px]">{g.access_mode}</span>
                      <span style={{ color: g.in_this_db ? "#10E670" : "#F4A73B" }}>
                        {g.in_this_db ? `in DB (${g.db_status})` : "MISSING here"}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "access" && ov && (
        <div className="or-surface p-4 rounded-xl" data-testid="gm-admin-access">
          <b className="text-xs uppercase tracking-widest block mb-2">Who can create games at /gamemaker?</b>
          <div className="flex gap-2 flex-wrap">
            {["founder_only", "beta", "signed_in", "public"].map((m) => (
              <button key={m} onClick={() => setAccess(m)} data-testid={`gm-access-${m}`}
                className="px-3 py-1.5 rounded-full text-[10.5px] font-bold"
                style={{ background: ov.access?.mode === m ? "var(--primary)" : "rgba(255,255,255,0.06)",
                  color: ov.access?.mode === m ? "#04080f" : "var(--text-main)", border: "1px solid var(--border-col)" }}>
                {m.replace(/_/g, " ")}</button>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>
            Icon visibility never overrides permissions — creation is always re-checked server-side.</p>
        </div>
      )}
    </div>
  );
}

const EconomyTab = () => {
  const [rule, setRule] = useState(null);
  const [grid, setGrid] = useState(null);
  const [holds, setHolds] = useState([]);
  const [recon, setRecon] = useState(null);
  const load = () => {
    apiClient.get("/admin/gamemaker/pricing").then((r) => setRule(r.data.rules[0]));
    apiClient.get("/admin/gamemaker/pricing/preview").then((r) => setGrid(r.data.grid));
    apiClient.get("/admin/gamemaker/holds").then((r) => setHolds(r.data.holds));
    apiClient.get("/admin/gamemaker/reconciliation").then((r) => setRecon(r.data.fire));
  };
  useEffect(load, []);
  if (!rule) return null;
  return (
    <div className="space-y-3" data-testid="gm-admin-economy">
      <div className="or-surface p-3 rounded-xl">
        <b className="text-xs uppercase tracking-widest block mb-2">Pricing rule (active v{rule.version}) — saving creates a new version; existing quotes/holds keep theirs</b>
        <div className="flex gap-2 flex-wrap items-center text-[11px]">
          {["base_per_point", "economy_weight", "ai_power_weight", "minimum", "maximum"].map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</span>
              <input className="or-input text-xs w-20" defaultValue={rule[k]} id={`pr-${k}`} data-testid={`gm-pricing-${k}`} />
            </label>))}
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>curve</span>
            <select className="or-input text-xs" defaultValue={rule.curve} id="pr-curve"><option>linear</option><option>tiered</option></select>
          </label>
          <label className="flex items-center gap-1 text-[10px] mt-3">
            <input type="checkbox" defaultChecked={rule.founder_exempt} id="pr-exempt" /> founder exempt</label>
          <button className="or-btn text-[10.5px] mt-3" data-testid="gm-pricing-save"
            onClick={async () => {
              const body = { curve: document.getElementById("pr-curve").value,
                founder_exempt: document.getElementById("pr-exempt").checked };
              ["base_per_point", "economy_weight", "ai_power_weight", "minimum", "maximum"].forEach((k) => {
                body[k] = Number(document.getElementById(`pr-${k}`).value); });
              await apiClient.post("/admin/gamemaker/pricing", body);
              toast.success("New pricing version created"); load();
            }}>Save as new version</button>
        </div>
      </div>
      {grid && (
        <div className="or-surface p-3 rounded-xl overflow-x-auto">
          <b className="text-xs uppercase tracking-widest block mb-2">All 100 combinations (rows = Economy, cols = AI Power)</b>
          <table className="text-[9.5px]" data-testid="gm-pricing-grid"><tbody>
            <tr><td className="pr-2 font-bold">E\P</td>{Array.from({ length: 10 }, (_, i) => <td key={i} className="px-1.5 font-bold">{i + 1}</td>)}</tr>
            {grid.map((row, e) => (
              <tr key={e}><td className="pr-2 font-bold">{e + 1}</td>
                {row.map((v, p) => <td key={p} className="px-1.5 py-0.5" style={{ color: "var(--text-muted)" }}>{v}</td>)}</tr>))}
          </tbody></table>
        </div>)}
      {recon && (
        <div className="or-surface p-3 rounded-xl text-[11px]" data-testid="gm-reconciliation">
          <b className="text-xs uppercase tracking-widest">Fire Power reconciliation:</b>{" "}
          <span style={{ color: recon.outstanding_vs_expected_ok ? "#10E670" : "#FF5A6E" }}>
            {recon.outstanding_vs_expected_ok ? "✓ BALANCED" : `⚠ orphaned delta ${recon.orphaned_delta}`}</span>
          <span style={{ color: "var(--text-muted)" }}> · held out {recon.fire_removed_by_holds} · released {recon.fire_released} · open {recon.open_hold_total} · burned {recon.burned_total}</span>
        </div>)}
      <div className="or-surface p-3 rounded-xl">
        <b className="text-xs uppercase tracking-widest block mb-2">Holds</b>
        {holds.map((h) => (
          <div key={h.id} className="flex items-center gap-2 flex-wrap py-1 text-[10.5px]">
            <b>{h.amount} {h.resource_key}</b>
            <span className="or-chip text-[8.5px] uppercase" style={{ color: h.state === "held" ? "#F4A73B" : h.state === "burned" ? "#FF8A5A" : "#10E670" }}>{h.state}</span>
            <span style={{ color: "var(--text-muted)" }}>rule v{h.rule_version}{h.exempt ? " · founder exempt" : ""} · {(h.created_at || "").slice(0, 16).replace("T", " ")}</span>
            {h.state === "held" && (
              <button className="or-btn or-btn-ghost text-[9px] ml-auto" data-testid={`gm-hold-release-${h.id}`}
                onClick={async () => { const reason = window.prompt("Release reason (required):"); if (!reason) return;
                  await apiClient.post(`/admin/gamemaker/holds/${h.id}/release`, { reason }); toast.success("Released"); load(); }}>
                Release (reason required)</button>)}
          </div>))}
        {!holds.length && <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>No holds yet.</p>}
      </div>
    </div>
  );
};

const ExchangeTab = () => {
  const [rule, setRule] = useState(null);
  const [regs, setRegs] = useState([]);
  const load = () => {
    apiClient.get("/admin/gamemaker/exchange-rules").then((r) => setRule(r.data.rules[0]));
    apiClient.get("/admin/resources").then((r) => setRegs(r.data.resources));
  };
  useEffect(load, []);
  if (!rule) return null;
  return (
    <div className="space-y-3" data-testid="gm-admin-exchange">
      <div className="or-surface p-3 rounded-xl">
        <b className="text-xs uppercase tracking-widest block mb-2">Resource equivalences & eligibility (Fire Power = canonical unit, 1:1)</b>
        {regs.filter((r) => !r.archived).map((r) => (
          <div key={r.key} className="flex items-center gap-2 flex-wrap py-1 text-[10.5px]">
            <span>{r.icon}</span><b className="w-16">{r.name}</b>
            <label className="flex items-center gap-1">1 = <input className="or-input text-xs w-16" defaultValue={r.fire_equiv ?? 0}
              disabled={r.key === "fire"} id={`fe-${r.key}`} data-testid={`gm-equiv-${r.key}`} /> 🔥</label>
            {["build_eligible", "exchange_source", "exchange_dest"].map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input type="checkbox" defaultChecked={!!r[f]} disabled={r.key === "fire" && f !== "build_eligible"} id={`${f}-${r.key}`} />
                {f.replace(/_/g, " ")}</label>))}
            <button className="or-btn or-btn-ghost text-[9px]" data-testid={`gm-equiv-save-${r.key}`}
              onClick={async () => {
                const body = { fire_equiv: Number(document.getElementById(`fe-${r.key}`).value) };
                ["build_eligible", "exchange_source", "exchange_dest"].forEach((f) => {
                  body[f] = document.getElementById(`${f}-${r.key}`).checked; });
                if (r.key === "fire") { delete body.fire_equiv; delete body.exchange_source; delete body.exchange_dest; }
                await apiClient.patch(`/admin/resources/${r.key}`, body);
                toast.success(`${r.name} updated`); load();
              }}>Save</button>
          </div>))}
      </div>
      <div className="or-surface p-3 rounded-xl text-[11px]">
        <b className="text-xs uppercase tracking-widest block mb-2">Exchange rule (active v{rule.version})</b>
        <p style={{ color: "var(--text-muted)" }} className="text-[10px] mb-1">
          Allowed pairs (source→destination), one per line as "src,dst". Only listed directions are exchangeable — reverse pairs must be added explicitly (prevents arbitrage loops).</p>
        <textarea className="or-input text-xs w-full h-20" id="ex-pairs" data-testid="gm-exchange-pairs"
          defaultValue={(rule.pairs || []).map((p) => p.join(",")).join("\n")} />
        <div className="flex gap-2 flex-wrap items-center mt-2">
          {["min_amount", "max_amount", "fee_pct"].map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              <span className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>{k.replace(/_/g, " ")}</span>
              <input className="or-input text-xs w-20" defaultValue={rule[k] ?? ""} id={`ex-${k}`} /></label>))}
          <label className="flex items-center gap-1 text-[10px] mt-3">
            <input type="checkbox" defaultChecked={rule.frozen} id="ex-frozen" data-testid="gm-exchange-freeze" /> freeze exchange globally</label>
          <button className="or-btn text-[10.5px] mt-3" data-testid="gm-exchange-save"
            onClick={async () => {
              const pairs = document.getElementById("ex-pairs").value.split("\n")
                .map((l) => l.split(",").map((x) => x.trim()).filter(Boolean)).filter((p) => p.length === 2);
              const bad = pairs.filter(([a, b]) => pairs.some(([c, d]) => a === d && b === c));
              if (bad.length && !window.confirm("Warning: reverse pairs detected — this can enable arbitrage loops with mismatched ratios. Continue?")) return;
              await apiClient.post("/admin/gamemaker/exchange-rules", {
                pairs, min_amount: Number(document.getElementById("ex-min_amount").value || 1),
                max_amount: Number(document.getElementById("ex-max_amount").value || 100000),
                fee_pct: Number(document.getElementById("ex-fee_pct").value || 0),
                frozen: document.getElementById("ex-frozen").checked });
              toast.success("New exchange rule version created"); load();
            }}>Save as new version</button>
        </div>
      </div>
    </div>
  );
};

const AdjustForm = ({ onDone }) => {
  const [f, setF] = useState({ username: "", key: "stars", amount: "", reason: "" });
  return (
    <div className="or-surface p-3 rounded-xl flex gap-2 flex-wrap items-center" data-testid="gm-adjust-form">
      <b className="text-[10.5px] uppercase tracking-widest w-full">Audited adjustment (reason required)</b>
      <input className="or-input text-xs w-28" placeholder="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} data-testid="gm-adjust-username" />
      <input className="or-input text-xs w-24" placeholder="resource" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} data-testid="gm-adjust-key" />
      <input className="or-input text-xs w-20" placeholder="+/- amt" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="gm-adjust-amount" />
      <input className="or-input text-xs flex-1 min-w-[120px]" placeholder="reason (required)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="gm-adjust-reason" />
      <button className="or-btn text-[10.5px]" data-testid="gm-adjust-submit"
        onClick={async () => {
          try {
            await apiClient.post(`/admin/resources/${f.key}/adjust`, { username: f.username, amount: Number(f.amount), reason: f.reason, request_id: `adj-${Date.now()}` });
            toast.success("Adjustment recorded"); onDone();
          } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
        }}>Apply</button>
    </div>
  );
};
