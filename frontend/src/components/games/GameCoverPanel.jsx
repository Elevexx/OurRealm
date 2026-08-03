import { useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { Image as ImageIcon, Upload, Trash2, RotateCcw, Sparkles, Pencil, X } from "lucide-react";

// Founder-only cover art workflow: suggested prompt (never auto-generated),
// generate/regenerate, edit prompt, upload, remove, restore previous.
export const GameCoverPanel = ({ game, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState(game.cover_suggestion || null);
  const [prompt, setPrompt] = useState(game.cover_suggestion?.prompt || "");
  const [showPrompt, setShowPrompt] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const fileRef = useRef(null);
  const hasCover = !!game.cover_url;
  const histCount = (game.cover_history || []).length;
  const estCost = sug?.est_cost ?? 0.04;

  useEffect(() => {
    let live = true;
    apiClient.get(`/admin/games/${game.id}/cover-suggestion`)
      .then((r) => { if (!live) return; setSug(r.data.suggestion); setPrompt((p) => p || r.data.suggestion?.prompt || ""); })
      .catch(() => {});
    return () => { live = false; };
  }, [game.id]);

  const call = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged && onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Cover action failed"); }
    finally { setBusy(false); }
  };

  const generate = () => {
    if (!window.confirm(`${hasCover ? "Regenerate" : "Generate"} cover with AI? Estimated cost $${estCost}`)) return;
    call(() => apiClient.post(`/admin/games/${game.id}/regen-cover`, prompt ? { prompt } : {}),
      hasCover ? "Cover regenerated" : "Cover generated");
  };
  const upload = (file) => {
    const rd = new FileReader();
    rd.onload = () => call(() => apiClient.post(`/admin/games/${game.id}/cover-upload`, { image_b64: rd.result }), "Cover uploaded");
    rd.readAsDataURL(file);
  };

  const btn = "or-btn text-xs";
  const suggestionOpen = showPrompt || (!hasCover && !skipped);
  return (
    <div className="mt-3 rounded-xl p-3" style={{ background: "rgba(244,167,59,0.05)", border: "1px solid rgba(244,167,59,0.25)" }}
      data-testid="game-cover-panel">
      <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#F4A73B" }}>
        <ImageIcon size={11} className="inline mr-1" />Cover Art
      </div>
      <div className="flex gap-3 items-start flex-wrap">
        <div className="rounded-lg overflow-hidden shrink-0" style={{ width: 96, aspectRatio: "4/5", border: "1px solid rgba(244,167,59,0.3)", background: "rgba(0,0,0,0.3)" }}
          data-testid="qa-cover-preview">
          {hasCover ? (
            <img src={game.cover_url} alt="cover" className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[9px] text-center p-1" style={{ color: "var(--text-muted)" }}
              data-testid="qa-cover-none">No cover — text card fallback</div>
          )}
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap gap-2">
            <button className={btn} disabled={busy} style={{ color: "#F4A73B" }} onClick={generate} data-testid="qa-cover-generate">
              <Sparkles size={12} /> {hasCover ? "Regenerate Cover" : "Generate Cover"}</button>
            <button className={btn} disabled={busy} onClick={() => { setShowPrompt(!showPrompt); setSkipped(false); }} data-testid="qa-cover-edit-prompt">
              <Pencil size={12} /> Edit Cover Prompt</button>
            <button className={btn} disabled={busy} onClick={() => fileRef.current?.click()} data-testid="qa-cover-upload">
              <Upload size={12} /> Upload Cover</button>
            {hasCover && (
              <button className={btn} disabled={busy} style={{ color: "#FF6B6B" }} data-testid="qa-cover-remove"
                onClick={() => window.confirm("Remove this cover? The card falls back to the text layout.") &&
                  call(() => apiClient.post(`/admin/games/${game.id}/cover-remove`), "Cover removed")}>
                <Trash2 size={12} /> Remove Cover</button>
            )}
            {histCount > 0 && (
              <button className={btn} disabled={busy} style={{ color: "#2EE6FF" }} data-testid="qa-cover-restore"
                onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/cover-restore`), "Previous cover restored")}>
                <RotateCcw size={12} /> Restore Previous ({histCount})</button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="qa-cover-upload-file"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
          {game.cover_meta && (
            <div className="text-[9px] mt-1.5" style={{ color: "var(--text-muted)" }} data-testid="qa-cover-meta">
              {game.cover_meta.source} · {game.cover_meta.model} · {game.cover_meta.card_crop}
              {game.cover_meta.cost ? ` · $${game.cover_meta.cost}` : ""}
            </div>
          )}
          {suggestionOpen && sug && (
            <div className="mt-2 rounded-lg p-2" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(244,167,59,0.2)" }}
              data-testid="qa-cover-suggestion">
              <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#F4A73B" }}>
                Suggested cover prompt
              </div>
              <textarea className="or-input w-full text-[10.5px]" rows={4} value={prompt} maxLength={900}
                onChange={(e) => setPrompt(e.target.value)} data-testid="qa-cover-prompt" />
              <div className="text-[9px] mt-1 flex flex-wrap gap-x-3" style={{ color: "var(--text-muted)" }} data-testid="qa-cover-suggestion-meta">
                <span>Aspect: <b>{sug.aspect_ratio}</b></span>
                <span>Style: <b>{sug.style}</b></span>
                <span data-testid="qa-cover-est-cost">Est. cost: <b style={{ color: "#F4A73B" }}>${estCost}</b></span>
              </div>
              {!hasCover && (
                <button className="or-btn or-btn-ghost text-[10px] mt-1.5" disabled={busy} data-testid="qa-cover-skip"
                  onClick={() => { setSkipped(true); setShowPrompt(false); }}>
                  <X size={10} /> Skip for Now</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameCoverPanel;
