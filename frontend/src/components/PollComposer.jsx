/**
 * PollComposer — modal that builds a poll payload to attach to a new post.
 * 2–10 options, 1–100 chars each, emoji-safe (textarea/input encodes UTF-8).
 * Optional duration: none / 24h / 3d / 7d / 30d.
 */
import React, { useState } from "react";
import { Plus, X, Trash2, BarChart3, Clock } from "lucide-react";

const DURATIONS = [
  { id: 0,    label: "No expiration" },
  { id: 24,   label: "24 hours" },
  { id: 72,   label: "3 days" },
  { id: 168,  label: "7 days" },
  { id: 720,  label: "30 days" },
];

export default function PollComposer({ open, initial, onClose, onSave, testid = "poll-composer" }) {
  const [question, setQuestion]   = useState(initial?.question || "");
  const [options, setOptions]     = useState(initial?.options || ["", ""]);
  const [duration, setDuration]   = useState(initial?.duration_hours ?? 0);
  const [err, setErr] = useState("");

  if (!open) return null;
  const close = () => { setErr(""); onClose?.(); };

  const setOpt = (i, v) =>
    setOptions((arr) => arr.map((x, idx) => idx === i ? v.slice(0, 100) : x));
  const addOpt = () => setOptions((arr) => arr.length < 10 ? [...arr, ""] : arr);
  const removeOpt = (i) => setOptions((arr) => arr.length > 2 ? arr.filter((_, idx) => idx !== i) : arr);

  const save = () => {
    const q = question.trim();
    if (!q) { setErr("Add a poll question."); return; }
    if (q.length > 200) { setErr("Question is too long (max 200)."); return; }
    const opts = options.map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) { setErr("Add at least 2 options."); return; }
    if (opts.length > 10) { setErr("Max 10 options."); return; }
    setErr("");
    onSave?.({
      question: q,
      options: opts.map((text) => ({ text })),
      duration_hours: Number(duration) || 0,
    });
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={close}
      data-testid={`${testid}-overlay`}
    >
      <div
        className="or-surface w-full max-w-md p-4 max-h-[82vh] overflow-y-auto overflow-x-hidden"
        style={{ boxSizing: "border-box" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
        data-testid={testid}
      >
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={16} style={{ color: "var(--primary)" }} />
          <h3 className="text-lg flex-1" style={{ fontFamily: "var(--font-display)" }}>Create poll</h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={close} data-testid={`${testid}-close`} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Question</label>
        <input
          autoFocus
          className="or-input w-full mb-3 mt-1"
          placeholder="What's your vibe today?"
          maxLength={200}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          data-testid={`${testid}-question`}
        />

        <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Options ({options.length}/10)</label>
        <div className="space-y-2 mt-1 mb-3 max-h-[40vh] overflow-y-auto">
          {options.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="or-input flex-1 min-w-0"
                placeholder={`Option ${i + 1}`}
                maxLength={100}
                value={v}
                onChange={(e) => setOpt(i, e.target.value)}
                data-testid={`${testid}-option-${i}`}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOpt(i)}
                  className="starbar-icon"
                  style={{ width: 32, height: 32, color: "var(--text-muted)" }}
                  data-testid={`${testid}-remove-${i}`}
                  aria-label={`Remove option ${i + 1}`}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < 10 && (
          <button
            type="button"
            onClick={addOpt}
            className="or-btn or-btn-ghost w-full mb-3"
            data-testid={`${testid}-add-option`}
          >
            <Plus size={14} /> Add option
          </button>
        )}

        <label className="text-[11px] uppercase tracking-wider flex items-center gap-1.5 mb-1" style={{ color: "var(--text-muted)" }}>
          <Clock size={11} /> Duration
        </label>
        <select
          className="or-input w-full mb-3"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          data-testid={`${testid}-duration`}
        >
          {DURATIONS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>

        {err && (
          <div className="text-xs px-3 py-2 mb-2"
            style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}
            data-testid={`${testid}-error`}
          >{err}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button className="or-btn or-btn-ghost" onClick={close} data-testid={`${testid}-cancel`}>Cancel</button>
          <button className="or-btn" onClick={save} data-testid={`${testid}-save`}>
            <BarChart3 size={14} /> Attach poll
          </button>
        </div>
      </div>
    </div>
  );
}
