/**
 * CelebrationModal — shown ONLY after backend claim confirmation.
 * Respects prefers-reduced-motion (static fallback, no flashing).
 */
import React from "react";
import { Trophy, ArrowRight, Gift, X } from "lucide-react";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

export default function CelebrationModal({ result, onClose }) {
  React.useEffect(() => {
    if (!result) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, onClose]);

  if (!result) return null;
  const done = result.completed_level || {};
  const next = result.new_level;
  const accent = (done.graphics || {}).accent_color || "var(--primary)";
  const anim = !reduced();

  return (
    <div
      className="fixed inset-0 z-[320] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
      data-testid="level-celebration"
    >
      <div
        className="or-surface or-modal-card w-full max-w-sm p-6 text-center relative overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Level up celebration"
        style={{ maxHeight: "85dvh", ...(anim ? { animation: "or-celebrate-pop 0.45s ease" } : {}) }}
      >
        <style>{`@keyframes or-celebrate-pop{0%{transform:scale(.92);opacity:0}100%{transform:scale(1);opacity:1}}`}</style>
        <button onClick={onClose} className="absolute top-3 right-3 starbar-icon" style={{ width: 30, height: 30 }} aria-label="Close" data-testid="level-celebration-close">
          <X size={13} />
        </button>
        <div
          className="mx-auto mb-3 rounded-full flex items-center justify-center"
          style={{
            width: 72, height: 72,
            background: `color-mix(in srgb, ${accent} 18%, transparent)`,
            border: `2px solid ${accent}`,
            boxShadow: `0 0 26px color-mix(in srgb, ${accent} 45%, transparent)`,
          }}
        >
          {(done.graphics || {}).badge_url
            ? <img src={done.graphics.badge_url} alt={`${done.name} badge`} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
            : <Trophy size={32} style={{ color: accent }} aria-hidden="true" />}
        </div>
        <div className="text-xs uppercase tracking-[0.3em]" style={{ color: accent }}>Level Complete</div>
        <h2 className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)" }} data-testid="level-celebration-completed">
          {done.name}
        </h2>
        {done.celebration_message && (
          <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>{done.celebration_message}</p>
        )}
        {next ? (
          <div className="flex items-center justify-center gap-2 mt-4 text-sm" data-testid="level-celebration-next">
            <span style={{ color: "var(--text-muted)" }}>New level:</span>
            <ArrowRight size={14} style={{ color: accent }} />
            <b style={{ color: "var(--text-main)" }}>{next.name}</b>
          </div>
        ) : (
          <div className="mt-4 text-sm font-semibold" style={{ color: accent }} data-testid="level-celebration-highest">
            Highest Available Level Reached
          </div>
        )}
        {(result.rewards || []).filter((r) => r.status !== "already_granted").length > 0 && (
          <div className="mt-4 text-left" data-testid="level-celebration-rewards">
            <div className="text-xs uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>
              <Gift size={11} className="inline mr-1" aria-hidden="true" /> Rewards earned
            </div>
            <div className="flex flex-wrap gap-1.5">
              {result.rewards.map((r, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded-full"
                  style={{
                    background: r.status === "granted" ? `color-mix(in srgb, ${accent} 14%, transparent)` : "rgba(255,120,120,0.12)",
                    border: `1px solid ${r.status === "granted" ? accent : "rgba(255,120,120,0.4)"}`,
                    color: "var(--text-main)",
                  }}>
                  {r.status === "granted" ? "✓" : "…"} {r.name || `reward ${i + 1}`}
                </span>
              ))}
            </div>
          </div>
        )}
        <button className="or-btn w-full mt-5" onClick={onClose} data-testid="level-celebration-continue">
          Continue
        </button>
      </div>
    </div>
  );
}
