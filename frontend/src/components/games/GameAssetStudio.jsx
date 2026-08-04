import { useEffect, useRef, useState } from "react";
import { Palette, Upload, RotateCcw, Search, Sparkles, ShieldAlert, CheckCircle2, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

const QUALITIES = [[1, "Standard"], [2, "Detailed"], [3, "Premium"]];

const SlotCard = ({ s, prompt, checked, onCheck, onPromptChange, onUpload, onRollback, onLibrary }) => {
  const fileRef = useRef(null);
  const cur = s.current;
  return (
    <div className="rounded-xl p-2.5" data-testid={`asset-slot-${s.key}`}
      style={{ background: "rgba(255,255,255,.03)", border: `1px solid ${s.status === "ready" ? "#10E67055" : "rgba(255,255,255,.09)"}` }}>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(s.key, e.target.checked)}
          className="accent-[#F4A73B]" data-testid={`asset-check-${s.key}`} aria-label={`Select ${s.label}`} />
        <span className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>{s.label}</span>
        <span className="text-[8.5px] px-1.5 rounded-full" style={{ background: "rgba(255,255,255,.06)", color: "var(--text-muted)" }}>{s.kind}</span>
        {s.required_for_polished && <span className="text-[8.5px]" style={{ color: "#F4A73B" }}>required</span>}
        <span className="ml-auto text-[9px] font-bold uppercase" data-testid={`asset-status-${s.key}`}
          style={{ color: s.status === "ready" ? "#10E670" : "#7B8CFF" }}>{s.status}</span>
      </div>
      {cur && (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0" style={{ background: "#0b1220" }}>
            {s.anim && cur.meta?.frames > 1 ? (
              <div className="w-full h-full sprite-anim" style={{
                backgroundImage: `url(${cur.url})`, backgroundSize: `${cur.meta.frames * 100}% 100%`,
                animation: `spr-${s.key} ${cur.meta.frames / (cur.meta.fps || 6)}s steps(${cur.meta.frames - 1}) infinite` }} />
            ) : <img src={cur.url} alt={s.label} className="w-full h-full object-contain" />}
            {s.anim && cur.meta?.frames > 1 && (
              <style>{`@keyframes spr-${s.key}{from{background-position-x:0}to{background-position-x:-${(cur.meta.frames - 1) * 100}%}}`}</style>
            )}
          </div>
          <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
            {cur.meta?.width}×{cur.meta?.height}{cur.meta?.frames > 1 && ` · ${cur.meta.frames}f @${cur.meta.fps}fps`}
            {cur.meta?.tile && ` · ${cur.meta.tile.cols}×${cur.meta.tile.rows} tiles (${cur.meta.tile.tile_w}px, walkability mapped)`}
            <div>{cur.source} · {s.versions.length} version(s)</div>
          </div>
        </div>
      )}
      <input className="or-input w-full text-[10px] py-1 mt-1.5" value={prompt || ""}
        onChange={(e) => onPromptChange(s.key, e.target.value)} data-testid={`asset-prompt-${s.key}`}
        placeholder="Prompt (auto-suggested from the game spec)" />
      <div className="flex gap-1.5 mt-1.5">
        <button className="or-btn text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={() => fileRef.current?.click()}
          data-testid={`asset-upload-${s.key}`}><Upload size={9} />Upload</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => e.target.files?.[0] && onUpload(s.key, e.target.files[0])} />
        <button className="or-btn text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={() => onLibrary(s.key)}
          data-testid={`asset-library-${s.key}`}><Search size={9} />Reuse</button>
        {s.versions.length > 1 && (
          <button className="or-btn text-[9px] px-2 py-0.5 flex items-center gap-1" onClick={() => onRollback(s.key)}
            data-testid={`asset-rollback-${s.key}`}><RotateCcw size={9} />Rollback</button>
        )}
      </div>
    </div>
  );
};

export const GameAssetStudio = ({ game, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [m, setM] = useState(null);
  const [checked, setChecked] = useState({});
  const [prompts, setPrompts] = useState({});
  const [quality, setQuality] = useState(1);
  const [est, setEst] = useState(null);
  const [job, setJob] = useState(null);
  const [libFor, setLibFor] = useState(null);
  const [libRows, setLibRows] = useState([]);
  const [libQ, setLibQ] = useState("");
  const pollRef = useRef(null);

  const load = () => apiClient.get(`/admin/games/${game.id}/assets/manifest`).then((r) => {
    setM(r.data);
    setPrompts((p) => ({ ...r.data.suggestions, ...p }));
  }).catch((e) => toast.error(e?.response?.data?.detail || "Manifest failed"));

  useEffect(() => { if (open && !m) load(); }, [open]); // eslint-disable-line
  useEffect(() => () => clearInterval(pollRef.current), []);

  const selected = Object.keys(checked).filter((k) => checked[k]);

  const doEstimate = () => {
    if (!selected.length) { toast.error("Select at least one asset slot"); return; }
    apiClient.post(`/admin/games/${game.id}/assets/estimate`, { slots: selected, art_quality: quality })
      .then((r) => setEst(r.data.estimate))
      .catch((e) => toast.error(e?.response?.data?.detail || "Estimate failed"));
  };

  const generate = async () => {
    try {
      const { data } = await apiClient.post(`/admin/games/${game.id}/assets/generate`, {
        slots: selected, art_quality: quality, prompts,
        cost_ceiling: est.suggested_ceiling, idempotency_key: `${game.id}-${Date.now()}`,
      });
      setJob(data.job);
      toast.success(data.job.already_running ? "Job already running" : "Asset generation started");
      pollRef.current = setInterval(async () => {
        const r = await apiClient.get(`/admin/games/assets/jobs/${data.job.id}`).catch(() => null);
        if (!r) return;
        setJob(r.data.job);
        if (!["queued", "running"].includes(r.data.job.status)) {
          clearInterval(pollRef.current);
          load(); onChanged?.();
        }
      }, 3000);
    } catch (e) { toast.error(e?.response?.data?.detail || "Generation failed"); }
  };

  const upload = (slot, file) => {
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        await apiClient.post(`/admin/games/${game.id}/assets/${slot}/upload`,
          { b64: String(rd.result).split(",")[1], mime: file.type });
        toast.success("Asset uploaded & assembled into the runtime");
        load(); onChanged?.();
      } catch (e) { toast.error(e?.response?.data?.detail || "Upload failed"); }
    };
    rd.readAsDataURL(file);
  };

  const rollback = async (slot) => {
    try {
      await apiClient.post(`/admin/games/${game.id}/assets/${slot}/rollback`, { version_index: 1 });
      toast.success("Rolled back to previous version"); load(); onChanged?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Rollback failed"); }
  };

  const openLibrary = (slot) => {
    setLibFor(slot);
    apiClient.get(`/admin/games/assets/library?q=${encodeURIComponent(libQ)}`)
      .then((r) => setLibRows(r.data.assets || []));
  };
  const applyLib = async (assetId) => {
    try {
      await apiClient.post(`/admin/games/${game.id}/assets/${libFor}/use-library`, { asset_id: assetId });
      toast.success("Library asset reused — no regeneration cost"); setLibFor(null); load(); onChanged?.();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reuse failed"); }
  };

  return (
    <div className="or-surface p-3 mb-3" data-testid="game-asset-studio">
      <button className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{ color: "#2EE6FF" }} onClick={() => setOpen(!open)} data-testid="asset-studio-toggle">
        <Palette size={11} /> Asset Studio {open ? "▾" : "▸"}
        {m && (
          <span className="font-normal normal-case tracking-normal ml-1"
            style={{ color: m.art_status === "polished" ? "#10E670" : "var(--text-muted)" }}
            data-testid="art-status">
            {m.art_status} · {m.required_ready}/{m.required_total} required assets ready · profile: {m.profile}
          </span>
        )}
      </button>
      {open && !m && <div className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>Loading manifest…</div>}
      {open && m && (
        <div className="mt-3 space-y-2">
          {m.art_status !== "polished" && (
            <div className="text-[9.5px] flex items-center gap-1 p-1.5 rounded" style={{ background: "rgba(244,167,59,.08)", color: "#F4A73B" }}>
              <ShieldAlert size={10} /> Placeholder policy: this game renders procedural placeholders until all required slots are ready — "polished" status is blocked.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {m.slots.map((s) => (
              <SlotCard key={s.key} s={s} prompt={prompts[s.key]} checked={!!checked[s.key]}
                onCheck={(k, v) => { setChecked({ ...checked, [k]: v }); setEst(null); }}
                onPromptChange={(k, v) => setPrompts({ ...prompts, [k]: v })}
                onUpload={upload} onRollback={rollback} onLibrary={openLibrary} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              Art Quality
              <select className="or-input text-xs py-1 w-auto" value={quality}
                onChange={(e) => { setQuality(Number(e.target.value)); setEst(null); }} data-testid="art-quality-select">
                {QUALITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="text-[8.5px]">(separate from Complexity & AI Power)</span>
            </label>
            <button className="or-btn text-xs" onClick={doEstimate} data-testid="asset-estimate-btn">
              Estimate {selected.length} asset(s)
            </button>
          </div>
          {est && (
            <div className="rounded-lg p-2" style={{ background: "rgba(16,230,112,.06)", border: "1px solid #10E67044" }}
              data-testid="asset-estimate-panel">
              {est.items.map((i) => (
                <div key={i.slot} className="flex justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
                  <span>{i.label} ({est.art_quality})</span><span className="font-mono">${i.cost.toFixed(3)}</span>
                </div>
              ))}
              <div className="flex justify-between text-[11px] font-bold mt-1" style={{ color: "#10E670" }}>
                <span>Total · ceiling ${est.suggested_ceiling.toFixed(2)}</span>
                <span className="font-mono" data-testid="asset-estimate-total">${est.total.toFixed(2)}</span>
              </div>
              <p className="text-[8.5px] mt-0.5" style={{ color: "var(--text-muted)" }}>{est.disclaimer}</p>
              <button className="or-btn text-xs mt-1.5 font-bold flex items-center gap-1"
                style={{ background: "linear-gradient(90deg,#10E670,#2EE6FF)", color: "#06210F" }}
                onClick={generate} data-testid="asset-generate-approve-btn">
                <Sparkles size={12} /> Approve ${est.total.toFixed(2)} & Generate
              </button>
            </div>
          )}
          {job && (
            <div className="rounded-lg p-2 space-y-1" style={{ background: "rgba(46,160,255,.06)" }} data-testid="asset-job-panel">
              <div className="text-[10px] font-bold flex items-center gap-1.5" style={{ color: "#2EA0FF" }}>
                {["queued", "running"].includes(job.status) ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Job {job.status} · spent ${Number(job.spent || 0).toFixed(2)} / ceiling ${Number(job.cost_ceiling).toFixed(2)}
              </div>
              {job.slots.map((s) => (
                <div key={s.key} className="text-[9.5px] flex justify-between" style={{ color: "var(--text-muted)" }}>
                  <span>{s.key}</span>
                  <span style={{ color: s.status === "complete" ? "#10E670" : s.status === "failed" ? "#FF6B6B" : "#2EA0FF" }}
                    data-testid={`job-slot-${s.key}`}>{s.status}{s.error ? ` — ${s.error.slice(0, 60)}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {libFor && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,.7)" }}
          data-testid="asset-library-modal">
          <div className="or-surface w-full max-w-lg max-h-[75vh] flex flex-col p-3 rounded-2xl">
            <div className="flex gap-2 mb-2">
              <input className="or-input flex-1 text-xs" placeholder="Search game asset library…" value={libQ}
                onChange={(e) => setLibQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && openLibrary(libFor)}
                data-testid="asset-library-search" />
              <button className="or-btn text-xs" onClick={() => setLibFor(null)} data-testid="asset-library-close">Close</button>
            </div>
            <div className="overflow-y-auto grid grid-cols-3 gap-2">
              {!libRows.length && <div className="col-span-3 text-[10px] text-center py-4" style={{ color: "var(--text-muted)" }}>No reusable assets yet</div>}
              {libRows.map((a) => (
                <button key={a.id} className="rounded-lg p-1.5 text-left" style={{ background: "rgba(255,255,255,.04)" }}
                  onClick={() => applyLib(a.id)} data-testid={`lib-asset-${a.id}`}>
                  <img src={a.refs?.thumb || a.refs?.url} alt="" className="w-full h-16 object-contain rounded" style={{ background: "#0b1220" }} />
                  <div className="text-[8.5px] mt-1 truncate" style={{ color: "var(--text-muted)" }}>{a.title} · used {a.usage_count}×</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameAssetStudio;
