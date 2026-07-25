/**
 * AddToPlaylistPopup — Bundle 1 original OurRealm playlist popup.
 * Add/remove a canonical Sound across the user's playlists, see which
 * playlists already contain it, and create a new playlist inline.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, ListMusic, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";

export default function AddToPlaylistPopup({ open, trackId, onClose, testid = "add-to-playlist" }) {
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open || !trackId) return undefined;
    let on = true;
    apiClient.get(`/playlists/containing/${trackId}`)
      .then((r) => { if (on) setRows(r.data.playlists || []); })
      .catch(() => { if (on) setRows([]); });
    return () => { on = false; };
  }, [open, trackId]);

  if (!open) return null;

  const toggle = async (pl) => {
    setBusyId(pl.id);
    try {
      if (pl.has_track) {
        await apiClient.delete(`/playlists/${pl.id}/items/${trackId}`);
        setRows((r) => r.map((x) => (x.id === pl.id ? { ...x, has_track: false, item_count: x.item_count - 1 } : x)));
      } else {
        await apiClient.post(`/playlists/${pl.id}/items`, { track_id: trackId });
        setRows((r) => r.map((x) => (x.id === pl.id ? { ...x, has_track: true, item_count: x.item_count + 1 } : x)));
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update playlist");
    } finally { setBusyId(null); }
  };

  const createAndAdd = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data } = await apiClient.post("/playlists", { name: newName.trim() });
      await apiClient.post(`/playlists/${data.playlist.id}/items`, { track_id: trackId });
      setRows((r) => [{ ...data.playlist, has_track: true, item_count: 1 }, ...(r || [])]);
      setNewName("");
      toast.success("Playlist created");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create playlist");
    } finally { setCreating(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[97] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { e.stopPropagation(); onClose(); }} role="dialog" aria-modal="true"
      aria-label="Add to playlist" data-testid={testid}>
      <div className="or-surface w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl flex flex-col"
        style={{ maxHeight: "70vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="text-sm font-bold flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }}>
            <ListMusic size={15} /> Add to Playlist
          </div>
          <button className="starbar-icon" style={{ width: 30, height: 30 }} onClick={onClose}
            aria-label="Close" data-testid={`${testid}-close`}><X size={13} /></button>
        </div>

        <div className="px-4 pb-2 flex gap-1.5">
          <input className="or-input flex-1 text-sm" placeholder="New playlist name…"
            value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80}
            data-testid={`${testid}-new-name`} />
          <button className="or-btn text-[11px] px-2.5" disabled={creating || !newName.trim()}
            onClick={createAndAdd} data-testid={`${testid}-create`}>
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5" data-testid={`${testid}-list`}>
          {rows === null ? (
            <div className="text-center py-5"><Loader2 size={16} className="animate-spin inline" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-5 text-xs" style={{ color: "var(--text-muted)" }}
              data-testid={`${testid}-empty`}>
              No playlists yet — create your first one above.
            </div>
          ) : rows.map((pl) => (
            <button key={pl.id} className="w-full flex items-center gap-2 p-2 rounded text-left"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)" }}
              disabled={busyId === pl.id} onClick={() => toggle(pl)}
              aria-pressed={pl.has_track}
              data-testid={`${testid}-row-${pl.id}`}>
              <span className="inline-flex items-center justify-center rounded shrink-0"
                style={{ width: 26, height: 26,
                  background: pl.has_track ? "var(--brand-green, #00FF66)" : "var(--surface-1)",
                  color: pl.has_track ? "#000" : "var(--text-muted)" }}>
                {busyId === pl.id ? <Loader2 size={12} className="animate-spin" />
                  : pl.has_track ? <Check size={13} /> : <Plus size={13} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--text-main)" }}>{pl.name}</span>
                <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {pl.item_count} sound{pl.item_count === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
