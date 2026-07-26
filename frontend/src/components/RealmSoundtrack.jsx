/**
 * RealmSoundtrack — reusable Realm Soundtrack widget (Bundle 1b).
 * A profile IS the user's personal Realm; the same component/data model
 * can later serve group/community Realms, Portals and Nexus (they only
 * differ by context — the backend stores context_type/context_id).
 * Plays through the existing singleton audioPlayer queue — never a
 * second audio element. Playback survives rerenders (module-level
 * autoplay guard + queueName identity check).
 */
import React, { useEffect, useState } from "react";
import { Disc3, Play, Pause, SkipBack, SkipForward, Settings2, Loader2, Music } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import {
  subscribe, playQueue, toggle, next as queueNext, prev as queuePrev,
} from "@/lib/audioPlayer";

const autoplayAttempted = new Set(); // usernames — never re-trigger on rerender

export default function RealmSoundtrack({ username, isOwner }) {
  const [data, setData] = useState(null);
  const [st, setSt] = useState(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => subscribe(setSt), []);

  const load = async () => {
    try {
      const { data: d } = await apiClient.get(`/playlists/soundtrack/by-user/${username}`);
      setData(d);
    } catch { setData({ enabled: false }); }
  };
  useEffect(() => { load(); }, [username]); // eslint-disable-line react-hooks/exhaustive-deps

  const qName = `soundtrack:${username}`;
  const active = st?.queueName === qName;

  const start = (idx = null) => {
    const tracks = data?.tracks || [];
    if (!tracks.length) return;
    let startIndex = 0;
    if (idx != null) startIndex = idx;
    else if (data.settings?.start_track_id) {
      const j = tracks.findIndex((t) => t.id === data.settings.start_track_id);
      if (j >= 0) startIndex = j;
    }
    playQueue(tracks, startIndex, {
      shuffle: !!data.settings?.shuffle, repeat: !!data.settings?.repeat, name: qName,
    });
  };

  // "Start automatically when allowed" — attempted ONCE per username per
  // page lifetime; a blocked attempt leaves the queue loaded so the
  // one-tap Start button resumes it.
  useEffect(() => {
    if (!data?.enabled || !data.settings?.autoplay || !data.tracks?.length) return;
    if (autoplayAttempted.has(username)) return;
    autoplayAttempted.add(username);
    start();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  if (!data.enabled && !isOwner) return null;

  return (
    <div className="or-surface p-4" data-testid="realm-soundtrack">
      <div className="flex items-center gap-2 mb-2">
        <Disc3 size={15} style={{ color: "var(--primary)" }} />
        <span className="text-sm font-bold flex-1" style={{ fontFamily: "var(--font-display)" }}>
          Realm Soundtrack
        </span>
        {isOwner && (
          <button className="starbar-icon" style={{ width: 28, height: 28 }}
            onClick={() => setEditOpen((v) => !v)} aria-label="Soundtrack settings"
            data-testid="soundtrack-settings-toggle">
            <Settings2 size={13} />
          </button>
        )}
      </div>

      {isOwner && editOpen && (
        <SoundtrackEditor data={data} onSaved={() => { setEditOpen(false); load(); }} />
      )}

      {!data.enabled ? (
        isOwner && !editOpen ? (
          <button className="or-chip text-[11px]" onClick={() => setEditOpen(true)}
            data-testid="soundtrack-setup">
            <Music size={11} /> Add a Realm Soundtrack
          </button>
        ) : null
      ) : (
        <>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}
            data-testid="soundtrack-playlist-name">
            {data.playlist?.name} · {data.tracks.length} sound{data.tracks.length === 1 ? "" : "s"}
          </div>

          {data.tracks.length === 0 ? (
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              No playable Sounds in this playlist yet.
            </div>
          ) : !active ? (
            <button className="or-btn w-full text-xs" onClick={() => start()}
              data-testid="soundtrack-start">
              <Play size={13} /> Start Realm Soundtrack
            </button>
          ) : (
            <div className="flex items-center gap-2" data-testid="soundtrack-controls">
              <button className="starbar-icon shrink-0" style={{ width: 30, height: 30 }}
                onClick={() => queuePrev()} aria-label="Previous"
                data-testid="soundtrack-prev"><SkipBack size={13} /></button>
              <button className="starbar-icon shrink-0"
                style={{ width: 36, height: 36, background: "var(--primary)", color: "var(--primary-fg)" }}
                onClick={() => toggle()} aria-label={st?.playing ? "Pause" : "Play"}
                data-testid="soundtrack-toggle">
                {st?.loading ? <Loader2 size={15} className="animate-spin" />
                  : st?.playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button className="starbar-icon shrink-0" style={{ width: 30, height: 30 }}
                onClick={() => queueNext()} aria-label="Next"
                data-testid="soundtrack-next"><SkipForward size={13} /></button>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate" style={{ color: "var(--text-main)" }}
                  data-testid="soundtrack-current">{st?.track?.title || ""}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}
                  data-testid="soundtrack-queue-pos">
                  {st?.queueIndex >= 0 ? `${st.queueIndex + 1}/${st.queue.length}` : ""}
                  {st?.error ? " · tap play to start" : ""}
                </div>
              </div>
            </div>
          )}

          {data.tracks.length > 0 && (
            <div className="mt-2 space-y-1" data-testid="soundtrack-tracklist">
              {data.tracks.slice(0, 6).map((t, idx) => (
                <button key={t.id} className="w-full flex items-center gap-2 p-1 rounded text-left"
                  style={{
                    background: active && st?.track?.id === t.id ? "var(--surface-2)" : "transparent",
                  }}
                  onClick={() => start(idx)} data-testid={`soundtrack-track-${t.id}`}>
                  {t.cover_url ? (
                    <img src={resolveMediaUrl(t.cover_url)} alt="" className="rounded object-cover shrink-0"
                      style={{ width: 22, height: 22 }} />
                  ) : (
                    <span className="inline-flex items-center justify-center rounded shrink-0"
                      style={{ width: 22, height: 22, background: "var(--surface-2)", color: "var(--text-muted)" }}>
                      <Music size={10} />
                    </span>
                  )}
                  <span className="flex-1 min-w-0 text-[11px] truncate"
                    style={{ color: active && st?.track?.id === t.id ? "var(--primary)" : "var(--text-main)" }}>
                    {t.title}
                  </span>
                </button>
              ))}
              {data.tracks.length > 6 && (
                <div className="text-[10px] pl-1" style={{ color: "var(--text-muted)" }}>
                  +{data.tracks.length - 6} more
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SoundtrackEditor({ data, onSaved }) {
  const [lists, setLists] = useState(null);
  const [form, setForm] = useState({
    playlist_id: data.playlist?.id || "",
    start_track_id: data.settings?.start_track_id || "",
    shuffle: !!data.settings?.shuffle,
    repeat: !!data.settings?.repeat,
    autoplay: !!data.settings?.autoplay,
  });
  const [tracks, setTracks] = useState(data.tracks || []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get("/playlists/mine").then((r) => setLists(r.data.playlists || [])).catch(() => setLists([]));
  }, []);

  const pickPlaylist = async (id) => {
    setForm((f) => ({ ...f, playlist_id: id, start_track_id: "" }));
    if (!id) { setTracks([]); return; }
    try {
      const { data: d } = await apiClient.get(`/playlists/${id}`);
      setTracks(d.items.filter((i) => !i.unavailable).map((i) => i.track));
    } catch { setTracks([]); }
  };

  const save = async (remove = false) => {
    setBusy(true);
    try {
      await apiClient.put("/playlists/soundtrack", remove
        ? { playlist_id: null }
        : { ...form, start_track_id: form.start_track_id || null });
      toast.success(remove ? "Soundtrack removed" : "Soundtrack saved");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 mb-3 p-2 rounded"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-col)" }}
      data-testid="soundtrack-editor">
      {lists === null ? <Loader2 size={13} className="animate-spin" /> : (
        <>
          <select className="or-input w-full text-xs" value={form.playlist_id}
            onChange={(e) => pickPlaylist(e.target.value)}
            data-testid="soundtrack-playlist-select" aria-label="Soundtrack playlist">
            <option value="">— choose a playlist —</option>
            {lists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.item_count})</option>)}
          </select>
          {tracks.length > 0 && (
            <select className="or-input w-full text-xs" value={form.start_track_id}
              onChange={(e) => setForm((f) => ({ ...f, start_track_id: e.target.value }))}
              data-testid="soundtrack-start-select" aria-label="Starting sound">
              <option value="">Start from first</option>
              {tracks.map((t) => <option key={t.id} value={t.id}>Start: {t.title}</option>)}
            </select>
          )}
          <div className="flex gap-3 text-[11px] flex-wrap" style={{ color: "var(--text-muted)" }}>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={form.shuffle}
                onChange={(e) => setForm((f) => ({ ...f, shuffle: e.target.checked }))}
                data-testid="soundtrack-shuffle" /> Shuffle
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={form.repeat}
                onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.checked }))}
                data-testid="soundtrack-repeat" /> Repeat
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={form.autoplay}
                onChange={(e) => setForm((f) => ({ ...f, autoplay: e.target.checked }))}
                data-testid="soundtrack-autoplay" /> Start automatically when allowed
            </label>
          </div>
          <div className="flex gap-2">
            <button className="or-btn text-[11px] flex-1" disabled={busy || !form.playlist_id}
              onClick={() => save(false)} data-testid="soundtrack-save">
              {busy ? <Loader2 size={11} className="animate-spin" /> : "Save"}
            </button>
            {data.enabled && (
              <button className="or-chip text-[11px]" style={{ color: "#FF8080" }} disabled={busy}
                onClick={() => save(true)} data-testid="soundtrack-remove">Remove</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
