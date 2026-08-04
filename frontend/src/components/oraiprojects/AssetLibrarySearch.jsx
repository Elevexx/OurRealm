import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { Check, Search, Star, X } from "lucide-react";

const SpritePreview = ({ asset }) => {
  const m = asset.sprite_manifest;
  const ref = useRef(null);
  useEffect(() => {
    if (!m || !ref.current) return;
    let f = 0;
    const anim = m.animations?.idle || Object.values(m.animations || {})[0] || { frames: m.cols, fps: m.fps, row: 0 };
    const t = setInterval(() => {
      f = (f + 1) % (anim.frames || 1);
      if (ref.current) ref.current.style.backgroundPosition = `-${f * 48}px -${(anim.row || 0) * 48}px`;
    }, 1000 / (anim.fps || 8));
    return () => clearInterval(t);
  }, [m]);
  if (!m) {
    return asset.preview_url
      ? <img src={asset.preview_url} alt={asset.name} className="w-12 h-12 object-cover rounded" />
      : <div className="w-12 h-12 rounded" style={{ background: "rgba(255,255,255,.06)" }} />;
  }
  const scale = 48 / (m.frame_width || 48);
  return (
    <div className="w-12 h-12 rounded overflow-hidden" title={`${m.cols} frames @ ${m.fps}fps`}
      ref={ref}
      style={{ backgroundImage: `url(${asset.preview_url})`, backgroundRepeat: "no-repeat",
               backgroundSize: `${m.sheet_width * scale}px ${m.sheet_height * scale}px` }}
      data-testid={`sprite-preview-${asset.id}`} />
  );
};

export default function AssetLibrarySearch({ requirement, bpId, onPicked, onClose }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(requirement.category || "");
  const [categories, setCategories] = useState([]);
  const [favOnly, setFavOnly] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => {
      apiClient.get("/orai/projects/blueprints/library/search", {
        params: { q, category: category || undefined, runtime: requirement.target_runtime || undefined,
                  favorites: favOnly || undefined, limit: 12 },
      }).then((r) => { setRows(r.data.assets || []); setCategories(r.data.categories || []); })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(debRef.current);
  }, [q, category, favOnly, requirement.target_runtime]);

  const pick = async (asset) => {
    setBusy(true);
    try {
      const { data } = await apiClient.post(
        `/orai/projects/blueprints/${bpId}/assets/${requirement.req_id}/decision`,
        { decision: "use_suggested", asset_id: asset.id });
      onPicked(data.requirement);
      toast.success(`Using "${asset.name}" from your library`);
      onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not use asset"); }
    finally { setBusy(false); }
  };

  const toggleFav = async (asset) => {
    try {
      await apiClient.post(`/orai/projects/blueprints/library/${asset.id}/favorite`,
        { favorite: !asset.favorite });
      setRows((r) => r.map((a) => a.id === asset.id ? { ...a, favorite: !a.favorite } : a));
    } catch { /* ignore */ }
  };

  return (
    <div className="mt-2 p-2 rounded-lg" data-testid={`asset-search-${requirement.req_id}`}
      style={{ background: "rgba(46,230,255,.05)", border: "1px solid rgba(46,230,255,.2)" }}>
      <div className="flex flex-wrap gap-1.5 items-center mb-2">
        <Search size={11} style={{ color: "#2EE6FF" }} />
        <input className="or-input flex-1 text-[10.5px] py-1" placeholder="Search your asset library…"
          value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          data-testid="library-search-input" />
        <select className="or-input text-[10px] py-1" value={category}
          onChange={(e) => setCategory(e.target.value)} data-testid="library-category-select">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c.replaceAll("_", " ")}</option>)}
        </select>
        <button className={`text-[9.5px] px-2 py-1 rounded-full ${favOnly ? "font-bold" : ""}`}
          style={{ background: favOnly ? "rgba(244,167,59,.2)" : "rgba(255,255,255,.05)",
                   border: "1px solid rgba(255,255,255,.12)", color: favOnly ? "#F4A73B" : "var(--text-muted)" }}
          onClick={() => setFavOnly(!favOnly)} data-testid="library-favorites-filter">
          <Star size={9} className="inline mr-0.5" /> Favorites
        </button>
        <button className="or-btn text-[10px] py-1" onClick={onClose} data-testid="library-close-btn"><X size={10} /></button>
      </div>
      {rows.length === 0 ? (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="library-no-results">
          No matching library assets — try broader terms, another category, or choose "Generate later".
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" data-testid="library-results">
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-2 p-1.5 rounded"
              style={{ background: "rgba(255,255,255,.03)" }} data-testid={`library-asset-${a.id}`}>
              <SpritePreview asset={a} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold truncate">{a.name}</div>
                <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {a.category.replaceAll("_", " ")} · used {a.usage_count}× · v{a.version}
                </div>
              </div>
              <button onClick={() => toggleFav(a)} data-testid={`fav-${a.id}`}
                style={{ color: a.favorite ? "#F4A73B" : "var(--text-muted)" }}>
                <Star size={12} fill={a.favorite ? "#F4A73B" : "none"} />
              </button>
              <button className="or-btn text-[9.5px] px-2 py-1 flex items-center gap-1" disabled={busy}
                onClick={() => pick(a)} data-testid={`use-asset-${a.id}`}>
                <Check size={10} /> Use
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
