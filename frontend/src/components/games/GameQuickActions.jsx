import { useRef, useState } from "react";
import apiClient from "@/api/client";
import { toast } from "sonner";
import { Pencil, Download, Upload, Music, Volume2, Image as ImageIcon, Save } from "lucide-react";

// Universal Founder editor: metadata form + quick actions (export/import,
// procedural audio rerolls, AI cover regen). Works for every runtime family.
export const GameQuickActions = ({ game, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: game.title || "", description: game.description || "",
    genre: game.genre || "", labels: (game.labels || []).join(", "),
    complexity: game.complexity || 1,
  });
  const fileRef = useRef(null);

  const call = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged && onChanged(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  const saveMeta = () => call(() => apiClient.patch(`/admin/games/${game.id}/meta`, {
    title: form.title, description: form.description, genre: form.genre,
    labels: form.labels.split(",").map((s) => s.trim()).filter(Boolean),
    complexity: Number(form.complexity) || 1,
  }), "Saved — new version created");

  const doExport = async () => {
    setBusy(true);
    try {
      const r = await apiClient.get(`/admin/games/${game.id}/export`);
      const blob = new Blob([JSON.stringify(r.data.export, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(game.title || "game").replace(/[^a-z0-9]+/gi, "_")}.ourrealm-game.json`;
      a.click();
      toast.success("Exported");
    } catch { toast.error("Export failed"); }
    finally { setBusy(false); }
  };

  const doImport = (file) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const doc = JSON.parse(rd.result);
        call(() => apiClient.post(`/admin/games/import`, { export: doc }), "Imported as a new game");
      } catch { toast.error("Invalid game file"); }
    };
    rd.readAsText(file);
  };

  const inputCls = "or-input w-full text-xs";
  return (
    <div className="mt-3 rounded-xl p-3" style={{ background: "rgba(46,230,255,0.04)", border: "1px solid rgba(46,230,255,0.18)" }}
      data-testid="game-quick-actions">
      <div className="flex flex-wrap gap-2 items-center">
        <button className="or-btn text-xs" disabled={busy} onClick={() => setOpen(!open)} data-testid="qa-edit-meta">
          <Pencil size={12} /> Edit</button>
        <button className="or-btn text-xs" disabled={busy} onClick={doExport} data-testid="qa-export">
          <Download size={12} /> Export</button>
        <button className="or-btn text-xs" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="qa-import">
          <Upload size={12} /> Import</button>
        <button className="or-btn text-xs" disabled={busy} data-testid="qa-reroll-music"
          onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/reroll-audio`, { kind: "music" }), "Music parameters rerolled")}>
          <Music size={12} /> Reroll Music</button>
        <button className="or-btn text-xs" disabled={busy} data-testid="qa-reroll-sfx"
          onClick={() => call(() => apiClient.post(`/admin/games/${game.id}/reroll-audio`, { kind: "sfx" }), "SFX parameters rerolled")}>
          <Volume2 size={12} /> Reroll SFX</button>
        <button className="or-btn text-xs" disabled={busy} style={{ color: "#F4A73B" }} data-testid="qa-regen-cover"
          onClick={() => window.confirm("Regenerate cover with AI? (uses 1 image credit)") &&
            call(() => apiClient.post(`/admin/games/${game.id}/regen-cover`, {}), "New cover generated")}>
          <ImageIcon size={12} /> Regenerate Cover</button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" data-testid="qa-import-file"
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
      </div>
      {open && (
        <div className="grid gap-2 mt-3" data-testid="qa-meta-form">
          <input className={inputCls} value={form.title} maxLength={150} placeholder="Title"
            onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="qa-meta-title" />
          <textarea className={inputCls} rows={2} value={form.description} maxLength={500} placeholder="Description"
            onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="qa-meta-description" />
          <div className="grid grid-cols-3 gap-2">
            <input className={inputCls} value={form.genre} placeholder="Genre"
              onChange={(e) => setForm({ ...form, genre: e.target.value })} data-testid="qa-meta-genre" />
            <input className={inputCls} value={form.labels} placeholder="Labels (comma separated)"
              onChange={(e) => setForm({ ...form, labels: e.target.value })} data-testid="qa-meta-labels" />
            <input className={inputCls} type="number" min={1} max={10} value={form.complexity} placeholder="Difficulty 1-10"
              onChange={(e) => setForm({ ...form, complexity: e.target.value })} data-testid="qa-meta-difficulty" />
          </div>
          <button className="or-btn text-xs font-bold w-fit" style={{ background: "#2EE6FF", color: "#0a0a0a" }}
            disabled={busy} onClick={saveMeta} data-testid="qa-meta-save"><Save size={12} /> Save (creates version)</button>
        </div>
      )}
    </div>
  );
};

export default GameQuickActions;
