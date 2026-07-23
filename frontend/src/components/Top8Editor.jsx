/**
 * Top 8 management UI — drop into Edit Profile. Fetches the viewer's
 * friends list itself, persists changes to `inner_8` via PATCH /profile/me.
 * Backed by the same field as the read-only TopEightWidget so the change
 * is reflected on the profile preview instantly without a refresh.
 *
 * Behavior matches spec:
 *  - Add (tap empty slot → picker → instant fill)
 *  - Remove (tap remove icon on a filled slot → instant)
 *  - Reorder (◀/▶ arrows on a filled slot → instant)
 *  - Replace (tap a filled slot → picker offers candidates → swaps in)
 */
import React, { useEffect, useMemo, useState } from "react";
import { Plus, X, Sparkles, Search } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const RING_COLORS = ["#10E670", "#2EA0FF", "#FF8AC2", "#FFD24A", "#FF3F5A", "#B26BFF", "#22D3EE", "#9EE800"];

export default function Top8Editor() {
  const { user, refreshMe } = useAuth();
  const [friends, setFriends] = useState([]);
  const [picker, setPicker] = useState({ open: false, replaceIndex: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Local optimistic copy so save() can be fire-and-forget while UI moves.
  const [ids, setIds] = useState(user?.inner_8 || []);
  // Phase 5 — search inside the picker.
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => { setIds(user?.inner_8 || []); }, [user?.inner_8]);
  // Reset search every time the picker opens/closes.
  useEffect(() => { if (!picker.open) setPickerQuery(""); }, [picker.open]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        if (cancelled) return;
        setFriends(data?.friends || []);
      } catch (e) {
        if (!cancelled) setFriends([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const idToFriend = new Map(friends.map((f) => [f.id, f]));
  // Inner Realm display size (4/8/12/24). Members beyond the size stay
  // stored (hidden) and reappear in order when the size is raised again.
  const size = [4, 8, 12, 24].includes(user?.inner_realm_size) ? user.inner_realm_size : 8;
  const slots = Array.from({ length: size }, (_, i) => ids[i] || null);
  const hiddenCount = Math.max(0, ids.length - size);
  const changeSize = async (n) => {
    setBusy(true); setErr("");
    try {
      await apiClient.patch("/profile/me", { inner_realm_size: n });
      await refreshMe?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not save Inner Realm size");
    } finally { setBusy(false); }
  };
  const candidates = (replaceIndex) =>
    friends.filter((f) =>
      // For replace: allow swapping in any friend not currently in another
      // slot (but the slot being replaced is fair game so the same person
      // can stay if the user changes their mind).
      replaceIndex == null
        ? !ids.includes(f.id)
        : !ids.filter((_, i) => i !== replaceIndex).includes(f.id),
    );

  // Apply the client-side search filter to the picker list.
  const filteredCandidates = useMemo(() => {
    const list = candidates(picker.replaceIndex);
    const term = pickerQuery.trim().toLowerCase();
    if (!term) return list;
    return list.filter((f) =>
      (f.username || "").toLowerCase().includes(term)
      || (f.name || "").toLowerCase().includes(term)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerQuery, friends, ids, picker.replaceIndex]);

  const save = async (next) => {
    setBusy(true); setErr("");
    setIds(next);
    try {
      await apiClient.patch("/profile/me", { inner_8: next });
      await refreshMe?.();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not save Inner Realm");
      setIds(user?.inner_8 || []); // rollback
    } finally { setBusy(false); }
  };

  const add = (id, index = null) => {
    let next;
    if (index === null) {
      if (ids.length >= size) { setErr("Remove a friend from your Inner Realm to add more"); return; }
      next = [...ids, id];
    } else {
      next = [...ids];
      next[index] = id;
      // Compact: drop trailing nulls so the array is dense up to length 8.
      next = next.filter(Boolean);
    }
    setPicker({ open: false, replaceIndex: null });
    save(next);
  };
  const remove = (id) => save(ids.filter((x) => x !== id));
  const move = (id, dir) => {
    const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids]; [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };

  return (
    <div className="or-surface p-4 sm:p-5 mb-5" data-testid="profile-top8-editor">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-base sm:text-lg flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
          <Sparkles size={16} /> Top 8
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>auto-saves</span>
        </h3>
        {busy && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Saving…</span>}
      </div>
      {err && <div className="text-[11px] mb-2" data-testid="top8-err" style={{ color: "#FF8080" }}>{err}</div>}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-4 place-items-center">
        {slots.map((id, i) => {
          const ring = RING_COLORS[i];
          if (!id) {
            return (
              <button
                key={`empty-${i}`}
                onClick={() => setPicker({ open: true, replaceIndex: i })}
                className="flex flex-col items-center gap-1.5 min-w-0 w-full"
                data-testid={`top8-add-slot-${i}`}
                style={{ opacity: 0.85 }}
              >
                <div className="rounded-full aspect-square w-full flex items-center justify-center" style={{ border: `2px dashed ${ring}`, maxWidth: 80, color: ring }}>
                  <Plus size={20} />
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Add Friend</div>
              </button>
            );
          }
          const f = idToFriend.get(id);
          if (!f) {
            // Friend was unfriended/deleted but still listed — show a stub.
            return (
              <button
                key={`stub-${id}`}
                onClick={() => remove(id)}
                className="flex flex-col items-center gap-1.5 min-w-0 w-full"
                data-testid={`top8-stub-${id}`}
                title="Tap to remove (no longer a friend)"
              >
                <div className="rounded-full aspect-square w-full flex items-center justify-center" style={{ border: `2px dashed var(--text-muted)`, maxWidth: 80, color: "var(--text-muted)" }}>
                  <X size={20} />
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Tap to remove</div>
              </button>
            );
          }
          const avatar = f.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(f.name || f.username)}`;
          return (
            <div key={id} className="flex flex-col items-center gap-1.5 min-w-0 w-full" data-testid={`top8-slot-${f.username}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setPicker({ open: true, replaceIndex: i })}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicker({ open: true, replaceIndex: i }); } }}
                className="rounded-full p-[3px] relative aspect-square w-full cursor-pointer"
                style={{ background: ring, boxShadow: `0 0 14px ${ring}66`, maxWidth: 80 }}
                aria-label={`Inner Realm #${i + 1}: @${f.username} (tap to replace)`}
              >
                <img src={avatar} alt="" className="w-full h-full rounded-full object-cover" style={{ border: "3px solid var(--bgc)" }} />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full text-[8px] font-extrabold" style={{ background: ring, color: "#fff", letterSpacing: "0.06em" }}>#{i + 1}</span>
                <button
                  type="button"
                  className="absolute -top-1 -right-1 rounded-full w-5 h-5 flex items-center justify-center"
                  style={{ background: "#FF3F5A", color: "#fff", border: "2px solid var(--bgc)" }}
                  onClick={(e) => { e.stopPropagation(); remove(id); }}
                  data-testid={`top8-remove-${f.username}`}
                  aria-label={`Remove @${f.username}`}
                >
                  <X size={10} />
                </button>
              </div>
              <div className="text-[11px] sm:text-xs font-semibold text-center truncate w-full" style={{ color: "var(--text-main)" }}>{f.name || `@${f.username}`}</div>
              <div className="flex gap-1">
                <button type="button" className="text-[10px] px-1" onClick={() => move(id, -1)} data-testid={`top8-up-${f.username}`} style={{ color: "var(--text-muted)" }} aria-label={`Move @${f.username} left`}>◀</button>
                <button type="button" className="text-[10px] px-1" onClick={() => move(id, +1)} data-testid={`top8-down-${f.username}`} style={{ color: "var(--text-muted)" }} aria-label={`Move @${f.username} right`}>▶</button>
              </div>
            </div>
          );
        })}
      </div>

      {picker.open && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center px-3 pb-24 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
          onClick={() => setPicker({ open: false, replaceIndex: null })}
          data-testid="top8-picker"
        >
          <div className="or-surface w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
              <h3 className="text-base" style={{ fontFamily: "var(--font-display)" }}>
                {picker.replaceIndex != null && ids[picker.replaceIndex]
                  ? `Replace slot #${picker.replaceIndex + 1}`
                  : "Add to Top 8"}
              </h3>
              <button type="button" className="starbar-icon" style={{ width: 32, height: 32 }} onClick={() => setPicker({ open: false, replaceIndex: null })} data-testid="top8-picker-close"><X size={14} /></button>
            </div>
            {/* Search bar (Phase 5) */}
            <div className="px-3 pt-3">
              <div className="or-surface p-2.5 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
                <Search size={14} style={{ color: "var(--text-muted)" }} />
                <input
                  autoFocus
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search friends by name or @username…"
                  className="bg-transparent flex-1 outline-none border-none text-sm"
                  style={{ color: "var(--text-main)" }}
                  data-testid="top8-picker-search"
                />
              </div>
            </div>
            <div className="p-3 flex-1 overflow-y-auto">
              {filteredCandidates.length === 0 ? (
                <div className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
                  {friends.length === 0
                    ? "Add some friends first."
                    : pickerQuery.trim()
                      ? "No matches."
                      : "All your friends are already in your Inner Realm."}
                </div>
              ) : filteredCandidates.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => add(f.id, picker.replaceIndex)}
                  className="w-full flex items-center gap-3 p-2 text-left"
                  data-testid={`top8-pick-${f.username}`}
                  style={{ borderBottom: "1px solid var(--border-col)" }}
                >
                  <img src={f.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(f.name || f.username)}`} alt="" className="rounded-full" style={{ width: 36, height: 36 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: "var(--text-main)" }}>@{f.username}</div>
                    <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{f.name}</div>
                  </div>
                  <Plus size={14} style={{ color: "var(--primary)" }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
