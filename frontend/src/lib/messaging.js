// ----------------------------------------------------------------------------
// Unified messaging library — Chats, Groups, Realms, and Messages all live in
// Supabase. ONE messaging table powers everything:
//   context_type ∈ { 'chat', 'group', 'realm' }, context_id = uuid
// ----------------------------------------------------------------------------
import { supabase, isSupabaseConfigured } from "./supabase";

const PAGE_LIMIT = 100;

function ensure() {
  if (!isSupabaseConfigured)
    throw new Error("Supabase is not configured — set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in /app/frontend/.env");
  return supabase;
}

// ─────────────────────────────────────────────────────────────────────
// CHATS
// ─────────────────────────────────────────────────────────────────────
export async function listChats(userId) {
  const sb = ensure();
  const { data, error } = await sb
    .from("chats")
    .select("*")
    .contains("participants", [userId])
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getOrCreateDirectChat(myId, otherId) {
  const sb = ensure();
  // Try to find an existing 1:1 chat containing both ids.
  const { data: existing, error: e1 } = await sb
    .from("chats")
    .select("*")
    .contains("participants", [myId, otherId]);
  if (e1) throw e1;
  const hit = (existing || []).find(
    (c) => Array.isArray(c.participants)
      && c.participants.length === 2
      && c.participants.includes(myId)
      && c.participants.includes(otherId)
  );
  if (hit) return hit;
  const { data, error } = await sb
    .from("chats")
    .insert({ participants: [myId, otherId] })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// GROUPS
// ─────────────────────────────────────────────────────────────────────
export async function listGroups(userId) {
  const sb = ensure();
  const { data, error } = await sb
    .from("groups")
    .select("*")
    .contains("members", [userId])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createGroup(userId, name, memberIds = []) {
  const sb = ensure();
  const members = Array.from(new Set([userId, ...memberIds]));
  const { data, error } = await sb
    .from("groups")
    .insert({ name, created_by: userId, members })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function joinGroup(groupId, userId) {
  const sb = ensure();
  const { data: g, error: ge } = await sb
    .from("groups").select("members").eq("id", groupId).single();
  if (ge) throw ge;
  const members = Array.from(new Set([...(g?.members || []), userId]));
  const { data, error } = await sb
    .from("groups").update({ members }).eq("id", groupId).select().single();
  if (error) throw error;
  return data;
}

export async function leaveGroup(groupId, userId) {
  const sb = ensure();
  const { data: g, error: ge } = await sb
    .from("groups").select("members").eq("id", groupId).single();
  if (ge) throw ge;
  const members = (g?.members || []).filter((m) => m !== userId);
  const { data, error } = await sb
    .from("groups").update({ members }).eq("id", groupId).select().single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// REALMS  (same shape as groups, different table)
// ─────────────────────────────────────────────────────────────────────
export async function listRealms(userId) {
  const sb = ensure();
  const { data, error } = await sb
    .from("realms")
    .select("*")
    .contains("members", [userId])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createRealm(userId, name, memberIds = []) {
  const sb = ensure();
  const members = Array.from(new Set([userId, ...memberIds]));
  const { data, error } = await sb
    .from("realms")
    .insert({ name, created_by: userId, members })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function joinRealm(realmId, userId) {
  const sb = ensure();
  const { data: r, error: re } = await sb
    .from("realms").select("members").eq("id", realmId).single();
  if (re) throw re;
  const members = Array.from(new Set([...(r?.members || []), userId]));
  const { data, error } = await sb
    .from("realms").update({ members }).eq("id", realmId).select().single();
  if (error) throw error;
  return data;
}

export async function leaveRealm(realmId, userId) {
  const sb = ensure();
  const { data: r, error: re } = await sb
    .from("realms").select("members").eq("id", realmId).single();
  if (re) throw re;
  const members = (r?.members || []).filter((m) => m !== userId);
  const { data, error } = await sb
    .from("realms").update({ members }).eq("id", realmId).select().single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// MESSAGES (UNIFIED)
// ─────────────────────────────────────────────────────────────────────
export async function fetchMessages(contextType, contextId, { limit = PAGE_LIMIT } = {}) {
  const sb = ensure();
  const { data, error } = await sb
    .from("messages")
    .select("*")
    .eq("context_type", contextType)
    .eq("context_id", contextId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse(); // oldest → newest for display
}

export async function sendMessage({ contextType, contextId, senderId, text, mediaUrl = null }) {
  const sb = ensure();
  const { data, error } = await sb
    .from("messages")
    .insert({
      context_type: contextType,
      context_id: contextId,
      sender_id: senderId,
      text: text || null,
      media_url: mediaUrl,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Realtime: subscribe ONLY to the active conversation for cost-efficiency.
// Returns an unsubscribe function.
export function subscribeToConversation(contextType, contextId, onInsert) {
  if (!isSupabaseConfigured) return () => {};
  const channel = supabase
    .channel(`messages:${contextType}:${contextId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `context_id=eq.${contextId}`,
      },
      (payload) => {
        const row = payload?.new;
        if (row && row.context_type === contextType) onInsert(row);
      }
    )
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
