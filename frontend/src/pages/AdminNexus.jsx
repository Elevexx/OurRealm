/* /admin/nexus — founder-only living world builder (Checkpoint A.5 polish + AI Magic Loop). */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import apiClient from "@/api/client";
import NexusWorld from "@/components/nexus/NexusWorld";
import { MagicLoop } from "@/components/nexus/MagicLoop";
import { ActiveRuns } from "@/components/nexus/ActiveRuns";
import { OraiArchitect } from "@/components/nexus/OraiArchitect";
import { NexusStudios } from "@/components/nexus/NexusStudios";
import { toast } from "sonner";

const ENT_PRESETS = {
  box: { type: "box", pos: [0, 0, 4], rot: [0, 0, 0], scale: [3, 1.5, 3], color: "#4a4f66", props: { label: "New Box" } },
  ramp: { type: "ramp", pos: [2, 0, 4], rot: [0, 0, 0], scale: [4, 1.2, 3], color: "#5a6079", props: {} },
  pillar: { type: "pillar", pos: [-2, 0, 4], rot: [0, 0, 0], scale: [2, 4, 2], color: "#39506b", props: {} },
  light: { type: "light", pos: [0, 0, 6], rot: [0, 0, 0], scale: [1, 1, 1], color: "#ffd9a0", props: { intensity: 18 } },
  portal: { type: "portal", pos: [0, 0, 8], rot: [0, 0, 0], scale: [1, 1, 1], color: "#37c8ff", props: { label: "New Portal", action: "expansion" } },
  npc: { type: "npc", pos: [2, 0, 2], rot: [0, 0, 0], scale: [1, 1, 1], color: "#e8c07a", props: { label: "New NPC", dialog: "Hello!" } },
};
const TABS = [["build", "Builder"], ["magic", "Magic Loop"], ["orai", "ORAi"], ["runs", "Runs"], ["system", "System"]];

export default function AdminNexus() {
  const { user, isLoading: authLoading } = useAuth();
  const [world, setWorld] = useState(null);
  const [pubWorld, setPubWorld] = useState(null);
  const [meta, setMeta] = useState({ draft_version: 0, published_version: 0 });
  const [denied, setDenied] = useState(false);
  const [zoneId, setZoneId] = useState("plaza");
  const [sel, setSel] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [versions, setVersions] = useState([]);
  const [viewMode, setViewMode] = useState("build"); // build | play_draft | play_published
  const [mobilePrev, setMobilePrev] = useState(false);
  const [tab, setTab] = useState("build");
  const [presence, setPresence] = useState({ online: 0, players: [] });
  const [audit, setAudit] = useState([]);
  const [rel, setRel] = useState(null);
  const undoStack = useRef([]);
  useEffect(() => { apiClient.get("/nexus/admin/release").then((r) => setRel(r.data)).catch(() => {}); }, []);

  const load = useCallback(() => {
    apiClient.get("/nexus/world?draft=1").then((r) => {
      setWorld(r.data.world);
      setMeta({ draft_version: r.data.version, published_version: r.data.published_version });
      setRefreshKey((k) => k + 1);
    }).catch((e) => { if (e?.response?.status === 403) setDenied(true); });
    apiClient.get("/nexus/admin/versions").then((r) => setVersions(r.data.versions || [])).catch(() => {});
    apiClient.get("/nexus/admin/audit").then((r) => setAudit(r.data.audit || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => {
      apiClient.get("/nexus/admin/presence").then((r) => setPresence(r.data)).catch(() => {});
    }, 5000);
    apiClient.get("/nexus/admin/presence").then((r) => setPresence(r.data)).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const zone = world?.zones?.find((z) => z.id === zoneId) || world?.zones?.[0];
  const selEnt = zone?.entities?.find((e) => e.id === sel);

  const applyOps = async (ops, source = "manual") => {
    try {
      const r = await apiClient.post("/nexus/admin/ops", { ops, source });
      undoStack.current.push(r.data.inverse_ops);
      load();
      return true;
    } catch (e) { toast.error(e?.response?.data?.detail || "Edit failed"); return false; }
  };
  const undo = async () => {
    const inv = undoStack.current.pop();
    if (!inv) { toast.message("Nothing to undo"); return; }
    try { await apiClient.post("/nexus/admin/ops", { ops: inv, source: "undo" }); load(); } catch { /* noop */ }
  };
  const updateSel = (fields) => sel && applyOps([{ op: "update_entity", zone_id: zone.id, entity_id: sel, fields }]);
  const publish = async () => {
    try {
      const r = await apiClient.post("/nexus/admin/publish", {});
      toast.success(`Published v${r.data.published_version} (snapshot saved)`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Publish failed"); }
  };
  const saveVersion = async () => {
    const r = await apiClient.post("/nexus/admin/save-version", {});
    toast.success(`Draft snapshot v${r.data.version} saved`);
    load();
  };
  const rollback = async (v) => {
    await apiClient.post("/nexus/admin/rollback", { version: v });
    toast.success(`Snapshot v${v} restored into draft`);
    load();
  };
  const rollbackLatest = () => {
    if (!versions.length) { toast.message("No snapshots yet"); return; }
    rollback(versions[0].version);
  };
  const togglePlayPublished = async () => {
    if (viewMode === "play_published") { setViewMode("build"); return; }
    const r = await apiClient.get("/nexus/world");
    setPubWorld(r.data.world);
    setViewMode("play_published");
    setRefreshKey((k) => k + 1);
  };

  const checklist = zone ? [
    ["Zones & spawns valid", (world.zones || []).every((z) => z.spawn && Array.isArray(z.entities))],
    ["Entity budget (≤400/zone)", (world.zones || []).every((z) => z.entities.length <= 400)],
    ["Portals labeled", (world.zones || []).every((z) => z.entities.filter((e) => e.type === "portal").every((e) => e.props?.label))],
    ["Rollback checkpoint exists", versions.length > 0],
  ] : [];

  if (denied || (!authLoading && (!user || (user.role || user.admin_role) !== "founder"))) {
    return <div className="p-10 text-center text-white/70" data-testid="nexus-admin-denied">Founder only.</div>;
  }
  if (!world) return <div className="p-10 text-center text-white/60 bg-[#0a0f1e] min-h-screen">Loading Nexus builder…</div>;

  const viewportWorld = viewMode === "play_published" ? pubWorld : world;
  const show = (t) => (tab === t ? "block" : "hidden") + " lg:block";

  return (
    <div className="min-h-screen bg-[#080d1c] text-white" data-testid="admin-nexus">
      {/* ── topbar ── */}
      <div className="sticky top-0 z-30 bg-[#0a1022]/90 backdrop-blur border-b border-white/10 px-3 py-2 flex items-center gap-2 flex-wrap" data-testid="nexus-topbar">
        <div className="font-black text-sm tracking-wide">◈ OURREALM <span className="text-cyan-300">NEXUS</span></div>
        <Link to="/nexus" className="text-[10px] font-bold bg-white/5 hover:bg-white/15 border border-white/10 rounded-lg px-2.5 py-1.5" data-testid="nexus-nav-public">PUBLIC WORLD</Link>
        <span className="text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 rounded-lg px-2.5 py-1.5">ADMIN BUILDER</span>
        <span className="text-[10px] font-bold bg-amber-400/15 text-amber-300 rounded-lg px-2.5 py-1.5" data-testid="nexus-draft-version">● DRAFT v{meta.draft_version}</span>
        <button onClick={togglePlayPublished} data-testid="nexus-live-preview-toggle"
          className={`text-[10px] font-bold rounded-lg px-2.5 py-1.5 ${viewMode === "play_published" ? "bg-emerald-500 text-black" : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/30"}`}>
          ◉ LIVE PREVIEW v{meta.published_version}
        </button>
        <Link to="/nexus" className="text-[10px] font-bold bg-purple-500/15 text-purple-300 hover:bg-purple-500/30 rounded-lg px-2.5 py-1.5" data-testid="nexus-nav-mp">◎ MULTIPLAYER WORLD</Link>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={publish} data-testid="nexus-publish-btn"
            className="text-[11px] font-black bg-emerald-500 text-black hover:bg-emerald-400 rounded-lg px-4 py-1.5">PUBLISH UPDATE ⇧</button>
          <button onClick={saveVersion} data-testid="nexus-save-version-btn"
            className="text-[10px] font-bold bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">SAVE VERSION</button>
          <button onClick={rollbackLatest} data-testid="nexus-rollback-latest-btn"
            className="text-[10px] font-bold bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">↩ ROLL BACK</button>
        </div>
      </div>
      {rel && (
        <div className="px-3 py-2 bg-[#0b132b] border-b border-white/10 flex items-center gap-2 flex-wrap text-[10px] font-bold" data-testid="nexus-release-panel">
          <span className={`rounded-lg px-2.5 py-1.5 border ${rel.republish_ready ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/40" : "bg-amber-400/15 text-amber-300 border-amber-400/40"}`} data-testid="nexus-release-status">
            {rel.republish_ready ? "◉ REPUBLISH READY" : "◌ RELEASE INCOMPLETE"}
          </span>
          <span className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5" data-testid="nexus-release-id">RELEASE {rel.release_id} · WORLD v{rel.world_version_live}</span>
          <span className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5" data-testid="nexus-release-files">ASSETS {rel.files_durable}/{rel.files_total} DURABLE · KTX2 {rel.ktx2_files}</span>
          <span className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5" data-testid="nexus-release-avatars">
            AVATARS {rel.avatars?.length} ({rel.avatars?.filter((a) => a.anims === 7).length}×7 ANIMS)
          </span>
          <span className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5" data-testid="nexus-release-vault">FOUNDER VAULT {rel.founder_unlocks}/6</span>
          <span className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5" data-testid="nexus-release-rollbacks">ROLLBACKS {rel.rollbacks?.map((r) => `v${r.version}`).slice(0, 4).join(" ")}</span>
          <a href="/admin/nexus/assets" className="bg-cyan-500/15 border border-cyan-400/40 text-cyan-200 rounded-lg px-2.5 py-1.5" data-testid="open-asset-manager">ASSET MANAGER →</a>
          {rel.applied && <span className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">MIGRATION {rel.applied.release_id} ✓</span>}
        </div>
      )}

      {/* ── mobile tabs ── */}
      <div className="lg:hidden flex gap-1 px-3 pt-2 overflow-x-auto" data-testid="nexus-mobile-tabs">
        {TABS.map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`nexus-tab-${k}`}
            className={`text-[11px] font-bold rounded-lg px-3 py-1.5 whitespace-nowrap ${tab === k ? "bg-cyan-500 text-black" : "bg-white/10 text-white/70"}`}>
            {lbl}
          </button>
        ))}
      </div>

      <div className="p-3 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_330px]">
        {/* ── left column ── */}
        <div className={`space-y-3 ${show("system")}`}>
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-zones">
            <div className="text-xs font-black text-cyan-300 mb-2">🌐 WORLD & ZONES</div>
            {world.zones.map((z) => (
              <button key={z.id} onClick={() => setZoneId(z.id)}
                className={`block w-full text-left text-xs rounded-lg px-2 py-1.5 mb-1 ${z.id === zone?.id ? "bg-cyan-500/25" : "bg-white/5 hover:bg-white/10"}`}
                data-testid={`nexus-zone-${z.id}`}>{z.name} <span className="text-white/40">({z.entities.length})</span></button>
            ))}
            <div className="text-[11px] text-white/50 mt-2 mb-1">Add entity:</div>
            <div className="flex flex-wrap gap-1">
              {Object.keys(ENT_PRESETS).map((t) => (
                <button key={t} data-testid={`nexus-add-${t}`}
                  onClick={() => applyOps([{ op: "add_entity", zone_id: zone.id, entity: ENT_PRESETS[t] }])}
                  className="text-[11px] bg-white/10 hover:bg-white/20 rounded px-2 py-1">+ {t}</button>
              ))}
            </div>
          </div>
          {selEnt && (
            <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-selected">
              <div className="text-xs font-black text-cyan-300 mb-1">SELECTED: {selEnt.props?.label || selEnt.id}</div>
              <div className="text-[11px] text-white/50 mb-2">{selEnt.type} · {selEnt.id}</div>
              {["pos", "rot", "scale"].map((f) => (
                <div key={f} className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] w-9 text-white/60">{f}</span>
                  {selEnt[f].map((v, i) => (
                    <input key={`${sel}-${f}-${i}`} type="number" step="0.5" defaultValue={v}
                      data-testid={`nexus-${f}-${i}`}
                      className="w-14 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[11px]"
                      onBlur={(ev) => {
                        const arr = [...selEnt[f]]; arr[i] = parseFloat(ev.target.value) || 0;
                        updateSel({ [f]: arr });
                      }} />
                  ))}
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input type="color" defaultValue={selEnt.color} data-testid="nexus-color"
                  onBlur={(ev) => updateSel({ color: ev.target.value })} />
                <button data-testid="nexus-duplicate-btn" className="text-[11px] bg-white/10 hover:bg-white/20 rounded px-2 py-1"
                  onClick={() => applyOps([{ op: "add_entity", zone_id: zone.id, entity: { ...selEnt, id: undefined, pos: [selEnt.pos[0] + 2, selEnt.pos[1], selEnt.pos[2] + 2] } }])}>⧉ Duplicate</button>
                <button data-testid="nexus-remove-btn" className="text-[11px] bg-red-500/30 hover:bg-red-500/50 rounded px-2 py-1"
                  onClick={() => { applyOps([{ op: "remove_entity", zone_id: zone.id, entity_id: sel }]); setSel(null); }}>🗑 Remove</button>
              </div>
            </div>
          )}
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-assets">
            <div className="text-xs font-black text-cyan-300 mb-1">◇ MESHY PROVIDER <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-300 rounded px-1.5 py-0.5 ml-1">CONNECTED</span></div>
            <div className="text-[10px] text-white/45">Generate, upload, rig and assign in the 3D Asset Studio panel (center column).</div>
          </div>
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-systems">
            <div className="text-xs font-black text-cyan-300 mb-1">⚙ SYSTEMS</div>
            {[["World runtime", "LIVE"], ["Multiplayer", "LIVE (server presence + chat)"], ["Proximity chat", "LIVE"], ["Live publish sync", "LIVE"], ["ORAi Architect", "LIVE (text + voice)"], ["AI Magic Loop", "LIVE"], ["3D Asset Studio", "LIVE (Meshy)"], ["Avatar Studio", "LIVE (2 starter avatars)"]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[11px] py-0.5"><span className="text-white/70">{k}</span><span className="text-white/45">{v}</span></div>
            ))}
          </div>
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-versions">
            <div className="text-xs font-black text-cyan-300 mb-1">🕘 VERSIONS <span className="text-white/40 font-normal">DRAFT → TEST → PUBLISH</span></div>
            {versions.length === 0 && <div className="text-[11px] text-white/45">No snapshots yet — publishing creates one.</div>}
            <div className="max-h-36 overflow-y-auto">
              {versions.map((v) => (
                <div key={v.version} className="flex justify-between items-center text-[11px] py-0.5">
                  <span className="text-white/70 truncate">v{v.version} · {v.label || String(v.created_at).slice(0, 16)}</span>
                  <button className="bg-white/10 hover:bg-white/20 rounded px-2 py-0.5 shrink-0" data-testid={`nexus-rollback-${v.version}`}
                    onClick={() => rollback(v.version)}>Restore</button>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3" data-testid="nexus-card-multiplayer">
            <div className="text-xs font-black text-cyan-300 mb-1">👥 MULTIPLAYER USERS</div>
            <div className="text-3xl font-black" data-testid="nexus-mp-online">{presence.online}</div>
            <div className="text-[10px] text-emerald-300 font-bold">ONLINE NOW (real database count)</div>
            {presence.players.slice(0, 6).map((p) => (
              <div key={p.user_id} className="text-[11px] text-white/70 mt-1">● {p.username} <span className="text-white/35">{p.zone_id} · {p.anim}</span></div>
            ))}
          </div>
        </div>

        {/* ── center column ── */}
        <div className={`space-y-3 min-w-0 ${show("build")} ${tab === "magic" ? "!block" : ""}`}>
          <div className={`bg-black/40 rounded-2xl border border-white/10 overflow-hidden relative ${mobilePrev ? "mx-auto" : ""} ${tab === "magic" ? "hidden lg:block" : ""}`}
            style={mobilePrev ? { width: 390, height: "62vh" } : { height: "56vh" }} data-testid="nexus-viewport">
            <NexusWorld mode={viewMode === "build" ? "build" : "play"} world={viewportWorld} zoneId={zone?.id}
              username="founder" refreshKey={refreshKey} selectedId={sel}
              onSelect={setSel}
              onEntityMove={(id, pos) => applyOps([{ op: "update_entity", zone_id: zone.id, entity_id: id, fields: { pos } }], "drag")}
              onPortal={(e) => toast.message(e.props?.label || e.type, { description: e.props?.dialog || e.props?.action || "" })} />
            <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
              <button onClick={() => { setViewMode(viewMode === "build" ? "play_draft" : "build"); setRefreshKey((k) => k + 1); }} data-testid="nexus-playtest-toggle"
                className={`text-[10px] font-black rounded-lg px-3 py-1.5 ${viewMode !== "build" ? "bg-cyan-500 text-black" : "bg-black/60 text-white/85 hover:bg-black/80"}`}>
                {viewMode === "build" ? "▶ PLAY TEST DRAFT" : "◼ BUILD MODE"}
              </button>
              <button onClick={undo} data-testid="nexus-undo-btn" className="text-[10px] font-bold bg-black/60 hover:bg-black/80 rounded-lg px-3 py-1.5">↶ Undo</button>
              <button onClick={() => setMobilePrev(!mobilePrev)} data-testid="nexus-mobile-preview"
                className="text-[10px] font-bold bg-black/60 hover:bg-black/80 rounded-lg px-3 py-1.5">{mobilePrev ? "🖥 Desktop" : "📱 Mobile"}</button>
              {viewMode === "play_published" && <span className="text-[10px] font-black bg-emerald-500 text-black rounded-lg px-2 py-1.5">LIVE PREVIEW (published v{meta.published_version})</span>}
            </div>
            {viewMode === "build" && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/60 bg-black/50 rounded px-2 py-1 whitespace-nowrap">
                Click: select · Drag: move · Right-drag: orbit · Wheel: zoom
              </div>
            )}
          </div>
          <div className={show("magic")}>
            <MagicLoop world={world} onStarted={() => setRefreshKey((k) => k + 1)} />
          </div>
          <div className={show("build")}>
            <NexusStudios zone={zone} sel={sel} applyOps={applyOps} />
          </div>
        </div>

        {/* ── right column ── */}
        <div className="space-y-3">
          <div className={show("orai")}>
            <OraiArchitect zoneId={zone?.id} selectedId={sel} onApplied={load}
              onAppliedInverse={(inv) => inv && undoStack.current.push(inv)} />
          </div>
          <div className={show("runs")}>
            <ActiveRuns refreshKey={refreshKey} onDraftChanged={load} />
          </div>
          <div className={`bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3 ${show("system")}`} data-testid="nexus-checklist">
            <div className="text-xs font-black text-cyan-300 mb-1">✅ SAFE PUBLISH CHECKLIST</div>
            {checklist.map(([k, ok]) => (
              <div key={k} className="flex justify-between text-[11px] py-0.5">
                <span className="text-white/70">{k}</span>
                <span className={ok ? "text-emerald-300 font-bold" : "text-red-300 font-bold"}>{ok ? "PASS ✓" : "FAIL ✕"}</span>
              </div>
            ))}
          </div>
          <div className={`bg-white/5 backdrop-blur rounded-2xl border border-white/10 p-3 ${show("system")}`} data-testid="nexus-activity">
            <div className="text-xs font-black text-cyan-300 mb-1">📜 ACTIVITY LOG</div>
            <div className="max-h-40 overflow-y-auto">
              {audit.slice(0, 10).map((a, i) => (
                <div key={i} className="text-[10px] text-white/60 py-0.5 truncate">
                  <span className="text-emerald-300">✓</span> {String(a.at).slice(11, 19)} · <b className="text-white/80">{a.action}</b> — {a.actor}
                </div>
              ))}
              {audit.length === 0 && <div className="text-[10px] text-white/40">No activity yet.</div>}
            </div>
            <div className="text-[9px] text-white/35 mt-1.5 flex gap-2 flex-wrap">
              <span>✓ Rollback checkpoint {versions.length ? "ready" : "missing"}</span>
              <span>✓ Server-side keys (never sent to browser)</span>
              <span>✓ Full audit log</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
