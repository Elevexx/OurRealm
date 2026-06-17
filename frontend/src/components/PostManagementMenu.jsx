/**
 * PostManagementMenu — owner-only edit row + delete for posts.
 * Inline, compact, theme-aware (uses the current mode's CSS variables).
 *
 * Visibility logic mirrors backend `routers/posts.py`:
 *   - public         everyone
 *   - friends        accepted friends only
 *   - custom         specific friends (custom_user_ids)
 *   - stealth        owner-only (stored server-side as "private")
 *
 * Permission UI rules:
 *   - Owner viewing own post  → full edit row + Delete
 *   - @stealth viewing other's → Delete ONLY (no visibility chips)
 *   - Everyone else           → nothing rendered
 */
import React, { useState } from "react";
import { Edit3, Trash2, Globe2, Users as UsersIcon, UserCheck, Eye, EyeOff, X, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import FriendMultiPicker from "@/components/FriendMultiPicker";

const VIS_OPTIONS = [
  { id: "public",  label: "Public",       Icon: Globe2 },
  { id: "friends", label: "Friends Only", Icon: UsersIcon },
  { id: "custom",  label: "Custom",       Icon: UserCheck },
  { id: "stealth", label: "Stealth",      Icon: EyeOff },
];

// Server stores "private" historically; we surface it as "stealth".
function currentVisibility(post) {
  const v = (post?.audience?.visibility || "public").toLowerCase();
  return v === "private" ? "stealth" : v;
}

export function canManagePost(post, user) {
  if (!post || !user) return false;
  if (post.author_id === user.id) return true;
  if ((user.username || "").toLowerCase() === "stealth" || user.is_founder) return true;
  return false;
}

export default function PostManagementMenu({ post, user, onUpdated, onDeleted, testid }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pickFriends, setPickFriends] = useState(false);

  if (!canManagePost(post, user)) return null;

  const isOwner = post.author_id === user.id;
  const vis = currentVisibility(post);

  const updateVisibility = async (next) => {
    if (!isOwner) return;
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.patch(`/posts/${post.id}`, { visibility: next });
      onUpdated?.(data.post);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to update");
    } finally { setBusy(false); }
  };

  const saveCustomIds = async (ids) => {
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.patch(`/posts/${post.id}`, {
        visibility: "custom",
        custom_user_ids: ids,
      });
      onUpdated?.(data.post);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to update");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.delete(`/posts/${post.id}`);
      onDeleted?.(post.id);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to delete");
      setBusy(false);
    }
  };

  const tid = testid || `post-manage-${post.id}`;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="starbar-icon"
        style={{ width: 30, height: 30 }}
        aria-label="Manage post"
        aria-expanded={open}
        title="Manage post"
        data-testid={`${tid}-toggle`}
      >
        <Edit3 size={13} />
      </button>

      {open && (
        <div
          className="or-surface absolute right-0 mt-1 z-30 p-2 flex flex-wrap items-center gap-1.5"
          style={{
            minWidth: isOwner ? 280 : 110,
            maxWidth: 360,
            background: "var(--surface)",
            border: "1px solid var(--border-col)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          }}
          data-testid={tid}
        >
          {isOwner ? (
            VIS_OPTIONS.map(({ id, label, Icon }) => {
              const active = vis === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => (id === "custom" ? setPickFriends(true) : updateVisibility(id))}
                  className="text-[11px] uppercase tracking-wide flex items-center gap-1 px-2 py-1.5"
                  style={{
                    borderRadius: 6,
                    background: active ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "transparent",
                    color: active ? "var(--primary)" : "var(--text-main)",
                    border: active ? "1px solid var(--primary)" : "1px solid var(--border-col)",
                    opacity: busy ? 0.6 : 1,
                  }}
                  data-testid={`${tid}-vis-${id}`}
                >
                  <Icon size={11} /> {label}
                </button>
              );
            })
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="text-[11px] uppercase tracking-wide flex items-center gap-1 px-2 py-1.5 ml-auto"
            style={{
              borderRadius: 6,
              background: "color-mix(in srgb, #FF3F5A 16%, transparent)",
              color: "#FF8080",
              border: "1px solid color-mix(in srgb, #FF3F5A 35%, transparent)",
            }}
            data-testid={`${tid}-delete`}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
          </button>

          {err && (
            <div className="w-full text-[11px]" style={{ color: "#FF8080" }} data-testid={`${tid}-error`}>
              {err}
            </div>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute -top-2 -right-2 rounded-full"
            style={{ width: 20, height: 20, background: "var(--surface-2)", border: "1px solid var(--border-col)", color: "var(--text-muted)" }}
            aria-label="Close menu"
            data-testid={`${tid}-close`}
          >
            <X size={11} style={{ margin: "0 auto" }} />
          </button>
        </div>
      )}

      {pickFriends && (
        <FriendMultiPicker
          open
          onClose={() => setPickFriends(false)}
          title="Custom audience for this post"
          initialSelectedIds={post?.audience?.user_ids || []}
          onConfirm={(ids) => { setPickFriends(false); saveCustomIds(ids); }}
        />
      )}
    </div>
  );
}

// Re-export the icon so callers don't have to know about lucide.
PostManagementMenu.Eye = Eye;
