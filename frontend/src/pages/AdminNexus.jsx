/* /admin/nexus — founder-only living world builder (Image 1 reference layout). */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import apiClient from "@/api/client";
import NexusWorld from "@/components/nexus/NexusWorld";
import { toast } from "sonner";

const ENT_PRESETS = {
  box: { type: "box", pos: [0, 0, 4], rot: [0, 0, 0], scale: [3, 1.5, 3], color: "#4a4f66", props: { label: "New Box" } },
  ramp: { type: "ramp", pos: [2, 0, 4], rot: [0, 0, 0], scale: [4, 1.2, 3], color: "#5a6079", props: {} },
  pillar: { type: "pillar", pos: [-2, 0, 4], rot: [0, 0, 0], scale: [2, 4, 2], color: "#39506b", props: {} },
  light: { type: "light", pos: [0, 0, 6], rot: [0, 0, 0], scale: [1, 1, 1], color: "#ffd9a0", props: { intensity: 18 } },
  portal: { type: "portal", pos: [0, 0, 8], rot: [0, 0, 0], scale: [1, 1, 1], color: "#37c8ff", props: { label: "New Portal", action: "expansion" } },
  npc: { type: "npc", pos: [2, 0, 2], rot: [0, 0, 0], scale: [1, 1, 1], color: "#e8c07a", props: { label: "New NPC", dialog: "Hello!" } },
};

export default function AdminNexus() {
  const { user, isLoading: authLoading } = useAuth();
  const [world, setWorld] = useState(null);
  const [meta, setMeta] = useState({ draft_version: 0, published_version: 0 });
  const [denied, setDenied] = useState(false);
  const [zoneId, setZoneId] = useState("plaza");
  const [sel, setSel] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [versions, setVersions] = useState([]);
  const [playTest, setPlayTest] = useState(false);
  const [mobilePrev, setMobilePrev] = useState(false);
  const [oraiReq, setOraiReq] = useState("");
  const [proposal, setProposal] = useState(null);
  const [oraiBusy, setOraiBusy] = useState(false);
  const undoStack = useRef([]);

  const load = useCallback(() => {
    apiClient.get("/nexus/world?draft=1").then((r) => {
      setWorld(r.data.world);
      setMeta({ draft_version: r.data.version, published_version: r.data.published_version });
      setRefreshKey((k) => k + 1);
    }).catch((e) => { if (e?.response?.status === 403) setDenied(true); });
    apiClient.get("/nexus/admin/versions").then((r) => setVersions(r.data.versions || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const zone = world?.zones?.find((z) => z.id === zoneId) || world?.zones?.[0];
  const selEnt = zone?.entities?.find((e) => e.id === sel);

  const applyOps = async (ops, source = "manual") => {
    try {
      const r = await apiClient.post("/nexus/admin/ops", { ops, source });
      undoStack.current.push(r.data.inverse_ops);
      load();
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Edit failed");
      return false;
    }
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
  const rollback = async (v) => {
    await apiClient.post("/nexus/admin/rollback", { version: v });
    toast.success(`Snapshot v${v} restored into draft`);
    load();
  };
  const propose = async () => {
    if (!oraiReq.trim()) return;
    setOraiBusy(true);
    try {
      const r = await apiClient.post("/nexus/orai/propose", { request: oraiReq, zone_id: zone?.id, selected_entity: sel });
      setProposal(r.data.proposal);
    } catch (e) { toast.error(e?.response?.data?.detail || "ORAi proposal failed"); }
    setOraiBusy(false);
  };
  const decide = async (approve) => {
    try {
      await apiClient.post("/nexus/orai/decide", { proposal_id: proposal.id, approve });
      toast.success(approve ? "Applied to draft" : "Rejected");
      setProposal(null); setOraiReq(""); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Decision failed"); }
  };

  if (denied || (!authLoading && (!user || (user.admin_role !== "founder" && user.username !== "stealth")))) {
    return <div className="p-10 text-center text-white/70" data-testid="nexus-admin-denied">Founder only.</div>;
  }
  if (!world) return <div className="p-10 text-center text-white/60">Loading Nexus builder…</div>;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white p-4" data-testid="admin-nexus">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h1 className="text-xl font-black">NEXUS <span className="text-cyan-300">World Builder</span></h1>
        <span className="text-xs bg-white/10 rounded px-2 py-1" data-testid="nexus-draft-version">Draft v{meta.draft_version}</span>
        <span className="text-xs bg-emerald-500/20 text-emerald-300 rounded px-2 py-1">Published v{meta.published_version}</span>
        <button onClick={() => setPlayTest(!playTest)} data-testid="nexus-playtest-toggle"
          className="text-xs font-bold bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">{playTest ? "◼ Build Mode" : "▶ Play Test Draft"}</button>
        <button onClick={() => setMobilePrev(!mobilePrev)} data-testid="nexus-mobile-preview"
          className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">{mobilePrev ? "🖥 Desktop" : "📱 Mobile"} preview</button>
        <button onClick={undo} data-testid="nexus-undo-btn" className="text-xs bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">↶ Undo</button>
        <button onClick={publish} data-testid="nexus-publish-btn"
          className="text-xs font-bold bg-cyan-500 text-black hover:bg-cyan-400 rounded-lg px-4 py-1.5">Publish</button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "260px 1fr 300px", minHeight: "72vh" }}>
        <div className="space-y-3 overflow-y-auto" style={{ maxHeight: "78vh" }}>
          <div className="bg-white/5 rounded-xl p-3" data-testid="nexus-card-zones">
            <div className="text-xs font-bold text-cyan-300 mb-2">WORLD & ZONES</div>
            {world.zones.map((z) => (
              <button key={z.id} onClick={() => setZoneId(z.id)}
                className={`block w-full text-left text-xs rounded-lg px-2 py-1.5 mb-1 ${z.id === zone?.id ? "bg-cyan-500/25" : "bg-white/5"}`}
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
            <div className="bg-white/5 rounded-xl p-3" data-testid="nexus-card-selected">
              <div className="text-xs font-bold text-cyan-300 mb-1">SELECTED: {selEnt.props?.label || selEnt.id}</div>
              <div className="text-[11px] text-white/50 mb-2">{selEnt.type} · {selEnt.id}</div>
              {["pos", "rot", "scale"].map((f) => (
                <div key={f} className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] w-9 text-white/60">{f}</span>
                  {selEnt[f].map((v, i) => (
                    <input key={i} type="number" step="0.5" defaultValue={v}
                      data-testid={`nexus-${f}-${i}`}
                      className="w-14 bg-black/40 rounded px-1 py-0.5 text-[11px]"
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
                <button data-testid="nexus-duplicate-btn" className="text-[11px] bg-white/10 rounded px-2 py-1"
                  onClick={() => applyOps([{ op: "add_entity", zone_id: zone.id, entity: { ...selEnt, id: undefined, pos: [selEnt.pos[0] + 2, selEnt.pos[1], selEnt.pos[2] + 2] } }])}>⧉ Duplicate</button>
                <button data-testid="nexus-remove-btn" className="text-[11px] bg-red-500/30 rounded px-2 py-1"
                  onClick={() => { applyOps([{ op: "remove_entity", zone_id: zone.id, entity_id: sel }]); setSel(null); }}>🗑 Remove</button>
              </div>
            </div>
          )}
          <div className="bg-white/5 rounded-xl p-3" data-testid="nexus-card-assets">
            <div className="text-xs font-bold text-cyan-300 mb-1">3D ASSET STUDIO</div>
            <div className="text-[11px] text-white/55">Meshy generation, uploads and library assignment arrive in Checkpoint B. Provider: Meshy — connected.</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3" data-testid="nexus-card-systems">
            <div className="text-xs font-bold text-cyan-300 mb-1">SYSTEMS</div>
            {[["World runtime", "LIVE"], ["Multiplayer", "BETA (presence sync)"], ["ORAi Architect", "LIVE (text)"], ["Voice-to-voice", "Phase B"], ["Avatar Studio", "Phase C"]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-[11px] py-0.5"><span className="text-white/70">{k}</span><span className="text-white/45">{v}</span></div>
            ))}
          </div>
          <div className="bg-white/5 rounded-xl p-3" data-testid="nexus-card-versions">
            <div className="text-xs font-bold text-cyan-300 mb-1">VERSIONS</div>
            {versions.length === 0 && <div className="text-[11px] text-white/45">No snapshots yet — publishing creates one.</div>}
            {versions.map((v) => (
              <div key={v.version} className="flex justify-between items-center text-[11px] py-0.5">
                <span className="text-white/70">v{v.version} · {String(v.created_at).slice(0, 16)}</span>
                <button className="bg-white/10 rounded px-2 py-0.5" data-testid={`nexus-rollback-${v.version}`}
                  onClick={() => rollback(v.version)}>Restore</button>
              </div>
            ))}
          </div>
        </div>
        <div className={`bg-black/40 rounded-xl overflow-hidden relative ${mobilePrev ? "mx-auto" : ""}`}
          style={mobilePrev ? { width: 390, height: "72vh" } : { height: "78vh" }} data-testid="nexus-viewport">
          <NexusWorld mode={playTest ? "play" : "build"} world={world} zoneId={zone?.id}
            username="founder" refreshKey={refreshKey} selectedId={sel}
            onSelect={setSel}
            onEntityMove={(id, pos) => applyOps([{ op: "update_entity", zone_id: zone.id, entity_id: id, fields: { pos } }], "drag")}
            onPortal={(e) => toast.message(e.props?.label || e.type, { description: e.props?.dialog || e.props?.action || "" })} />
          {!playTest && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/60 bg-black/50 rounded px-2 py-1">
              Click: select · Drag: move on ground · Right-drag: orbit · Wheel: zoom
            </div>
          )}
        </div>
        <div className="bg-white/5 rounded-xl p-3 flex flex-col" style={{ maxHeight: "78vh" }} data-testid="nexus-card-orai">
          <div className="text-xs font-bold text-cyan-300 mb-2">ORAi WORLD ARCHITECT</div>
          <textarea value={oraiReq} onChange={(e) => setOraiReq(e.target.value)}
            placeholder='e.g. "Build a floating market beside the Emerald Portal" or "Make this zone brighter"'
            className="bg-black/40 rounded-lg p-2 text-xs h-24 resize-none" data-testid="nexus-orai-input" />
          <button onClick={propose} disabled={oraiBusy} data-testid="nexus-orai-propose-btn"
            className="mt-2 text-xs font-bold bg-purple-500/70 hover:bg-purple-500 rounded-lg px-3 py-2 disabled:opacity-50">
            {oraiBusy ? "Thinking…" : "Propose Edit"}
          </button>
          {proposal && (
            <div className="mt-3 bg-black/40 rounded-lg p-2 overflow-y-auto" data-testid="nexus-orai-proposal">
              <div className="text-[11px] font-bold text-purple-300 mb-1">PLAN</div>
              <div className="text-[11px] text-white/80">{proposal.plan}</div>
              <div className="text-[11px] font-bold text-purple-300 mt-2 mb-1">STRUCTURED DIFF ({proposal.ops.length} ops)</div>
              <pre className="text-[10px] text-white/60 whitespace-pre-wrap max-h-48 overflow-y-auto">{JSON.stringify(proposal.ops, null, 1)}</pre>
              <div className="flex gap-2 mt-2">
                <button onClick={() => decide(true)} data-testid="nexus-orai-approve-btn"
                  className="text-xs font-bold bg-emerald-500 text-black rounded-lg px-3 py-1.5">✓ Approve & Apply to Draft</button>
                <button onClick={() => decide(false)} data-testid="nexus-orai-reject-btn"
                  className="text-xs bg-white/10 rounded-lg px-3 py-1.5">Reject</button>
              </div>
            </div>
          )}
          <div className="mt-auto pt-2 text-[10px] text-white/40">
            ORAi never edits the published world directly. Every edit: Understand → Plan → Diff → Your approval → Draft.
          </div>
        </div>
      </div>
    </div>
  );
}
