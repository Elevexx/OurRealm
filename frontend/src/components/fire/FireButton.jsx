/**
 * FireButton — the Fire Power reaction control for PUBLIC posts.
 * Quick tap = toggle 1x Fire (always unlimited). Long-press or the
 * boost chevron opens the Fire Picker with level-capped multipliers
 * and the rolling 24h Fire Meter. Backend is authoritative for every
 * limit; this UI only reflects state and rolls back on failure.
 */
import React, { useEffect, useRef, useState } from "react";
import { Flame, ChevronUp, X } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { usePostState, setPost } from "@/lib/postStore";
import { sendFire, updateCachedPool } from "@/lib/fireApi";

const PRESETS = [1, 2, 5, 10, 25, 50, 100];
const FIRE_COLOR = "#FF7A1A";

function nextRecoveryLabel(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "moments";
  const h = Math.floor(ms / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function FireButton({ post, fireStatus, isGuest, onGuestAction, testidPrefix }) {
  const seed = post.fire || {};
  const live = usePostState(post.id, {});
  const myFire = live.my_fire ?? seed.my_fire ?? 0;
  const total = live.fire_total ?? seed.total ?? post.fire_total ?? 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState(fireStatus?.pool || null);
  const holdTimer = useRef(null);
  const openedByHold = useRef(false);
  const rootRef = useRef(null);

  const cfg = fireStatus?.config || { max_fire_per_reaction: 1, daily_fire_pool: 0, fire_enabled: false };
  const boostAvailable = !!fireStatus?.boosted_enabled && cfg.fire_enabled && cfg.max_fire_per_reaction > 1;

  useEffect(() => {
    if (!pickerOpen) return undefined;
    apiClient.get("/fire/status")
      .then((r) => { setPool(r.data.pool); updateCachedPool(r.data.pool); })
      .catch(() => {});
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  const apply = async (value) => {
    if (isGuest) { onGuestAction?.("give Fire"); return; }
    if (busy) return;
    setBusy(true);
    const prev = { my_fire: myFire, fire_total: total };
    setPost(post.id, { my_fire: value, fire_total: Math.max(0, total - myFire + value) });
    try {
      const data = await sendFire(post.id, value);
      setPost(post.id, { my_fire: data.my_fire, fire_total: data.fire_total });
      if (data.pool) setPool(data.pool);
    } catch (e) {
      setPost(post.id, prev);
      toast.error(e?.response?.data?.detail || "Could not send Fire");
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  };

  const quickTap = (e) => {
    e?.stopPropagation();
    if (openedByHold.current) { openedByHold.current = false; return; }
    apply(myFire > 0 ? 0 : 1);
  };
  const startHold = () => {
    if (!boostAvailable) return;
    holdTimer.current = setTimeout(() => { openedByHold.current = true; setPickerOpen(true); }, 450);
  };
  const endHold = () => clearTimeout(holdTimer.current);

  const presets = PRESETS.filter((v) => v <= cfg.max_fire_per_reaction);
  if (boostAvailable && !presets.includes(cfg.max_fire_per_reaction)) presets.push(cfg.max_fire_per_reaction);
  const available = pool?.available ?? 0;
  const poolMax = pool?.pool_max ?? cfg.daily_fire_pool ?? 0;

  return (
    <div ref={rootRef} className="relative flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        data-testid={`${testidPrefix}-btn`}
        onClick={quickTap}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        aria-pressed={myFire > 0}
        aria-label={myFire > 0 ? `Remove your ${myFire}x Fire` : "Give 1x Fire"}
        className="flex items-center gap-1.5"
        style={{ color: myFire > 0 ? FIRE_COLOR : "var(--text-muted)" }}
        disabled={busy}
      >
        <Flame size={16} fill={myFire > 0 ? FIRE_COLOR : "none"} />
        <span data-testid={`${testidPrefix}-total`}>{total}</span>
        {myFire > 1 && (
          <span
            data-testid={`${testidPrefix}-my-multiplier`}
            className="text-[10px] font-bold px-1 rounded-full"
            style={{ background: "color-mix(in srgb, #FF7A1A 20%, transparent)", color: FIRE_COLOR }}
          >
            ×{myFire}
          </span>
        )}
      </button>
      {boostAvailable && (
        <button
          data-testid={`${testidPrefix}-boost-open`}
          onClick={() => setPickerOpen((o) => !o)}
          aria-label="Boost Fire"
          title="Boost Fire"
          className="flex items-center"
          style={{ color: pickerOpen ? FIRE_COLOR : "var(--text-muted)", padding: "0 2px" }}
        >
          <ChevronUp size={13} style={{ transform: pickerOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
        </button>
      )}

      {pickerOpen && (
        <div
          data-testid={`${testidPrefix}-picker`}
          className="absolute bottom-full left-0 mb-2 p-3 z-30"
          style={{
            width: 252, borderRadius: "var(--radius)",
            background: "var(--surface)", border: "1px solid var(--border-col)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
          }}
          role="dialog"
          aria-label="Fire Power picker"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: FIRE_COLOR }}>
              <Flame size={12} fill={FIRE_COLOR} /> Fire Power
            </span>
            <button onClick={() => setPickerOpen(false)} aria-label="Close" data-testid={`${testidPrefix}-picker-close`} style={{ color: "var(--text-muted)" }}>
              <X size={13} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {presets.map((v) => {
              const approxCost = v > 1 ? Math.max(v - Math.max(myFire, 1), 0) : 0;
              const blocked = v > 1 && v > myFire && approxCost > available;
              return (
                <button
                  key={v}
                  data-testid={`${testidPrefix}-pick-${v}`}
                  onClick={() => apply(v)}
                  disabled={busy || blocked}
                  className="text-xs font-bold px-2.5 py-1.5 rounded-full"
                  style={{
                    border: `1px solid ${myFire === v ? FIRE_COLOR : "var(--border-col)"}`,
                    color: myFire === v ? FIRE_COLOR : blocked ? "color-mix(in srgb, var(--text-muted) 45%, transparent)" : "var(--text-main)",
                    background: myFire === v ? "color-mix(in srgb, #FF7A1A 14%, transparent)" : "transparent",
                    cursor: blocked ? "not-allowed" : "pointer",
                  }}
                  title={blocked ? "Not enough Fire Power in your 24h pool" : `Give ${v}x Fire`}
                >
                  {v}×
                </button>
              );
            })}
            {myFire > 0 && (
              <button
                data-testid={`${testidPrefix}-pick-remove`}
                onClick={() => apply(0)}
                disabled={busy}
                className="text-xs px-2.5 py-1.5 rounded-full"
                style={{ border: "1px solid var(--border-col)", color: "var(--text-muted)" }}
              >
                Remove
              </button>
            )}
          </div>
          {/* Fire Meter — rolling 24h boost pool */}
          <div data-testid={`${testidPrefix}-meter`}>
            <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: "color-mix(in srgb, var(--text-muted) 18%, transparent)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${poolMax > 0 ? Math.min(100, (available / poolMax) * 100) : 0}%`,
                  background: FIRE_COLOR, transition: "width 300ms",
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span data-testid={`${testidPrefix}-meter-available`}>
                {available}/{poolMax} boost fire (24h pool)
              </span>
              {pool?.next_recovery_at && available < poolMax && (
                <span data-testid={`${testidPrefix}-meter-recovery`}>
                  +{pool.next_recovery_amount} in {nextRecoveryLabel(pool.next_recovery_at)}
                </span>
              )}
            </div>
            <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
              1× Fire is always free · Level max {cfg.max_fire_per_reaction}×
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
