/**
 * ReactionAttachment — drop-in glue that wires a ReactionPicker +
 * ReactionBar to either the Mongo or Supabase backend. Used across:
 *
 *   • Post feed cards          (mode='mongo', targetType='post')
 *   • Post-popup comments      (mode='mongo', targetType='comment')
 *   • Comment replies          (mode='mongo', targetType='comment')
 *   • 1:1 DM bubbles            (mode='mongo', targetType='dm_message')
 *   • Realm community-chat msgs (mode='mongo', targetType='community_message')
 *   • Group + realm-thread msgs (mode='supabase')
 *
 * The component handles:
 *   • Toggling the picker open/closed (button + tap-outside + Esc).
 *   • Sending to backend (set / replace / remove).
 *   • Showing the inline summary bar.
 *   • Optimistic local state updates so the UI feels instant.
 *
 * Realtime updates from outside (e.g. the realm-chat WebSocket) flow
 * in via the `summary` + `myReaction` props — when those change the
 * component re-renders.
 */
import React, { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import ReactionPicker from "./ReactionPicker";
import ReactionBar from "./ReactionBar";
import { setMongoReaction, setSupabaseReaction } from "@/lib/reactions";

export default function ReactionAttachment({
  // Identity of the reactable target.
  mode,           // 'mongo' | 'supabase'
  targetType,     // mongo: 'post'|'comment'|'dm_message'|'community_message'
  targetId,       // string
  // Supabase-only context (so the row carries the conv type for filters).
  supabaseContextType, // 'chat' | 'group' | 'realm'
  currentUserId,       // required for supabase
  // Server-provided state (re-renders when these change).
  summary,        // [{emoji, count}]
  myReaction,     // emoji string or null
  // UX knobs.
  isGuest = false,
  onGuestAction,
  pickerAlign = "left",
  pickerPosition = "below",
  barAlign = "start",
  barSize = "sm",
  showTriggerButton = true,
  triggerSize = 14,
  testIdPrefix = "reaction",
  className = "",
  triggerLabel = null,    // optional inline label next to the smile
  // Optional callback fired after the server confirms a change. The
  // parent can use this to refresh related state (counts, threads).
  onChanged,
}) {
  // Optimistic local copies — we re-sync from props whenever the
  // parent passes a new server snapshot.
  const [localSummary, setLocalSummary] = useState(summary || []);
  const [localMine, setLocalMine] = useState(myReaction || null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerWrap = useRef(null);

  useEffect(() => { setLocalSummary(summary || []); }, [summary]);
  useEffect(() => { setLocalMine(myReaction || null); }, [myReaction]);

  const applyOptimistic = (emoji) => {
    // Mirror the backend's set/replace/remove logic on the client so the
    // UI updates without waiting for the round-trip.
    const sameAsMine = localMine === emoji;
    const next = (localSummary || []).map((r) => ({ ...r }));
    // Strip the user's previous emoji from the summary (if any).
    if (localMine) {
      const i = next.findIndex((r) => r.emoji === localMine);
      if (i >= 0) {
        next[i].count = Math.max(0, next[i].count - 1);
        if (next[i].count === 0) next.splice(i, 1);
      }
    }
    if (!sameAsMine) {
      const i = next.findIndex((r) => r.emoji === emoji);
      if (i >= 0) next[i].count += 1;
      else next.push({ emoji, count: 1 });
    }
    next.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
    setLocalSummary(next);
    setLocalMine(sameAsMine ? null : emoji);
  };

  const submit = async (emoji) => {
    if (isGuest) {
      onGuestAction?.("react");
      return;
    }
    if (busy) return;
    setBusy(true);
    applyOptimistic(emoji);
    try {
      let resp;
      if (mode === "supabase") {
        resp = await setSupabaseReaction({
          messageId: targetId,
          userId: currentUserId,
          emoji,
          contextType: supabaseContextType,
        });
        // Supabase doesn't echo the full summary — re-derive locally
        // (we already applied it optimistically above; if the row is
        // out of sync the parent's refetch will reconcile).
      } else {
        resp = await setMongoReaction({ targetType, targetId, emoji });
        if (resp && Array.isArray(resp.summary)) {
          setLocalSummary(resp.summary);
          setLocalMine(resp.my_reaction || null);
        }
      }
      onChanged?.(resp);
    } catch (e) {
      // Rollback the optimistic change.
      setLocalSummary(summary || []);
      setLocalMine(myReaction || null);
      // eslint-disable-next-line no-console
      console.error("[reactions] set failed", e);
    } finally {
      setBusy(false);
      setPickerOpen(false);
    }
  };

  // Tapping a chip in the bar reuses the same submit path so users can
  // remove their own reaction by tapping their existing chip.
  const onChipClick = (emoji) => submit(emoji);

  return (
    <div className={`flex items-center gap-2 ${className}`} data-testid={`${testIdPrefix}-attachment-${targetId}`}>
      {showTriggerButton && (
        <div ref={triggerWrap} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isGuest) { onGuestAction?.("react"); return; }
              setPickerOpen((v) => !v);
            }}
            data-testid={`${testIdPrefix}-trigger-${targetId}`}
            title="React"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            className="flex items-center gap-1.5"
            style={{
              color: localMine ? "rgb(140,255,200)" : "var(--text-muted)",
              cursor: "pointer",
              padding: "2px 4px",
            }}
          >
            <SmilePlus size={triggerSize} />
            {triggerLabel ? <span style={{ fontSize: 12 }}>{triggerLabel}</span> : null}
          </button>
          <ReactionPicker
            open={pickerOpen}
            myReaction={localMine}
            onPick={submit}
            onClose={() => setPickerOpen(false)}
            align={pickerAlign}
            position={pickerPosition}
            testIdPrefix={`${testIdPrefix}-picker-${targetId}`}
          />
        </div>
      )}
      <ReactionBar
        summary={localSummary}
        myReaction={localMine}
        onToggle={onChipClick}
        size={barSize}
        align={barAlign}
        testIdPrefix={`${testIdPrefix}-bar-${targetId}`}
      />
    </div>
  );
}
