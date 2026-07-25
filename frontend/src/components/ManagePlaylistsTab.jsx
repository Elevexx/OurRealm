/**
 * ManagePlaylistsTab — Account Settings → Sound Playlists.
 * Owner management: list, create, rename, delete (confirmed; never
 * deletes Sounds), open playlist, remove tracks, reorder tracks.
 */
import React, { useEffect, useState } from "react";
import { ListMusic, Plus, Trash2, ChevronUp, ChevronDown, Loader2, Music } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";

const fmt = (s) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

export default function ManagePlaylistsTab() {
  const [lists, setLists] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = async () => {
    const { data } = await apiClient.get("/playlists/mine");
    setLists(data.playlists || []);
  };
  useEffect(() => { load(); }, []);

  const refreshDetail = async (id) => {
    const { data } = await apiClient.get(`/playlists/${id}`);
    setDetail(data);
  };

  const openDetail = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    await refreshDetail(id);
  };

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await apiClient.post("/playlists", { name: newName.trim() });
      setNewName(""); await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not create playlist"); }
    finally { setBusy(false); }
  };

  const rename = async (id, name) => {
    try {
      await apiClient.patch(`/playlists/${id}`, { name });
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Rename failed"); }
  };

  const remove = async (id) => {
    try {
      await apiClient.delete(`/playlists/${id}`);
      setConfirmDel(null);
      if (openId === id) { setOpenId(null); setDetail(null); }
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const removeItem = async (tid) => {
    try {
      await apiClient.delete(`/playlists/${openId}/items/${tid}`);
      await refreshDetail(openId); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not remove"); }
  };

  const move = async (idx, dir) => {
    const ids = detail.items.map((i) => i.track_id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try {
      await apiClient.patch(`/playlists/${openId}/items/reorder`, { track_ids: ids });
      await refreshDetail(openId);
    } catch (e) { toast.error(e?.response?.data?.detail || "Reorder failed"); }
  };

  if (lists === null) return <div className="text-center py-6"><Loader2 size={18} className="animate-spin inline" /></div>;

  return (
    <div className="space-y-3" data-testid="tab-playlists">
      <div className="or-surface p-4">
        <h3 className="font-bold mb-2 flex items-center gap-2 text-sm"><ListMusic size={15} /> Manage Sound Playlists</h3>
        <div className="flex gap-2">
          <input className="or-input flex-1 text-sm" placeholder="New playlist name…" maxLength={80}
            value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()} data-testid="playlists-new-name" />
          <button className="or-btn text-xs" disabled={busy || !newName.trim()} onClick={create}
            data-testid="playlists-create"><Plus size={13} /> Create</button>
        </div>
      </div>

      {lists.length === 0 && (
        <div className="or-surface p-6 text-center text-xs" style={{ color: "var(--text-muted)" }}
          data-testid="playlists-empty">No playlists yet.</div>
      )}

      {lists.map((pl) => (
        <div key={pl.id} className="or-surface p-3" data-testid={`playlist-card-${pl.id}`}>
          <div className="flex items-center gap-2">
            <button className="flex-1 min-w-0 text-left" onClick={() => openDetail(pl.id)}
              data-testid={`playlist-open-${pl.id}`}>
              <span className="block text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{pl.name}</span>
              <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                {pl.item_count} sound{pl.item_count === 1 ? "" : "s"}
              </span>
            </button>
            <button className="or-chip text-[10px]" title="Delete" style={{ color: "#FF8080" }}
              onClick={() => setConfirmDel(pl.id)} data-testid={`playlist-delete-${pl.id}`}><Trash2 size={11} /></button>
          </div>

          {confirmDel === pl.id && (
            <div className="mt-2 p-2 rounded text-xs flex items-center gap-2 flex-wrap"
              style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)" }}
              data-testid={`playlist-delete-confirm-${pl.id}`}>
              Delete "{pl.name}"? Sounds themselves are never deleted.
              <button className="or-chip text-[10px]" style={{ color: "#FF8080" }}
                onClick={() => remove(pl.id)} data-testid={`playlist-delete-yes-${pl.id}`}>Delete</button>
              <button className="or-chip text-[10px]" onClick={() => setConfirmDel(null)}
                data-testid={`playlist-delete-no-${pl.id}`}>Cancel</button>
            </div>
          )}

          {openId === pl.id && (
            <div className="mt-3 space-y-2" data-testid={`playlist-detail-${pl.id}`}>
              {!detail ? <Loader2 size={14} className="animate-spin" /> : (
                <>
                  <input className="or-input w-full text-xs" defaultValue={pl.name} maxLength={80}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== pl.name && rename(pl.id, e.target.value.trim())}
                    data-testid={`playlist-rename-${pl.id}`} aria-label="Playlist name" />
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}
                    data-testid={`playlist-duration-${pl.id}`}>
                    Total {fmt(detail.playlist.total_duration_seconds || 0)} · {detail.playlist.item_count} sounds
                  </div>
                  <div className="space-y-1">
                    {detail.items.map((i, idx) => (
                      <div key={i.track_id} className="flex items-center gap-2 p-1.5 rounded"
                        style={{ background: "var(--surface-2)", opacity: i.unavailable ? 0.55 : 1 }}
                        data-testid={`playlist-item-${pl.id}-${i.track_id}`}>
                        {i.track?.cover_url ? (
                          <img src={resolveMediaUrl(i.track.cover_url)} alt="" className="rounded object-cover" style={{ width: 28, height: 28 }} />
                        ) : (
                          <span className="inline-flex items-center justify-center rounded" style={{ width: 28, height: 28, background: "var(--surface-1)", color: "var(--text-muted)" }}><Music size={12} /></span>
                        )}
                        <span className="flex-1 min-w-0 text-xs truncate" style={{ color: "var(--text-main)" }}>
                          {i.unavailable ? "Unavailable Sound" : i.track?.title}
                          {i.unavailable && (
                            <span className="ml-1 text-[9px] uppercase font-bold" style={{ color: "#FF8080" }}
                              data-testid={`playlist-item-unavailable-${i.track_id}`}>unavailable</span>
                          )}
                        </span>
                        <button className="starbar-icon" style={{ width: 24, height: 24 }} onClick={() => move(idx, -1)}
                          aria-label="Move up" data-testid={`playlist-item-up-${i.track_id}`}><ChevronUp size={11} /></button>
                        <button className="starbar-icon" style={{ width: 24, height: 24 }} onClick={() => move(idx, 1)}
                          aria-label="Move down" data-testid={`playlist-item-down-${i.track_id}`}><ChevronDown size={11} /></button>
                        <button className="starbar-icon" style={{ width: 24, height: 24, color: "#FF8080" }}
                          onClick={() => removeItem(i.track_id)} aria-label="Remove from playlist"
                          data-testid={`playlist-item-remove-${i.track_id}`}><Trash2 size={11} /></button>
                      </div>
                    ))}
                    {detail.items.length === 0 && (
                      <div className="text-[11px] py-2 text-center" style={{ color: "var(--text-muted)" }}>
                        Empty — use "Add to Playlist" on any Sound.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
