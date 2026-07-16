/**
 * FireButton — Fire Power reaction control for PUBLIC posts.
 *  • Quick tap = toggle the free 1x 🔥 (never touches boosted fire; if the
 *    user already has a boost, tap opens the picker instead of downgrading).
 *  • Long-press OR the visible caret opens the Boost Picker.
 *  • Picker renders through a document.body portal (bottom sheet on
 *    mobile, centered dialog on desktop) so it can never be clipped by
 *    post cards, feed overflow, transforms, or the bottom navigation.
 * Backend stays authoritative; UI is optimistic with rollback.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flame, ChevronUp, X, Clock } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { usePostState, setPost } from "@/lib/postStore";
import { sendFire, updateCachedPool } from "@/lib/fireApi";

const PRESETS = [1, 2, 5, 10, 25, 50, 100];
const FIRE_COLOR = "#FF7A1A";
const HINT_KEY = "ourrealm.fireHint.v1";
let hintClaimed = false; // only ONE card shows the first-use hint per session

function recoveryLabel(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "moments";
  const h = Math.floor(ms / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ── Portal Boost Picker (bottom sheet ≤639px / centered dialog ≥640px) ── */
function FirePickerSheet({ post, cfg, pool, myFire, busy, onApply, onClose, testidPrefix }) {
  const [value, setValue] = useState(Math.max(myFire, 1));
  const max = Math.max(1, cfg.max_fire_per_reaction || 1);
  const available = pool?.available ?? 0;
  const poolMax = pool?.pool_max ?? cfg.daily_fire_pool ?? 0;
  const spent = pool?.spent ?? 0;
  const maxAffordable = Math.min(max, Math.max(myFire, 1) + available);
  const boostedExhausted = poolMax > 0 && available === 0;
  const simpleMode = max <= 1; // Newbie — no pointless slider
  const overBudget = value > maxAffordable;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const presets = PRESETS.filter((v) => v <= max);
  if (!presets.includes(max)) presets.push(max);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
      data-testid={`${testidPrefix}-picker`}
      role="dialog"
      aria-modal="true"
      aria-label="Fire Power picker"
    >
      <div
        className="w-full sm:w-[400px] sm:rounded-2xl rounded-t-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-col)",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.5)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — level identity */}
        <div className="flex items-center gap-3 mb-3">
          {cfg.level_badge_url ? (
            <img src={cfg.level_badge_url} alt={cfg.level_name || "Level badge"}
              style={{ width: 38, height: 38, objectFit: "contain" }}
              data-testid={`${testidPrefix}-picker-badge`} />
          ) : (
            <Flame size={26} style={{ color: FIRE_COLOR }} fill={FIRE_COLOR} />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: FIRE_COLOR }}>Fire Power</div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid={`${testidPrefix}-picker-level`}>
              {cfg.level_name ? `Level ${cfg.level_number} · ${cfg.level_name}` : `Level ${cfg.level_number}`} · Max {max}× per reaction
            </div>
          </div>
          <button onClick={onClose} className="starbar-icon" style={{ width: 34, height: 34 }}
            aria-label="Close Fire picker" data-testid={`${testidPrefix}-picker-close`}>
            <X size={15} />
          </button>
        </div>

        {/* Fire Meter — rolling 24h boost pool */}
        {poolMax > 0 && (
          <div className="mb-4" data-testid={`${testidPrefix}-meter`}>
            <div className="h-2 rounded-full overflow-hidden mb-1.5"
              style={{ background: "color-mix(in srgb, var(--text-muted) 18%, transparent)" }}>
              <div className="h-full rounded-full" style={{
                width: `${Math.min(100, (available / poolMax) * 100)}%`,
                background: FIRE_COLOR, transition: "width 300ms",
              }} />
            </div>
            <div className="flex items-center justify-between text-[11px] flex-wrap gap-1" style={{ color: "var(--text-muted)" }}>
              <span data-testid={`${testidPrefix}-meter-available`}>
                {available}/{poolMax} boost fire available · {spent} used (24h)
              </span>
              {pool?.next_recovery_at && available < poolMax && (
                <span className="flex items-center gap-1" data-testid={`${testidPrefix}-meter-recovery`}>
                  <Clock size={10} /> +{pool.next_recovery_amount} in {recoveryLabel(pool.next_recovery_at)}
                </span>
              )}
            </div>
          </div>
        )}

        {simpleMode ? (
          /* Newbie state — direct 1x, no slider */
          <div className="text-center py-2" data-testid={`${testidPrefix}-simple-state`}>
            <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              Your level sends 1× 🔥 — always free, always unlimited. Level up to unlock boosted Fire!
            </div>
            <button className="or-btn w-full" disabled={busy}
              onClick={() => onApply(myFire === 1 ? 0 : 1)}
              data-testid={`${testidPrefix}-send`}>
              <Flame size={14} fill="#fff" /> {myFire === 1 ? "Remove 1× 🔥" : "Send 1× 🔥"}
            </button>
          </div>
        ) : (
          <>
            {boostedExhausted && (
              <div className="text-[11px] mb-3 px-3 py-2 rounded-lg"
                style={{ background: "color-mix(in srgb, #F4C84A 12%, transparent)", color: "#F4C84A", border: "1px solid color-mix(in srgb, #F4C84A 35%, transparent)" }}
                data-testid={`${testidPrefix}-exhausted`}>
                Boosted Fire exhausted — 1× is still unlimited.
                {pool?.next_recovery_at && ` Next recovery: +${pool.next_recovery_amount} in ${recoveryLabel(pool.next_recovery_at)}.`}
              </div>
            )}

            {/* Synced slider + numeric input */}
            <div className="flex items-center gap-3 mb-3">
              <input
                type="range" min={1} max={max} value={Math.min(value, max)}
                onChange={(e) => setValue(parseInt(e.target.value, 10))}
                className="flex-1"
                style={{ accentColor: FIRE_COLOR, opacity: boostedExhausted && value > maxAffordable ? 0.5 : 1 }}
                aria-label="Fire amount"
                data-testid={`${testidPrefix}-slider`}
              />
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number" min={1} max={max} value={value}
                  onChange={(e) => {
                    const v = parseInt(e.target.value || "1", 10);
                    setValue(Math.max(1, Math.min(max, isNaN(v) ? 1 : v)));
                  }}
                  className="or-input text-center"
                  style={{ width: 64 }}
                  aria-label="Fire amount number"
                  data-testid={`${testidPrefix}-number`}
                />
                <span className="text-sm font-bold" style={{ color: FIRE_COLOR }}>×</span>
              </div>
            </div>

            {/* Quick-select chips */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presets.map((v) => {
                const blocked = v > maxAffordable;
                return (
                  <button key={v} onClick={() => !blocked && setValue(v)} disabled={blocked}
                    className="text-xs font-bold px-3 py-1.5 rounded-full"
                    style={{
                      border: `1px solid ${value === v ? FIRE_COLOR : "var(--border-col)"}`,
                      color: value === v ? FIRE_COLOR : blocked ? "color-mix(in srgb, var(--text-muted) 45%, transparent)" : "var(--text-main)",
                      background: value === v ? "color-mix(in srgb, #FF7A1A 14%, transparent)" : "transparent",
                      cursor: blocked ? "not-allowed" : "pointer",
                    }}
                    title={blocked ? "Not enough Fire Power in your 24h pool" : `Select ${v}×`}
                    data-testid={`${testidPrefix}-pick-${v}`}>
                    {v}×
                  </button>
                );
              })}
            </div>

            {overBudget && (
              <div className="text-[11px] mb-2" style={{ color: "#ff8080" }} data-testid={`${testidPrefix}-over-budget`}>
                Not enough boost fire for {value}× — you can send up to {maxAffordable}× right now.
              </div>
            )}

            <button className="or-btn w-full" disabled={busy || overBudget || value === myFire}
              onClick={() => onApply(value)}
              style={{ opacity: overBudget || value === myFire ? 0.55 : 1 }}
              data-testid={`${testidPrefix}-send`}>
              <Flame size={14} fill="#fff" />
              {value === myFire ? `Current: ${myFire}× 🔥` : `Send ${value}× 🔥`}
            </button>
          </>
        )}

        {myFire > 0 && !simpleMode && (
          <button className="or-chip w-full justify-center mt-2" disabled={busy}
            onClick={() => onApply(0)} data-testid={`${testidPrefix}-pick-remove`}>
            Remove my {myFire}× 🔥
          </button>
        )}
        <div className="text-[10px] mt-3 text-center" style={{ color: "var(--text-muted)" }}>
          1× Fire is always free · Boosts cost fire − 1 from your rolling 24h pool · No refunds on reductions
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Button ─────────────────────────────────────────────────────────── */
export default function FireButton({ post, fireStatus, isGuest, onGuestAction, testidPrefix }) {
  const seed = post.fire || {};
  const live = usePostState(post.id, {});
  const myFire = live.my_fire ?? seed.my_fire ?? 0;
  const total = live.fire_total ?? seed.total ?? post.fire_total ?? 0;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState(fireStatus?.pool || null);
  const [showHint, setShowHint] = useState(false);
  const holdTimer = useRef(null);
  const openedByHold = useRef(false);

  const cfg = fireStatus?.config || { max_fire_per_reaction: 1, daily_fire_pool: 0, fire_enabled: false, level_number: 1 };
  const boostAvailable = !!fireStatus?.boosted_enabled && cfg.fire_enabled !== false;

  // First-use hint (one card per session, dismissible, never repeats)
  useEffect(() => {
    if (isGuest || hintClaimed || !boostAvailable) return;
    try {
      if (localStorage.getItem(HINT_KEY)) return;
    } catch { return; }
    hintClaimed = true;
    setShowHint(true);
    const t = setTimeout(() => dismissHint(), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, boostAvailable]);

  const dismissHint = () => {
    setShowHint(false);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* ignore */ }
  };

  const openPicker = async () => {
    dismissHint();
    setPickerOpen(true);
    try {
      const r = await apiClient.get("/fire/status");
      setPool(r.data.pool);
      updateCachedPool(r.data.pool);
    } catch { /* keep cached pool */ }
  };

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
    if (isGuest) { onGuestAction?.("give Fire"); return; }
    dismissHint();
    // Never silently downgrade an existing boost — open the picker instead.
    if (myFire > 1) { openPicker(); return; }
    apply(myFire > 0 ? 0 : 1);
  };
  const startHold = () => {
    if (!boostAvailable || isGuest) return;
    holdTimer.current = setTimeout(() => { openedByHold.current = true; openPicker(); }, 450);
  };
  const endHold = () => clearTimeout(holdTimer.current);

  return (
    <div className="relative flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        data-testid={`${testidPrefix}-btn`}
        onClick={quickTap}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={myFire > 0}
        aria-label={myFire > 1 ? `Your ${myFire}x Fire — tap to adjust` : myFire === 1 ? "Remove your 1x Fire" : "Give 1x Fire"}
        className="flex items-center gap-1.5"
        style={{ color: myFire > 0 ? FIRE_COLOR : "var(--text-muted)", touchAction: "manipulation" }}
        disabled={busy}
      >
        <Flame size={16} fill={myFire > 0 ? FIRE_COLOR : "none"} />
        <span data-testid={`${testidPrefix}-total`}>{total}</span>
        {myFire > 1 && (
          <span data-testid={`${testidPrefix}-my-multiplier`}
            className="text-[10px] font-bold px-1 rounded-full"
            style={{ background: "color-mix(in srgb, #FF7A1A 20%, transparent)", color: FIRE_COLOR }}>
            ×{myFire}
          </span>
        )}
      </button>
      {boostAvailable && (
        <button
          data-testid={`${testidPrefix}-boost-open`}
          onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } }}
          aria-label="Choose Fire Power"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          title="Choose Fire Power"
          className="flex items-center"
          style={{ color: pickerOpen ? FIRE_COLOR : "var(--text-muted)", padding: "2px 3px", touchAction: "manipulation" }}
        >
          <ChevronUp size={13} style={{ transform: pickerOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
        </button>
      )}

      {showHint && (
        <div
          className="absolute bottom-full left-0 mb-2 px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap flex items-center gap-2 z-20"
          style={{
            background: "color-mix(in srgb, #FF7A1A 16%, var(--surface))",
            border: "1px solid color-mix(in srgb, #FF7A1A 45%, transparent)",
            color: "var(--text-main)", boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
          }}
          data-testid={`${testidPrefix}-hint`}
          role="status"
        >
          Tap for 1× 🔥 · Hold or tap the arrow to boost
          <button onClick={dismissHint} aria-label="Dismiss hint" data-testid={`${testidPrefix}-hint-dismiss`}
            style={{ color: "var(--text-muted)" }}>
            <X size={11} />
          </button>
        </div>
      )}

      {pickerOpen && (
        <FirePickerSheet
          post={post}
          cfg={cfg}
          pool={pool}
          myFire={myFire}
          busy={busy}
          onApply={apply}
          onClose={() => setPickerOpen(false)}
          testidPrefix={testidPrefix}
        />
      )}
    </div>
  );
}
