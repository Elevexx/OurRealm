/**
 * QuickFireSheet — Increment B compact Quick Fire popup.
 * Opens on EVERY main Fire tap; nothing is sent until the user
 * explicitly confirms. The allowed range comes from the server
 * (/api/fire/quick-state/{postId}) — never a frontend formula.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flame, X, SlidersHorizontal, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

const FIRE_COLOR = "#FF7A1A";

export default function QuickFireSheet({ post, myFire, busy, onApply, onClose, onOpenFull, testidPrefix }) {
  const [qs, setQs] = useState(null);
  const [value, setValue] = useState(Math.max(myFire, 1));
  const sliderRef = useRef(null);

  useEffect(() => {
    let on = true;
    apiClient.get(`/fire/quick-state/${post.id}`)
      .then((r) => {
        if (!on) return;
        setQs(r.data);
        setValue(Math.max(1, Math.min(r.data.my_fire || 1, r.data.max_selectable)));
        setTimeout(() => sliderRef.current?.focus(), 60);
      })
      .catch(() => { if (on) setQs({ post_eligible: false, ineligible_reason: "Could not load Fire state", max_selectable: 1, my_fire: myFire, level_max: 1, available_boost: 0 }); });
    return () => { on = false; };
  }, [post.id]); // eslint-disable-line

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const max = Math.max(1, qs?.max_selectable ?? 1);
  const fixed = max <= 1;
  const current = qs?.my_fire ?? myFire;
  const unchanged = current > 0 && value === current;
  const finalized = qs?.finalized === true;
  const blocked = qs && qs.post_eligible === false;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      data-testid={`${testidPrefix}-quick`}
      role="dialog" aria-modal="true" aria-label="Quick Fire"
    >
      <div
        className="w-full sm:w-[340px] sm:rounded-2xl rounded-t-2xl p-4"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-col)",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.5)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <Flame size={18} style={{ color: FIRE_COLOR }} fill={FIRE_COLOR} aria-hidden="true" />
          <div className="flex-1 text-sm font-bold" style={{ color: FIRE_COLOR }}>Quick Fire</div>
          <button
            onClick={onOpenFull}
            className="starbar-icon"
            style={{ width: 32, height: 32 }}
            aria-label="Open full Fire Power controls"
            title="Open full Fire Power controls"
            data-testid={`${testidPrefix}-quick-full-open`}
          >
            <SlidersHorizontal size={13} />
          </button>
          <button onClick={onClose} className="starbar-icon" style={{ width: 32, height: 32 }}
            aria-label="Close Quick Fire" data-testid={`${testidPrefix}-quick-close`}>
            <X size={14} />
          </button>
        </div>

        {!qs ? (
          <div className="text-center py-5" data-testid={`${testidPrefix}-quick-loading`}>
            <Loader2 size={18} className="animate-spin inline" style={{ color: FIRE_COLOR }} />
          </div>
        ) : blocked ? (
          <div className="text-center py-4 text-xs" style={{ color: "var(--text-muted)" }}
            data-testid={`${testidPrefix}-quick-blocked`}>
            {qs.ineligible_reason || "Fire is unavailable for this post."}
          </div>
        ) : finalized && current > 0 ? (
          <div className="text-center py-3" data-testid={`${testidPrefix}-quick-finalized`}>
            <div className="text-2xl font-bold" style={{ color: FIRE_COLOR }}>{current}× 🔥</div>
            <div className="text-[11px] mt-1 font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              Finalized — can no longer be edited
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-1.5">
              <input
                ref={sliderRef}
                type="range" min={1} max={max} value={Math.min(value, max)}
                disabled={fixed}
                onChange={(e) => setValue(parseInt(e.target.value, 10))}
                className="flex-1"
                style={{ accentColor: FIRE_COLOR, opacity: fixed ? 0.7 : 1 }}
                aria-label="Fire amount"
                aria-valuemin={1} aria-valuemax={max} aria-valuenow={value}
                aria-valuetext={`${value} fire`}
                data-testid={`${testidPrefix}-quick-slider`}
              />
              <div className="text-lg font-bold shrink-0" style={{ color: FIRE_COLOR, minWidth: 52, textAlign: "right" }}
                aria-live="polite" data-testid={`${testidPrefix}-quick-value`}>
                {value}× 🔥
              </div>
            </div>

            <div className="text-[10px] mb-3 flex flex-wrap gap-x-2" style={{ color: "var(--text-muted)" }}
              data-testid={`${testidPrefix}-quick-meta`}>
              <span data-testid={`${testidPrefix}-quick-level-max`}>Level max {qs.level_max}×</span>
              <span aria-hidden="true">·</span>
              <span data-testid={`${testidPrefix}-quick-max-now`}>Up to {max}× now</span>
              {qs.boosted_enabled && (
                <>
                  <span aria-hidden="true">·</span>
                  <span data-testid={`${testidPrefix}-quick-boost-left`}>{qs.available_boost} boost left</span>
                </>
              )}
              {current > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span data-testid={`${testidPrefix}-quick-current`}>Current {current}×</span>
                </>
              )}
              {fixed && (
                <span className="w-full" data-testid={`${testidPrefix}-quick-fixed-note`}>
                  Fixed at 1× for your level — level up to unlock boosts.
                </span>
              )}
            </div>

            <button
              className="or-btn w-full"
              disabled={busy || unchanged}
              style={{ opacity: unchanged ? 0.55 : 1 }}
              onClick={() => !busy && !unchanged && onApply(value)}
              data-testid={`${testidPrefix}-quick-send`}
            >
              {busy ? <Loader2 size={14} className="animate-spin" />
                : <Flame size={14} fill="#fff" aria-hidden="true" />}
              {unchanged ? `Current: ${current}× 🔥` : `Send ${value}🔥`}
            </button>

            {current > 0 && (
              <button className="or-chip w-full justify-center mt-2" disabled={busy}
                onClick={() => onApply(0)} data-testid={`${testidPrefix}-quick-remove`}>
                Remove my {current}× 🔥
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
