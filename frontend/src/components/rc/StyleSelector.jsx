import React, { useEffect, useMemo, useState } from "react";
import { Palette, ChevronDown, ChevronUp, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

// Universal Animation Style selector — registry-driven (styles come from the
// backend DB, so new styles appear with zero UI changes). Supports primary +
// secondary blending, custom style prompt, camera language, quality sliders,
// advanced prompt controls and unlimited saved presets.
const QUALITY_KEYS = ["realism", "stylization", "detail", "lighting", "cinematic_quality",
  "motion_quality", "camera_movement", "texture_quality", "scene_complexity",
  "depth_of_field", "visual_effects", "saturation", "contrast"];
const ADV_KEYS = [["negative_prompt", "Negative prompt"], ["lighting_prompt", "Lighting"],
  ["motion_prompt", "Motion"], ["palette_prompt", "Color palette"], ["environment_prompt", "Environment"]];

export function recommendStyles(styles, gradeText = "", subjectText = "") {
  const g = (gradeText || "").toLowerCase();
  const s = (subjectText || "").toLowerCase();
  const picks = new Set();
  if (/music/.test(s)) ["neon", "retro80s", "cinematic_live", "vaporwave"].forEach((x) => picks.add(x));
  if (/history/.test(s)) ["documentary", "oil_painting", "medieval"].forEach((x) => picks.add(x));
  if (/science|robot|physic|chem|bio/.test(s)) ["realistic_3d", "motion_graphics", "scifi"].forEach((x) => picks.add(x));
  if (/math|fraction|algebra/.test(s)) ["whiteboard", "motion_graphics", "cartoon"].forEach((x) => picks.add(x));
  if (/cyber|security|hack/.test(s)) ["cyberpunk", "neon"].forEach((x) => picks.add(x));
  if (/business|finance|money/.test(s)) ["infographic", "motion_graphics"].forEach((x) => picks.add(x));
  if (/coding|program/.test(s)) ["pixel_art", "voxel", "motion_graphics"].forEach((x) => picks.add(x));
  if (/game|gaming/.test(s)) ["fortnite", "roblox", "anime", "voxel"].forEach((x) => picks.add(x));
  if (/art|paint|draw/.test(s)) ["watercolor", "oil_painting", "digital_painting"].forEach((x) => picks.add(x));
  if (/kinder|toddler|pre-?k|1st|2nd|3rd/.test(g)) ["cartoon", "childrens_book", "chibi", "pixar"].forEach((x) => picks.add(x));
  else if (/4th|5th|6th|element/.test(g)) ["pixar", "dreamworks", "stylized_3d"].forEach((x) => picks.add(x));
  else if (/7th|8th|middle/.test(g)) ["stylized_3d", "anime", "comic"].forEach((x) => picks.add(x));
  else if (/9th|10th|11th|12th|high/.test(g)) ["cinematic_live", "documentary", "motion_graphics"].forEach((x) => picks.add(x));
  else if (/college|adult|professional/.test(g)) ["photorealistic", "motion_graphics", "documentary"].forEach((x) => picks.add(x));
  return styles.filter((x) => picks.has(x.id)).slice(0, 5);
}

export default function StyleSelector({ value, onChange, gradeHint = "", subjectHint = "", compact = false }) {
  const [data, setData] = useState(null);
  const [presets, setPresets] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const p = value || {};
  const set = (patch) => onChange({ ...p, ...patch });

  useEffect(() => {
    apiClient.get("/ai-styles").then((r) => setData(r.data)).catch(() => {});
    apiClient.get("/ai-styles/presets").then((r) => setPresets(r.data.presets)).catch(() => {});
  }, []);

  const styles = data?.styles || [];
  const recs = useMemo(() => recommendStyles(styles, gradeHint, subjectHint), [styles, gradeHint, subjectHint]);
  const visible = showAll ? styles : styles.slice(0, compact ? 8 : 12);
  const primary = styles.find((s) => s.id === p.primary);

  const savePreset = async () => {
    const name = window.prompt("Preset name (e.g. OurRealm Neon):");
    if (!name?.trim()) return;
    try {
      await apiClient.post("/ai-styles/presets", { name: name.trim(), profile: p });
      const r = await apiClient.get("/ai-styles/presets");
      setPresets(r.data.presets);
      toast.success(`Preset "${name.trim()}" saved`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save preset"); }
  };
  const deletePreset = async (pr) => {
    await apiClient.delete(`/ai-styles/presets/${pr.id}`).catch(() => {});
    setPresets((x) => x.filter((y) => y.id !== pr.id));
  };

  if (!data) return null;
  return (
    <div data-testid="style-selector">
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <Palette size={12} style={{ color: "#2EE6FF" }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Animation style</span>
        {recs.length > 0 && (
          <span className="text-[9px]" style={{ color: "#10E670" }} data-testid="style-recommendations">
            ORAi recommends: {recs.map((r, i) => (
              <button key={r.id} className="underline mr-1" onClick={() => set({ primary: r.id })}>{r.name}{i < recs.length - 1 ? "," : ""}</button>
            ))}
          </span>
        )}
        {presets.length > 0 && (
          <select className="or-input text-[9px] ml-auto py-0.5" value=""
            onChange={(e) => { const pr = presets.find((x) => x.id === e.target.value); if (pr) { onChange({ ...pr.profile }); toast.success(`Preset "${pr.name}" applied`); } }}
            data-testid="style-preset-select">
            <option value="">Presets…</option>
            {presets.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </select>
        )}
      </div>

      <div className={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-6"}`} data-testid="style-cards">
        {visible.map((s) => {
          const sel = p.primary === s.id;
          return (
            <button key={s.id} type="button" onClick={() => set({ primary: s.id })}
              className="rounded-xl p-0 overflow-hidden text-left"
              style={{ border: sel ? "2px solid #2EE6FF" : "1px solid rgba(255,255,255,0.1)",
                       boxShadow: sel ? "0 0 12px rgba(46,230,255,0.35)" : "none" }}
              title={`${s.description} · Best for: ${s.recommended_subjects} · Ages ${s.recommended_ages} · ${s.difficulty}`}
              data-testid={`style-card-${s.id}`}>
              <div className="h-8" style={{ background: `linear-gradient(135deg, ${s.gradient[0]}, ${s.gradient[1]})` }} />
              <div className="px-1.5 py-1">
                <div className="text-[9px] font-bold truncate">{s.name}</div>
                {!compact && <div className="text-[7.5px] truncate" style={{ color: "var(--text-muted)" }}>{s.recommended_ages} · {s.difficulty}</div>}
              </div>
            </button>
          );
        })}
      </div>
      {styles.length > visible.length && (
        <button type="button" className="text-[9px] mt-1 underline" style={{ color: "var(--text-muted)" }}
          onClick={() => setShowAll(true)} data-testid="style-show-all">Show all {styles.length} styles…</button>
      )}
      {primary && !compact && (
        <div className="text-[9.5px] mt-1" style={{ color: "var(--text-muted)" }}>{primary.description} — best for {primary.recommended_subjects}.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        <div>
          <div className="text-[9px] font-bold mb-0.5" style={{ color: "var(--text-muted)" }}>Blend with a second style (optional)</div>
          <div className="flex items-center gap-2">
            <select className="or-input text-[10px] flex-1" value={p.secondary || ""}
              onChange={(e) => set({ secondary: e.target.value || undefined })} data-testid="style-secondary">
              <option value="">No blend</option>
              {styles.filter((s) => s.id !== "auto" && s.id !== p.primary).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {p.secondary && (
              <div className="flex items-center gap-1 text-[9px]" style={{ color: "var(--text-muted)" }}>
                <input type="range" min={10} max={90} step={5} value={p.mix ?? 70}
                  onChange={(e) => set({ mix: Number(e.target.value) })} className="w-20 accent-[#2EE6FF]" data-testid="style-mix-slider" />
                <span className="whitespace-nowrap">{p.mix ?? 70}% / {100 - (p.mix ?? 70)}%</span>
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-bold mb-0.5" style={{ color: "var(--text-muted)" }}>Camera style</div>
          <select className="or-input text-[10px] w-full" value={p.camera || "Auto"}
            onChange={(e) => set({ camera: e.target.value })} data-testid="style-camera">
            {(data.cameras || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <textarea className="or-input w-full text-[10px] mt-2" rows={2} maxLength={1000}
        placeholder='Custom Style Prompt — describe ANY visual style ("hand-painted Ghibli-style meadows with soft morning light…")'
        value={p.custom_prompt || ""} onChange={(e) => set({ custom_prompt: e.target.value })}
        data-testid="style-custom-prompt" />

      <div className="flex gap-3 mt-1 flex-wrap items-center">
        <button type="button" className="text-[9px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}
          onClick={() => setShowQuality(!showQuality)} data-testid="style-quality-toggle">
          {showQuality ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Visual quality controls
        </button>
        <button type="button" className="text-[9px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}
          onClick={() => setShowAdv(!showAdv)} data-testid="style-adv-toggle">
          {showAdv ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Advanced prompt controls
        </button>
        <button type="button" className="text-[9px] flex items-center gap-1 ml-auto" style={{ color: "#2EE6FF" }}
          onClick={savePreset} data-testid="style-save-preset"><Save size={10} /> Save preset</button>
        {presets.length > 0 && (
          <button type="button" className="text-[9px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}
            title="Delete a preset" onClick={() => { const name = window.prompt(`Delete which preset? (${presets.map((x) => x.name).join(", ")})`); const pr = presets.find((x) => x.name === name?.trim()); if (pr) deletePreset(pr); }}>
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {showQuality && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1 mt-1.5" data-testid="style-quality-sliders">
          {QUALITY_KEYS.map((k) => (
            <label key={k} className="text-[8.5px]" style={{ color: "var(--text-muted)" }}>
              {k.replace(/_/g, " ")} — {(p.quality || {})[k] ?? 5}
              <input type="range" min={0} max={10} value={(p.quality || {})[k] ?? 5} className="w-full accent-[#C26BFF]"
                onChange={(e) => set({ quality: { ...(p.quality || {}), [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      )}
      {showAdv && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1.5" data-testid="style-adv-fields">
          {ADV_KEYS.map(([k, label]) => (
            <input key={k} className="or-input text-[9.5px]" placeholder={label} value={p[k] || ""}
              onChange={(e) => set({ [k]: e.target.value })} data-testid={`style-adv-${k}`} />
          ))}
        </div>
      )}
      <div className="text-[8.5px] mt-1 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
        <Wand2 size={9} /> Applied to storyboard, AI illustrations and videos for a consistent look across the whole course. Lessons can override it in the video generator.
      </div>
    </div>
  );
}
