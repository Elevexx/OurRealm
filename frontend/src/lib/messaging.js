// ----------------------------------------------------------------------------
// Unified messaging library — Chats, Groups, and Messages live in Supabase
// (single messages table powers everything; `context_type ∈ {chat, group,
// realm}`). REALMS, however, are sourced from Mongo — the canonical Realm
// id, membership, and main chat row live there alongside /realms. Realm
// message threads still flow through Supabase using `context_type='realm'`
// and `context_id = mongo_realm_id`, so message persistence + realtime
// stay unchanged while Realm membership is the single source of truth.
// ----------------------------------------------------------------------------
import { supabase, isSupabaseConfigured } from "./supabase";
import apiClient from "@/api/client";

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
// REALMS — backed by Mongo /api/communities so /messages > Realms
// stays perfectly in sync with /realms membership (the canonical store).
// Returned shape includes both the new canonical fields (realm_id,
// chat_id, realm_avatar, realm_banner_url, member_count, …) AND legacy
// aliases (`id`, `name`, `members`, `created_at`) so the existing
// Messages.jsx ThreadList row component renders without changes.
// ─────────────────────────────────────────────────────────────────────
export async function listRealms(_userId) {
  const { data } = await apiClient.get("/communities/my-realms");
  return data?.realms || [];
}

export async function createRealm(_userId, name, _memberIds = []) {
  // Mongo create_realm auto-joins the creator as owner AND auto-creates
  // the main community chat. One round-trip; no follow-up "add me"
  // needed. We then read it back via /my-realms so the row carries
  // every field the UI expects (realm_id, chat_id, member_count, …).
  await apiClient.post("/communities/realms", { name });
  const { data } = await apiClient.get("/communities/my-realms");
  const realms = data?.realms || [];
  // Return the newest realm (sorted by last_message_at/created_at desc).
  const created = realms.find((r) => r.realm_name === name) || realms[0] || null;
  return created;
}

export async function joinRealm(realmId, _userId) {
  // Mongo /join is idempotent — returns {member_count} live.
  await apiClient.post(`/communities/realm/${realmId}/join`);
  const { data } = await apiClient.get("/communities/my-realms");
  return (data?.realms || []).find((r) => r.realm_id === realmId) || null;
}

export async function leaveRealm(realmId, _userId) {
  await apiClient.post(`/communities/realm/${realmId}/leave`);
  // Caller only needs to know it succeeded — the Messages.jsx tab
  // refreshes its list independently from the optimistic remove.
  return { id: realmId, removed: true };
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
