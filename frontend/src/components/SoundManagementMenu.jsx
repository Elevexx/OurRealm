/**
 * SoundManagementMenu — owner controls + founder-delete for sound tracks.
 *
 * Mirrors `PostManagementMenu` for posts, but targets `/api/sounds/{id}`:
 *   - Owner: change visibility (public / friends / custom / stealth),
 *     edit title/category/genre/mood/cover, delete the track.
 *   - @stealth (founder): delete any user's sound (no visibility chips).
 *   - Everyone else: nothing rendered.
 *
 * Reuses the visual styling primitives from the posts menu so the look,
 * spacing, and dark-mode behaviour stay identical across post + sound
 * menus. No visual design change.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Edit3, Trash2, Globe2, Users as UsersIcon, UserCheck, EyeOff, X, Loader2, MoreHorizontal } from "lucide-react";
import apiClient from "@/api/client";
import FriendMultiPicker from "@/components/FriendMultiPicker";

const VIS_OPTIONS = [
  { id: "public",  label: "Public",       Icon: Globe2 },
  { id: "friends", label: "Friends Only", Icon: UsersIcon },
  { id: "custom",  label: "Custom",       Icon: UserCheck },
  { id: "stealth", label: "Stealth",      Icon: EyeOff },
];

function currentVisibility(track) {
  const v = (track?.visibility || "public").toLowerCase();
  return v === "private" ? "stealth" : v;
}

export function canManageSound(track, user) {
  if (!track || !user) return false;
  if (track.user_id === user.id || track.is_owner) return true;
  if ((user.username || "").toLowerCase() === "stealth" || user.is_founder) return true;
  return false;
}

export default function SoundManagementMenu({ track, user, onUpdated, onDeleted, testid }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(track?.title || "");
  const [editGenre, setEditGenre] = useState(track?.genre || "");
  const [editMood,  setEditMood]  = useState(track?.mood  || "");
  const [pickFriends, setPickFriends] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const toggleRef = React.useRef(null);

  const allowed = canManageSound(track, user);
  const isOwner = !!(track && user && (track.user_id === user.id || track.is_owner));
  const vis = currentVisibility(track);

  const openMenu = () => {
    const r = toggleRef.current?.getBoundingClientRect?.();
    if (r) setAnchorRect({ top: r.bottom, right: window.innerWidth - r.right });
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); setEditMode(false); };

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
      const { data } = await apiClient.patch(`/sounds/${track.id}`, { visibility: next });
      onUpdated?.(data.track);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to update");
    } finally { setBusy(false); }
  };

  const saveCustomIds = async (ids) => {
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.patch(`/sounds/${track.id}`, {
        visibility: "custom",
        custom_user_ids: ids,
      });
      onUpdated?.(data.track);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to update");
    } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!isOwner) return;
    const title = editTitle.trim();
    if (!title) { setErr("Title cannot be empty"); return; }
    setBusy(true); setErr("");
    try {
      const { data } = await apiClient.patch(`/sounds/${track.id}`, {
        title,
        genre: editGenre.trim(),
        mood:  editMood.trim(),
      });
      onUpdated?.(data.track);
      setEditMode(false);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to save");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    // Match the post-delete UX exactly: same confirmation prompt.
    // eslint-disable-next-line no-alert
    if (!window.confirm("Delete this sound? This cannot be undone.")) return;
    setBusy(true); setErr("");
    try {
      await apiClient.delete(`/sounds/${track.id}`);
      onDeleted?.(track.id);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to delete");
      setBusy(false);
    }
  };

  const tid = testid || `sound-manage-${track.id}`;

  const renderMenu = (idScope = tid) => {
    if (editMode && isOwner) {
      return (
        <div className="space-y-2" data-testid={`${idScope}-edit-form`}>
          <div
            className="text-[10px] uppercase tracking-widest mb-1"
            style={{ color: "var(--text-muted)" }}
          >Edit sound</div>
          <input
            value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            className="w-full text-sm px-2 py-1.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
            data-testid={`${idScope}-edit-title`}
          />
          <input
            value={editGenre} onChange={(e) => setEditGenre(e.target.value)}
            placeholder="Genre"
            className="w-full text-sm px-2 py-1.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
            data-testid={`${idScope}-edit-genre`}
          />
          <input
            value={editMood} onChange={(e) => setEditMood(e.target.value)}
            placeholder="Mood"
            className="w-full text-sm px-2 py-1.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)", borderRadius: 6, color: "var(--text-main)" }}
            data-testid={`${idScope}-edit-mood`}
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button" disabled={busy} onClick={saveEdit}
              className="flex-1 text-[11px] uppercase tracking-wide px-2 py-2"
              style={{ borderRadius: 6, background: "var(--primary)", color: "var(--primary-fg)", opacity: busy ? 0.6 : 1 }}
              data-testid={`${idScope}-edit-save`}
            >{busy ? <Loader2 size={11} className="inline animate-spin" /> : "Save"}</button>
            <button
              type="button" disabled={busy} onClick={() => setEditMode(false)}
              className="flex-1 text-[11px] uppercase tracking-wide px-2 py-2"
              style={{ borderRadius: 6, background: "transparent", color: "var(--text-main)", border: "1px solid var(--border-col)" }}
              data-testid={`${idScope}-edit-cancel`}
            >Cancel</button>
          </div>
          {err && <div className="text-[11px]" style={{ color: "#FF8080" }}>{err}</div>}
        </div>
      );
    }

    const VisGrid = isOwner ? (
      <>
        <div
          className="text-[10px] uppercase tracking-widest mb-2"
          style={{ color: "var(--text-muted)" }}
          data-testid={`${idScope}-title`}
        >Who can hear this</div>
        <div className="grid grid-cols-2 gap-1.5" data-testid={`${idScope}-vis-grid`}>
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

    return (
      <>
        {VisGrid}
        {isOwner && (
          <button
            type="button" disabled={busy} onClick={() => setEditMode(true)}
            className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5 mt-2"
            style={{
              borderRadius: 6,
              background: "color-mix(in srgb, var(--primary) 12%, transparent)",
              color: "var(--primary)",
              border: "1px solid color-mix(in srgb, var(--primary) 35%, transparent)",
            }}
            data-testid={`${idScope}-edit`}
          ><Edit3 size={11} /> Edit details</button>
        )}
        <div className="mt-3 pt-3" style={{ borderTop: isOwner ? "1px solid var(--border-col)" : "none" }}>
          <button
            type="button" disabled={busy} onClick={remove}
            className="w-full text-[11px] uppercase tracking-wide flex items-center justify-center gap-1 px-3 py-2.5"
            style={{
              borderRadius: 6,
              background: "color-mix(in srgb, #FF3F5A 16%, transparent)",
              color: "#FF8080",
              border: "1px solid color-mix(in srgb, #FF3F5A 35%, transparent)",
            }}
            data-testid={`${idScope}-delete`}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Delete
          </button>
        </div>
        {err && (
          <div className="w-full text-[11px] mt-2" style={{ color: "#FF8080" }} data-testid={`${idScope}-error`}>
            {err}
          </div>
        )}
        <button
          type="button" onClick={closeMenu}
          className="absolute -top-2 -right-2 rounded-full"
          style={{ width: 22, height: 22, background: "var(--surface-2)", border: "1px solid var(--border-col)", color: "var(--text-muted)" }}
          aria-label="Close menu" data-testid={`${idScope}-close`}
        ><X size={12} style={{ margin: "0 auto" }} /></button>
      </>
    );
  };

  const Overlay = open && createPortal(
    <>
      <div
        className="fixed inset-0"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", zIndex: 9998 }}
        onClick={closeMenu}
        data-testid={`${tid}-backdrop`}
      />
      <div
        className="or-surface sm:hidden"
        style={{
          position: "fixed",
          left: 16, right: 16,
          bottom: "calc(88px + env(safe-area-inset-bottom))",
          width: "auto",
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "70vh",
          overflowY: "auto", overflowX: "hidden", boxSizing: "border-box",
          zIndex: 9999, padding: 14,
          background: "var(--surface)", border: "1px solid var(--border-col)",
          boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid={tid}
      >{renderMenu(tid)}</div>
      {anchorRect && (
        <div
          className="or-surface hidden sm:block"
          style={{
            position: "fixed",
            top: anchorRect.top + 6, right: anchorRect.right,
            width: isOwner ? 320 : 160,
            maxWidth: "calc(100vw - 24px)", maxHeight: "70vh",
            overflowY: "auto", overflowX: "hidden", boxSizing: "border-box",
            zIndex: 9999, padding: 12,
            background: "var(--surface)", border: "1px solid var(--border-col)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
          onClick={(e) => e.stopPropagation()}
          data-testid={`${tid}-desktop`}
        >{renderMenu(`${tid}-desktop`)}</div>
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
        aria-label="Manage sound"
        aria-expanded={open}
        title="Manage sound"
        data-testid={`${tid}-toggle`}
      ><MoreHorizontal size={13} /></button>

      {Overlay}

      {pickFriends && (
        <FriendMultiPicker
          open
          onClose={() => setPickFriends(false)}
          title="Custom audience for this sound"
          initialSelectedIds={track?.custom_user_ids || []}
          onConfirm={(ids) => { setPickFriends(false); saveCustomIds(ids); }}
        />
      )}
    </div>
  );
}
