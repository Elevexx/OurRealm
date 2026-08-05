import React, { useCallback, useEffect, useState } from "react";
import { Link2, Copy, ExternalLink, History } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

export default function GameUrlPanel({ gameId }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(null);
  const [hist, setHist] = useState([]);
  const [parent, setParent] = useState("");
  const [slug, setSlug] = useState("");
  const [avail, setAvail] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiClient.get(`/admin/games/${gameId}/url`);
    setCur(r.data.url);
    setHist(r.data.history);
    setParent(r.data.url?.parent_slug || "");
    setSlug(r.data.url?.game_slug || "");
  }, [gameId]);
  useEffect(() => { if (open && cur === null) load().catch(() => {}); }, [open, cur, load]);

  const check = async () => {
    const r = await apiClient.get("/admin/games/url-availability",
      { params: { parent, slug, game_id: gameId } });
    setAvail(r.data);
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiClient.put(`/admin/games/${gameId}/url`, { parent_slug: parent, game_slug: slug });
      toast.success("Public URL saved: " + r.data.url.full_path);
      setAvail(null); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };
  const restore = async (id) => {
    try { await apiClient.post(`/admin/games/${gameId}/url/restore`, { url_id: id });
      toast.success("Previous URL restored"); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Restore failed"); }
  };
  const disable = async () => {
    if (!window.confirm("Disable the custom URL? The ID route keeps working.")) return;
    await apiClient.delete(`/admin/games/${gameId}/url`);
    toast.success("Custom URL disabled"); await load();
  };
  const copy = async () => {
    const url = `${window.location.origin}${cur.full_path}`;
    try { await navigator.clipboard.writeText(url); toast.success("Copied: " + url); }
    catch { window.prompt("Copy the public link:", url); }
  };

  const preview = `/games/${parent || "…"}/${slug || "…"}`;
  return (
    <div className="mt-3 rounded-xl p-3" style={{ border: "1px solid rgba(194,107,255,0.35)", background: "rgba(194,107,255,0.05)" }}
      data-testid="game-url-panel">
      <button className="w-full text-left flex items-center gap-2" onClick={() => setOpen(!open)} data-testid="url-panel-toggle">
        <Link2 size={13} style={{ color: "#C26BFF" }} />
        <b className="text-[11px] uppercase tracking-widest flex-1" style={{ color: "#C26BFF" }}>Public URL</b>
        {cur?.full_path && <code className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{cur.full_path}</code>}
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2.5 text-[11px]">
          <div className="flex flex-wrap gap-2 items-center">
            <span style={{ color: "var(--text-muted)" }}>/games/</span>
            <input className="or-input text-xs w-36" value={parent} placeholder="dragonrealm"
              onChange={(e) => { setParent(e.target.value); setAvail(null); }} data-testid="url-parent-input" />
            <span style={{ color: "var(--text-muted)" }}>/</span>
            <input className="or-input text-xs w-36" value={slug} placeholder="firequest"
              onChange={(e) => { setSlug(e.target.value); setAvail(null); }} data-testid="url-slug-input" />
            <button className="or-btn or-btn-ghost text-[10px]" onClick={check} disabled={!parent || !slug}
              data-testid="url-check-btn">Check Availability</button>
          </div>
          <div data-testid="url-preview">Preview: <code style={{ color: "#2EE6FF" }}>{avail?.full_path || preview}</code>
            {avail && (
              <span className="ml-2 font-bold" data-testid="url-availability"
                style={{ color: avail.available ? "#10E670" : "#FF6B6B" }}>
                {avail.available ? "✓ Available" : `✗ ${avail.reason}`}</span>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="or-btn text-xs font-bold" style={{ background: "#C26BFF", color: "#0a0a0a" }}
              disabled={busy || !parent || !slug} onClick={save} data-testid="url-save-btn">Save URL</button>
            {cur && (<>
              <button className="or-btn or-btn-ghost text-xs" onClick={copy} data-testid="url-copy-btn">
                <Copy size={11} /> Copy Public Link</button>
              <a className="or-btn or-btn-ghost text-xs" href={cur.full_path} target="_blank" rel="noreferrer"
                data-testid="url-open-btn"><ExternalLink size={11} /> Open Public Page</a>
              <button className="or-btn or-btn-ghost text-xs" style={{ color: "#FF6B6B" }} onClick={disable}
                data-testid="url-disable-btn">Disable Custom URL</button>
            </>)}
          </div>
          {hist.length > 0 && (
            <div>
              <b className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                <History size={10} className="inline" /> URL history (old paths redirect to the newest URL)</b>
              <div className="space-y-1 mt-1 max-h-36 overflow-y-auto" data-testid="url-history-list">
                {hist.map((h) => (
                  <div key={h.id} className="flex items-center gap-2">
                    <code className="flex-1" style={{ color: "var(--text-muted)" }}>{h.full_path} · v{h.version}</code>
                    <button className="or-btn or-btn-ghost text-[9px]" onClick={() => restore(h.id)}
                      data-testid={`url-restore-${h.id}`}>Restore</button>
                  </div>))}
              </div>
            </div>)}
        </div>
      )}
    </div>
  );
}
