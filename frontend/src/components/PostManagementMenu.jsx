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
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Edit3, Trash2, Globe2, Users as UsersIcon, UserCheck, Eye, EyeOff, X, Loader2, Pin } from "lucide-react";
import apiClient from "@/api/client";
import FriendMultiPicker from "@/components/FriendMultiPicker";
import AdminBlurModal from "@/components/AdminBlurModal";

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
  // Phase F.6 — @support gets the menu so they can Pin/Unpin global
  // announcements on any user's post.
  if ((user.username || "").toLowerCase() === "support") return true;
  return false;
}

export default function PostManagementMenu({ post, user, onUpdated, onDeleted, testid }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pickFriends, setPickFriends] = useState(false);
  const [blurOpen, setBlurOpen] = useState(false);
  // Anchor coordinates for the desktop popover (mobile uses fixed CSS instead).
  const [anchorRect, setAnchorRect] = useState(null);
  const toggleRef = React.useRef(null);

  const allowed = canManagePost(post, user);
  const isOwner = !!(post && user && post.author_id === user.id);
  const vis = currentVisibility(post);

  const openMenu = () => {
    const r = toggleRef.current?.getBoundingClientRect?.();
    if (r) setAnchorRect({ top: r.bottom, right: window.innerWidth - r.right });
    setOpen(true);
  };
  const closeMenu = () => setOpen(false);

  // Close on Esc / window resize. Effect always runs; gate is the `open` flag.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeMenu(); };
    const onResize = () => closeMenu();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  if (!allowed) return null;

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

  // Phase F.6 — Founder-only "Pin to For You" toggle. Singleton: pinning
  // a new post auto-replaces any current pinned announcement on the
  // server. Unpin clears the global pin entirely.
  const isPinAdmin = user && ["stealth", "support"].includes((user.username || "").toLowerCase());

  // Trust & Safety — manual sensitive-content blur (any post, no AI flag
  // or report required). Founder/support only.
  const isModAdmin = user && ((user.username || "").toLowerCase() === "stealth" || user.is_founder
    || (user.username || "").toLowerCase() === "support");
  const isManuallyBlurred = !!post?.safety_view?.manual;
  const removeBlur = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/admin/moderation/post/${post.id}/unblur`, { reason: null });
      onUpdated?.({ ...post, safety_view: null });
      closeMenu();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to remove blur");
    } finally { setBusy(false); }
  };
  const pinPost = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/announcements/pin`, { post_id: post.id });
      onUpdated?.({ ...post, is_pinned: true, pinned_by: user.username });
      closeMenu();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to pin");
    } finally { setBusy(false); }
  };
  const unpinPost = async () => {
    setBusy(true); setErr("");
    try {
      await apiClient.post(`/announcements/unpin`);
      onUpdated?.({ ...post, is_pinned: false, pinned_by: null });
      closeMenu();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to unpin");
    } finally { setBusy(false); }
  };

  const tid = testid || `post-manage-${post.id}`;

  // ── Menu content (used in both mobile and desktop overlays) ─────────
  // `idScope` lets each variant own a distinct child-testid namespace so
  // automated tests can target one without ambiguous duplicates.
  const renderMenu = (idScope = tid) => {
    const VisGrid = isOwner ? (
      <>
        <div
          className="text-[10px] uppercase tracking-widest mb-2"
          style={{ color: "var(--text-muted)" }}
          data-testid={`${idScope}-title`}
        >
          Who can see this
        </div>
        <div
          className="grid grid-cols-2 gap-1.5"
          data-testid={`${idScope}-vis-grid`}
        >
          {VIS_OPTIONS.map(({ id, label, Icon }) => {
            const active = vis === id;
            return (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => (id === "custom" ? setPickFriends(true) : updateVisibility(id))}
                className="text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-2 py-2"
                style={{
                  borderRadius: 6,
                  background: active ? "color-mix(in srgb, var(--primary) 22%, transparent)" : "transparent",
                  color: active ? "var(--primary)" : "var(--text-main)",
                  border: active ? "1px solid var(--primary)" : "1px solid var(--border-col)",
                  opacity: busy ? 0.6 : 1,
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                  whiteSpace: "normal",
                  maxWidth: "100%",
                  minWidth: 0,
                }}
                data-testid={`${idScope}-vis-${id}`}
              >
                <Icon size={11} /> {label}
              </button>
            );
          })}
        </div>
      </>
    ) : null;

    const DeleteSection = (
      <div
        className="mt-3 pt-3"
        style={{ borderTop: isOwner ? "1px solid var(--border-col)" : "none" }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5"
          style={{
            borderRadius: 6,
            background: "color-mix(in srgb, #FF3F5A 16%, transparent)",
            color: "#FF8080",
            border: "1px solid color-mix(in srgb, #FF3F5A 35%, transparent)",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            whiteSpace: "normal",
            maxWidth: "100%",
          }}
          data-testid={`${idScope}-delete`}
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
        </button>
      </div>
    );

    return (
      <>
        {VisGrid}
        {isPinAdmin && (
          <button
            type="button"
            disabled={busy}
            onClick={post.is_pinned ? unpinPost : pinPost}
            className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5 mt-2"
            style={{
              borderRadius: 6,
              background: post.is_pinned
                ? "color-mix(in srgb, var(--primary) 22%, transparent)"
                : "color-mix(in srgb, var(--primary) 12%, transparent)",
              color: "var(--primary)",
              border: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
            }}
            data-testid={`${idScope}-pin`}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Pin size={11} />}
            {post.is_pinned ? "Unpin from For You" : "Pin to For You"}
          </button>
        )}
        {DeleteSection}
        {err && (
          <div className="w-full text-[11px] mt-2" style={{ color: "#FF8080" }} data-testid={`${idScope}-error`}>
            {err}
          </div>
        )}
        <button
          type="button"
          onClick={closeMenu}
          className="absolute -top-2 -right-2 rounded-full"
          style={{ width: 22, height: 22, background: "var(--surface-2)", border: "1px solid var(--border-col)", color: "var(--text-muted)" }}
          aria-label="Close menu"
          data-testid={`${idScope}-close`}
        >
          <X size={12} style={{ margin: "0 auto" }} />
        </button>
      </>
    );
  };

  // ── Portal-based overlay (viewport-level — never anchored to the post)
  const Overlay = open && createPortal(
    <>
      {/* Backdrop — tapping it closes the menu. Pointer-events on so it
          actually catches clicks above the bottom navigation. */}
      <div
        className="fixed inset-0"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", zIndex: 9998 }}
        onClick={closeMenu}
        data-testid={`${tid}-backdrop`}
      />
      {/* Mobile bottom sheet (visible <640px). Spec-exact CSS so the menu
          never overflows the viewport horizontally and always sits above
          the bottom navigation (≈80–88 px tall) + iOS home indicator. */}
      <div
        className="or-surface sm:hidden"
        style={{
          position: "fixed",
          left: 16,
          right: 16,
          bottom: "calc(88px + env(safe-area-inset-bottom))",
          width: "auto",
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "70vh",
          overflowY: "auto",
          overflowX: "hidden",
          boxSizing: "border-box",
          zIndex: 9999,
          padding: 14,
          background: "var(--surface)",
          border: "1px solid var(--border-col)",
          boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid={tid}
      >
        {renderMenu(tid)}
      </div>
      {/* Desktop popover (≥640px) — anchored just below the toggle button
          using the rect we captured on open. */}
      {anchorRect && (
        <div
          className="or-surface hidden sm:block"
          style={{
            position: "fixed",
            top: anchorRect.top + 6,
            right: anchorRect.right,
            width: isOwner ? 320 : 160,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "70vh",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            zIndex: 9999,
            padding: 12,
            background: "var(--surface)",
            border: "1px solid var(--border-col)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
          onClick={(e) => e.stopPropagation()}
          data-testid={`${tid}-desktop`}
        >
          {renderMenu(`${tid}-desktop`)}
        </div>
      )}
    </>,
    document.body,
  );

  return (
    <div className="inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        className="starbar-icon"
        style={{ width: 30, height: 30 }}
        aria-label="Manage post"
        aria-expanded={open}
        title="Manage post"
        data-testid={`${tid}-toggle`}
      >
        <Edit3 size={13} />
      </button>

      {Overlay}

      {pickFriends && (
        <FriendMultiPicker
          open
          onClose={() => setPickFriends(false)}
          title="Custom audience for this post"
          initialSelectedIds={post?.audience?.user_ids || []}
          onConfirm={(ids) => { setPickFriends(false); saveCustomIds(ids); }}
        />
      )}

      {blurOpen && (
        <AdminBlurModal
          contentType="post"
          contentId={post.id}
          onClose={() => setBlurOpen(false)}
          onDone={(category, publicMessage) => onUpdated?.({
            ...post,
            safety_view: {
              severity: Math.max(post?.safety_view?.severity || 0, 1),
              category,
              message: publicMessage || null,
              manual: true,
              is_uploader: post.author_id === user?.id,
            },
          })}
        />
      )}
    </div>
  );
}

// Re-export the icon so callers don't have to know about lucide.
PostManagementMenu.Eye = Eye;
