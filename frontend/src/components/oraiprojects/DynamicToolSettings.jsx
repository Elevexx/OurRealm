import { useState } from "react";
import ExistingSoundPicker from "./ExistingSoundPicker";

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-[9.5px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</span>
    {children}
  </label>
);
const Sel = ({ value, onChange, options, testid }) => (
  <select className="or-input w-full text-xs py-1.5 mt-0.5" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);
const Num = ({ value, onChange, min, max, testid }) => (
  <input type="number" min={min} max={max} value={value} className="or-input w-full text-xs py-1.5 mt-0.5"
    onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} data-testid={testid} />
);

const Section = ({ title, color, children, testid }) => (
  <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,.03)", border: `1px solid ${color}44` }} data-testid={testid}>
    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color }}>{title}</div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{children}</div>
  </div>
);

export const SoundOptions = ({ sound, onChange, testidPrefix = "sound" }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const mode = sound?.mode || "none";
  return (
    <div className="col-span-2 sm:col-span-4">
      <span className="text-[9.5px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Sound</span>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {[["generate", "Generate New Sound"], ["existing", "Use Existing Sound"], ["none", "No Sound"]].map(([m, l]) => (
          <button key={m} className="text-[10px] px-2.5 py-1.5 rounded-full transition-colors"
            style={{ background: mode === m ? "rgba(16,230,112,.16)" : "rgba(255,255,255,.05)",
                     border: `1px solid ${mode === m ? "#10E670" : "rgba(255,255,255,.1)"}`,
                     color: mode === m ? "#10E670" : "var(--text-muted)" }}
            data-testid={`${testidPrefix}-mode-${m}`}
            onClick={() => { onChange({ ...sound, mode: m }); if (m === "existing") setPickerOpen(true); }}>
            {l}
          </button>
        ))}
      </div>
      {mode === "existing" && sound?.track_id && (
        <div className="text-[10px] mt-1" style={{ color: "#10E670" }} data-testid="sound-existing-selected">
          ♪ {sound.track_title || sound.track_id} — existing Sound reused, no new music-generation cost
          <button className="ml-2 underline" onClick={() => setPickerOpen(true)} data-testid="sound-change-btn">change</button>
        </div>
      )}
      <ExistingSoundPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
        onSelect={(tr) => { onChange({ ...sound, mode: "existing", track_id: tr.id, track_title: tr.title }); setPickerOpen(false); }} />
    </div>
  );
};

export const DynamicToolSettings = ({ tools, settings, onChange, caps }) => {
  const set = (tool, patch) => onChange({ ...settings, [tool]: { ...(settings[tool] || {}), ...patch } });
  const s = settings;
  const videoConnected = (caps?.providers || []).some((p) => p.id === "openai_video" && p.connected);
  return (
    <div className="space-y-2" data-testid="dynamic-tool-settings">
      {tools.includes("image") && (
        <Section title="Image Options" color="#C26BFF" testid="settings-image">
          <Field label="Image count"><Num value={s.image?.count ?? 4} onChange={(v) => set("image", { count: v })} min={1} max={12} testid="image-count" /></Field>
          <Field label="Aspect"><Sel value={s.image?.aspect || "1:1"} onChange={(v) => set("image", { aspect: v })} options={["1:1", "4:5", "16:9", "9:16"]} testid="image-aspect" /></Field>
          <Field label="Style"><Sel value={s.image?.style || "vivid digital art"} onChange={(v) => set("image", { style: v })}
            options={["vivid digital art", "photorealistic", "watercolor", "pixel art", "comic", "3d render", "minimalist"]} testid="image-style" /></Field>
          <Field label="Quality"><Sel value={s.image?.quality || "standard"} onChange={(v) => set("image", { quality: v })} options={["standard", "high"]} testid="image-quality" /></Field>
        </Section>
      )}
      {tools.includes("video") && (
        <Section title="Video Options" color="#2EA0FF" testid="settings-video">
          <Field label="Duration (s)"><Sel value={String(s.video?.seconds || 8)} onChange={(v) => set("video", { seconds: Number(v) })} options={["4", "8", "12"]} testid="video-seconds" /></Field>
          <Field label="Size"><Sel value={s.video?.size || "1280x720"} onChange={(v) => set("video", { size: v })}
            options={["1280x720", "720x1280", "1792x1024", "1024x1792"]} testid="video-size" /></Field>
          <Field label="Model"><Sel value={s.video?.model || "sora-2"} onChange={(v) => set("video", { model: v })} options={["sora-2", "sora-2-pro"]} testid="video-model" /></Field>
          {!videoConnected && <div className="col-span-2 text-[10px]" style={{ color: "#FF6B6B" }}>OpenAI Video not connected</div>}
          <SoundOptions sound={s.sound} onChange={(v) => onChange({ ...settings, sound: v })} testidPrefix="video-sound" />
        </Section>
      )}
      {tools.includes("audio") && (
        <Section title="Audio Options" color="#10E670" testid="settings-audio">
          <Field label="Voice"><Sel value={s.audio?.voice_id || "nova"} onChange={(v) => set("audio", { voice_id: v })}
            options={caps?.voices || ["nova"]} testid="audio-voice" /></Field>
          <Field label="Type"><Sel value={s.audio?.kind || "narration"} onChange={(v) => set("audio", { kind: v })} options={["narration"]} testid="audio-kind" /></Field>
          <div className="col-span-2">
            <Field label="Script (optional — ORAi writes one if empty)">
              <input className="or-input w-full text-xs py-1.5 mt-0.5" value={s.audio?.script || ""}
                onChange={(e) => set("audio", { script: e.target.value })} placeholder="Leave empty to auto-write"
                data-testid="audio-script" />
            </Field>
          </div>
          <SoundOptions sound={s.sound} onChange={(v) => onChange({ ...settings, sound: v })} testidPrefix="audio-sound" />
        </Section>
      )}
      {tools.includes("text") && (
        <Section title="Text Options" color="#7B8CFF" testid="settings-text">
          <Field label="Content type"><Sel value={s.text?.content_type || "article"} onChange={(v) => set("text", { content_type: v })}
            options={["article", "story", "script", "social captions", "marketing copy", "blog post"]} testid="text-type" /></Field>
          <Field label="Length"><Sel value={s.text?.length || "medium"} onChange={(v) => set("text", { length: v })} options={["short", "medium", "long"]} testid="text-length" /></Field>
          <Field label="Tone"><Sel value={s.text?.tone || "engaging"} onChange={(v) => set("text", { tone: v })} options={["engaging", "professional", "playful", "dramatic", "educational"]} testid="text-tone" /></Field>
          <Field label="Sections"><Num value={s.text?.sections ?? 3} onChange={(v) => set("text", { sections: v })} min={1} max={12} testid="text-sections" /></Field>
        </Section>
      )}
      {tools.includes("game") && (
        <Section title="Game Options (Game Studio)" color="#F4A73B" testid="settings-game">
          <Field label="Controls"><Sel value={s.game?.controls || "both"} onChange={(v) => set("game", { controls: v })} options={["both", "touch", "keyboard"]} testid="game-controls" /></Field>
          <div className="col-span-2 sm:col-span-3 text-[10px] self-end" style={{ color: "var(--text-muted)" }}>
            Runtime is auto-routed from your prompt across {caps?.game_runtimes?.length || 0} registered runtimes.
            Unsupported genres are proposed as substitutions — never silently forced.
          </div>
          <SoundOptions sound={s.sound} onChange={(v) => onChange({ ...settings, sound: v })} testidPrefix="game-sound" />
        </Section>
      )}
      {tools.includes("course") && (
        <Section title="Course Options (Course Maker)" color="#2EE6FF" testid="settings-course">
          <Field label="Responsibility Center">
            <select className="or-input w-full text-xs py-1.5 mt-0.5" value={s.course?.center_id || ""}
              onChange={(e) => set("course", { center_id: e.target.value })} data-testid="course-center">
              <option value="">— select —</option>
              {(caps?.course_centers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Grade level"><input className="or-input w-full text-xs py-1.5 mt-0.5" value={s.course?.grade_level || ""}
            onChange={(e) => set("course", { grade_level: e.target.value })} placeholder="e.g. Grade 5" data-testid="course-grade" /></Field>
          <Field label="Difficulty"><Sel value={s.course?.difficulty || "standard"} onChange={(v) => set("course", { difficulty: v })} options={["gentle", "standard", "challenging"]} testid="course-difficulty" /></Field>
          <Field label="Modules"><Num value={s.course?.modules ?? 3} onChange={(v) => set("course", { modules: v })} min={1} max={10} testid="course-modules" /></Field>
          <Field label="Lessons / module"><Num value={s.course?.lessons_per_module ?? 3} onChange={(v) => set("course", { lessons_per_module: v })} min={1} max={8} testid="course-lessons" /></Field>
          {(caps?.course_centers || []).length === 0 && (
            <div className="col-span-2 sm:col-span-3 text-[10px] self-end" style={{ color: "#FF6B6B" }}>
              No Responsibility Center found — create one first to build courses.
            </div>
          )}
        </Section>
      )}
    </div>
  );
};

export default DynamicToolSettings;
