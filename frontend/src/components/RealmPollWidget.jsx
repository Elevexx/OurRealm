/**
 * RealmPollWidget — default Phase-2 widget on every realm. Members can
 * vote (single-choice, idempotent). Admins can rename the question
 * and replace options via the inline edit form.
 *
 *   GET    /api/communities/realm/{realmId}/widgets             (parent fetches)
 *   POST   /widgets/{wid}/poll/vote                              (member)
 *   POST   /widgets/{wid}/poll/options                           (admin)
 *
 * Reuses the existing `or-surface` / `or-btn` / `or-chip` design
 * tokens so it slots into the existing realm visuals without touching
 * shared CSS.
 */
import React, { useMemo, useState } from "react";
import { BarChart3, Edit3, Plus, X, Loader2, Check, Trash2 } from "lucide-react";
import apiClient from "@/api/client";

export default function RealmPollWidget({ realmId, widget, isAdmin, onChanged, onDelete }) {
  const poll = widget?.poll || { results: [], total_votes: 0, my_vote: null };
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(widget?.config?.question || "");
  const [opts, setOpts] = useState((widget?.config?.options || []).map((o) => o.label));
  const [err, setErr] = useState("");

  const max = useMemo(() => Math.max(1, ...poll.results.map((r) => r.votes)), [poll]);

  const vote = async (optionId) => {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.post(
        `/communities/realm/${realmId}/widgets/${widget.id}/poll/vote`,
        { option_id: optionId },
      );
      onChanged && onChanged(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Vote failed");
    } finally { setBusy(false); }
  };

  const saveOptions = async () => {
    setBusy(true); setErr("");
    try {
      const cleaned = opts.map((o) => o.trim()).filter(Boolean);
      const { data } = await apiClient.post(
        `/communities/realm/${realmId}/widgets/${widget.id}/poll/options`,
        { question: question.trim(), options: cleaned },
      );
      onChanged && onChanged(data);
      setEditing(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <section className="or-surface p-4" data-testid={`realm-poll-widget-${widget.id}`}>
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={16} style={{ color: "var(--primary)" }} />
        <h3 className="text-base font-bold flex-1 truncate" style={{ fontFamily: "var(--font-display)" }} data-testid="realm-poll-question">
          {widget?.config?.question || "Poll"}
        </h3>
        {isAdmin && !editing && (
          <button onClick={() => setEditing(true)} className="or-chip" data-testid={`realm-poll-edit-${widget.id}`}><Edit3 size={12} /> Edit</button>
        )}
        {isAdmin && onDelete && (
          <button onClick={() => { if (window.confirm("Delete this poll widget?")) onDelete(widget.id); }} className="or-chip" data-testid={`realm-poll-delete-${widget.id}`} style={{ color: "#FF8080" }}><Trash2 size={12} /></button>
        )}
      </div>

      {!editing ? (
        <>
          <ul className="space-y-1.5" data-testid="realm-poll-options">
            {poll.results.map((r) => {
              const mine = poll.my_vote === r.id;
              const pct = poll.total_votes ? Math.round((r.votes / poll.total_votes) * 100) : 0;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => vote(r.id)}
                    disabled={busy}
                    data-testid={`realm-poll-option-${r.id}`}
                    className="w-full text-left p-2 rounded relative overflow-hidden"
                    style={{
                      background: mine ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "var(--surface-2)",
                      border: `1px solid ${mine ? "var(--primary)" : "var(--border-col)"}`,
                    }}
                  >
                    {/* Bar fill */}
                    <div
                      aria-hidden
                      style={{
                        position: "absolute", inset: 0,
                        width: `${(r.votes / max) * 100}%`,
                        background: mine ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "color-mix(in srgb, var(--brand-green) 12%, transparent)",
                        transition: "width 0.25s ease-out",
                      }}
                    />
                    <div className="relative flex items-center justify-between text-sm">
                      <span style={{ color: "var(--text-main)" }}>{r.label}</span>
                      <span className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                        {mine && <Check size={12} style={{ color: "var(--primary)" }} />}
                        <span>{r.votes}</span>
                        <span className="text-[10px]">({pct}%)</span>
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="text-[11px] mt-2 flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
            <span data-testid="realm-poll-total">{poll.total_votes} vote{poll.total_votes === 1 ? "" : "s"}</span>
            {busy && <Loader2 size={11} className="animate-spin" />}
          </div>
        </>
      ) : (
        <div data-testid={`realm-poll-edit-form-${widget.id}`}>
          <input
            className="or-input mb-2 text-sm"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Poll question"
            maxLength={200}
            data-testid="realm-poll-edit-question"
          />
          {opts.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1.5">
              <input
                className="or-input flex-1 text-sm"
                value={o}
                onChange={(e) => setOpts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Option ${i + 1}`}
                data-testid={`realm-poll-edit-option-${i}`}
              />
              {opts.length > 2 && (
                <button onClick={() => setOpts((prev) => prev.filter((_, j) => j !== i))} className="or-chip" data-testid={`realm-poll-edit-remove-${i}`}><X size={12} /></button>
              )}
            </div>
          ))}
          {opts.length < 10 && (
            <button onClick={() => setOpts((prev) => [...prev, ""])} className="or-chip mb-2" data-testid="realm-poll-edit-add"><Plus size={12} /> Add option</button>
          )}
          {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }}>{err}</div>}
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(false)} className="or-chip" data-testid="realm-poll-edit-cancel">Cancel</button>
            <button onClick={saveOptions} disabled={busy} className="or-btn" data-testid="realm-poll-edit-save">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save poll
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
