// Universal emoji reactions — shared frontend lib.
//
// Two code paths share the same React surfaces:
//   • MONGO  → posts, comments, replies, 1:1 DMs, realm community-chat
//              messages. Uses /api/reactions/set + summary baked into
//              the parent list endpoint when available.
//   • SUPABASE → groups + realm-thread messages on /messages (they all
//                live in the same Supabase `messages` table). Uses
//                the `message_reactions` table directly via the
//                anon-key client.
//
// One emoji per (target, user). Tap the same emoji again → remove.
// Tap a different emoji → replace.

import apiClient from "@/api/client";
import { supabase, isSupabaseConfigured } from "./supabase";

// Categorized reaction panel — single source of truth for the shared
// Messenger picker (DMs, groups, support, realm chat). Fire Power stays
// a separate control and is NOT part of this grid; the legacy 🔥 emoji
// remains server-allowed so existing 🔥 reactions still display and can
// be toggled off, but it is intentionally absent from the picker.
export const REACTION_CATEGORIES = [
  { label: "Popular",   emojis: ["❤️", "😂", "😍", "👍", "🥰", "😘", "😉", "😎"] },
  { label: "Celebrate", emojis: ["🤩", "🥳", "🎉", "🙌", "👏", "💯", "💪", "✅"] },
  { label: "Fun",       emojis: ["🤣", "😭", "😜", "😅", "🤘", "🐇"] },
  { label: "Surprise",  emojis: ["😮", "🤯", "😳", "🫣", "⚠️"] },
  { label: "Feelings",  emojis: ["😢", "😞", "😕", "😣", "🥺", "😡"] },
  { label: "Responses", emojis: ["🙏", "👋", "👆", "🫡", "🤔", "👎"] },
  { label: "OurRealm",  emojis: ["👽", "🛸", "⚡️"] },
];

export const ALLOWED_EMOJIS = REACTION_CATEGORIES.flatMap((c) => c.emojis);

// ── Mongo path ─────────────────────────────────────────────────────────
export async function setMongoReaction({ targetType, targetId, emoji }) {
  const { data } = await apiClient.post("/reactions/set", {
    target_type: targetType,
    target_id: targetId,
    emoji,
  });
  return data; // {ok, removed, summary, my_reaction}
}

export async function fetchMongoReactionSummary({ targetType, targetIds }) {
  if (!targetIds || targetIds.length === 0) return {};
  const { data } = await apiClient.get("/reactions/summary", {
    params: {
      target_type: targetType,
      target_ids: targetIds.join(","),
    },
  });
  return data?.reactions || {};
}

// ── Supabase path (groups + realm threads in /messages) ───────────────
function sbRequired() {
  if (!isSupabaseConfigured) {
    throw new Error("Reactions are not configured for this surface.");
  }
}

/**
 * Set / change / remove the current user's reaction on a Supabase
 * message. Mirrors the Mongo `set` semantics:
 *   • same emoji again → DELETE the row (returns {removed: true})
 *   • different emoji  → UPSERT with the new emoji
 *
 * `contextType` is stored on the row so subscriptions can filter by
 * conversation without joining back to `messages`.
 */
export async function setSupabaseReaction({ messageId, userId, emoji, contextType }) {
  sbRequired();
  // Look up current reaction to honour tap-again-to-remove.
  const { data: existing, error: e1 } = await supabase
    .from("message_reactions")
    .select("emoji")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .maybeSingle();
  if (e1 && e1.code !== "PGRST116") throw e1;

  if (existing && existing.emoji === emoji) {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId);
    if (error) throw error;
    return { removed: true, my_reaction: null };
  }

  const { error } = await supabase
    .from("message_reactions")
    .upsert(
      {
        message_id: messageId,
        user_id: userId,
        emoji,
        context_type: contextType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id,user_id" }
    );
  if (error) throw error;
  return { removed: false, my_reaction: emoji };
}

/**
 * Returns `{ messageId: {summary: [{emoji,count}], my_reaction } }`
 * for the given message ids. Batches into one round-trip.
 */
export async function fetchSupabaseReactionSummary({ messageIds, userId }) {
  if (!isSupabaseConfigured || !messageIds || messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", messageIds);
  if (error) {
    // Table likely not migrated yet — degrade gracefully.
    return {};
  }
  const byMsg = {};
  for (const row of data || []) {
    if (!byMsg[row.message_id]) byMsg[row.message_id] = { counts: {}, my: null };
    const entry = byMsg[row.message_id];
    entry.counts[row.emoji] = (entry.counts[row.emoji] || 0) + 1;
    if (row.user_id === userId) entry.my = row.emoji;
  }
  const out = {};
  for (const id of messageIds) {
    const e = byMsg[id];
    if (!e) {
      out[id] = { summary: [], my_reaction: null };
      continue;
    }
    out[id] = {
      summary: Object.entries(e.counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([emoji, count]) => ({ emoji, count })),
      my_reaction: e.my,
    };
  }
  return out;
}

/**
 * Subscribe to live reaction changes for a conversation. `onChange`
 * fires for every INSERT/UPDATE/DELETE on a relevant row. Returns the
 * unsubscribe function. Filters by message_ids to keep the channel
 * scoped to one open conversation.
 */
export function subscribeToReactions({ messageIds, contextType, onChange }) {
  if (!isSupabaseConfigured) return () => {};
  if (!messageIds || messageIds.length === 0) return () => {};
  const channel = supabase
    .channel(`message_reactions:${contextType}:${messageIds.length}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "message_reactions",
      },
      (payload) => {
        const row = payload?.new || payload?.old;
        if (!row) return;
        if (!messageIds.includes(row.message_id)) return;
        try { onChange(payload); } catch { /* ignore */ }
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
