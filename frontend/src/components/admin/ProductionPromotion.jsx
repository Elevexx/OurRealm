import { useEffect, useRef, useState } from "react";
import { Rocket, ShieldCheck, Upload, Download, History, ChevronDown, ChevronUp } from "lucide-react";
import apiClient from "@/api/client";
import { toast } from "sonner";

export const ProductionPromotion = () => {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState(null);
  const [hist, setHist] = useState(null);
  const [verif, setVerif] = useState({});
  const fileRef = useRef(null);
  const isProd = window.location.host.includes("ourrealm.social");

  const load = () => apiClient.get("/admin/games/promotion/status").then((r) => setSt(r.data)).catch(() => {});
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line

  const seed = async () => {
    try {
      const r = await apiClient.post("/admin/games/promotion/seed", {});
      toast.success(`Seed bundles written: ${r.data.written.length} (skipped ${r.data.skipped.length})`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Seed failed"); }
  };
  const exportOne = async (gid, title) => {
    try {
      const r = await apiClient.get(`/admin/games/promotion/export/${gid}`);
      const blob = new Blob([JSON.stringify(r.data.bundle)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `${gid}.json`; a.click();
      toast.success(`Bundle exported: ${title}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Export failed"); }
  };
  const verify = async (gid) => {
    try {
      const r = await apiClient.get(`/admin/games/promotion/verify/${gid}`);
      setVerif((v) => ({ ...v, [gid]: r.data }));
      r.data.ok ? toast.success("Verified OK in this environment") : toast.error("Verification failed — see details");
    } catch (e) { toast.error("Verify failed"); }
  };
  const unpublish = async (gid) => {
    try { await apiClient.post(`/admin/games/promotion/unpublish/${gid}`); toast.success("Unpublished here"); load(); }
    catch (e) { toast.error("Unpublish failed"); }
  };
  const importFile = async (f) => {
    try {
      const bundle = JSON.parse(await f.text());
      const r = await apiClient.post("/admin/games/promotion/import", { bundle, force: false });
      toast[r.data.action === "skipped" ? "info" : "success"](`${r.data.action}: ${r.data.title || r.data.game_id} ${r.data.reason || ""}`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Import failed"); }
  };
  const loadHist = () => apiClient.get("/admin/games/promotion/history").then((r) => setHist(r.data.history)).catch(() => {});

  return (
    <div className="or-surface p-3 mb-3" data-testid="production-promotion-panel">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen(!open)} data-testid="production-promotion-toggle">
        <Rocket size={14} style={{ color: "#F4A73B" }} />
        <span className="text-[11px] font-bold uppercase tracking-wider flex-1" style={{ color: "var(--text-muted)" }}>
          Production Publishing — {isProd ? "PRODUCTION environment" : "PREVIEW environment"}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="mt-3">
          <div className="text-[10px] mb-2" style={{ color: "var(--text-muted)" }}>
            Preview and production use separate databases. Publishing here only affects this environment.
            {!isProd && " Click \"Write Seed Bundles\" then use Save to GitHub + Deploy — bundles auto-import into production at startup."}
            {isProd && " Import a bundle exported from preview, or wait for a redeploy carrying seed bundles."}
          </div>
          <div className="flex gap-2 flex-wrap mb-2">
            {!isProd && (
              <button className="or-btn text-[10px]" onClick={seed} data-testid="promotion-write-seeds">
                <Rocket size={10} className="inline mr-1" />Write Seed Bundles (all published)
              </button>)}
            <button className="or-btn text-[10px]" onClick={() => fileRef.current?.click()} data-testid="promotion-import">
              <Upload size={10} className="inline mr-1" />Import Bundle
            </button>
            <button className="or-btn text-[10px]" onClick={loadHist} data-testid="promotion-history-btn">
              <History size={10} className="inline mr-1" />Promotion History
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} />
          <div className="space-y-1" data-testid="promotion-game-list">
            {(st?.published_games || []).map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded p-1.5 text-[10px]" style={{ background: "rgba(255,255,255,.03)" }}>
                <span className="flex-1 truncate font-bold">{g.title}
                  {g.internal_test && <span style={{ color: "#FF5A6E" }}> (internal test — auto-skipped)</span>}
                  {g.seed_bundle && <span style={{ color: "#10E670" }}> ● seeded</span>}
                </span>
                <button className="or-btn text-[9px] px-1.5" onClick={() => exportOne(g.id, g.title)} data-testid={`promo-export-${g.id}`}><Download size={9} /></button>
                <button className="or-btn text-[9px] px-1.5" onClick={() => verify(g.id)} data-testid={`promo-verify-${g.id}`}><ShieldCheck size={9} /></button>
                <button className="or-btn text-[9px] px-1.5" onClick={() => unpublish(g.id)} data-testid={`promo-unpublish-${g.id}`}>Unpublish</button>
                {verif[g.id] && <span style={{ color: verif[g.id].ok ? "#10E670" : "#FF5A6E" }}>{verif[g.id].ok ? "OK" : "BROKEN"}</span>}
              </div>
            ))}
          </div>
          {hist && (
            <div className="mt-2 max-h-40 overflow-auto text-[9px]" data-testid="promotion-history">
              {hist.map((h, i) => (
                <div key={i} style={{ color: "var(--text-muted)" }}>
                  {h.at?.slice(0, 19)} · <b>{h.action}</b> · {h.title || h.game_id} · by {h.actor} {h.detail && `· ${h.detail}`}
                </div>))}
              {!hist.length && <div style={{ color: "var(--text-muted)" }}>No promotion actions yet.</div>}
            </div>)}
        </div>
      )}
    </div>
  );
};

export default ProductionPromotion;
