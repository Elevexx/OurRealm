import React, { useEffect, useState } from "react";
import { Sparkles, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";
import UserAvatar from "@/components/UserAvatar";

/**
 * TopEightWidget — renders the owner's Inner-8 friends as a small card grid.
 * Read-only here; editing happens on the Friends page (Edit toggle in the
 * "Close Realm" widget) so we don't duplicate management UI.
 */
export default function TopEightWidget({ username }) {
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get(`/profile/by-username/${username}`);
        const ids = data?.user?.inner_8 || [];
        if (!ids.length) { if (!cancelled) setFriends([]); return; }
        // Hydrate via /api/users/search per id is not available — use
        // /api/users/featured (returns up to 50 with usernames) then filter.
        const f = await apiClient.get(`/users/featured?limit=200`);
        const list = (f.data?.users || []).filter((u) => ids.includes(u.id));
        // Preserve owner's order
        const ordered = ids.map((id) => list.find((u) => u.id === id)).filter(Boolean);
        if (!cancelled) setFriends(ordered);
      } catch { if (!cancelled) setFriends([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [username]);

  return (
    <div className="flex flex-col h-full or-min0" data-testid="top8-widget">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={14} style={{ color: "var(--primary)" }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--primary)" }}>
          Top 8
        </span>
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{friends.length}/8</span>
      </div>
      {loading ? (
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : friends.length === 0 ? (
        <div className="text-[11px] text-center mt-2" style={{ color: "var(--text-muted)" }}>
          No Top 8 yet. Add friends from the Friends page.
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 flex-1 overflow-y-auto no-scrollbar">
          {friends.map((f, i) => (
            <button
              key={f.id}
              onClick={(e) => { e.stopPropagation(); navigate(`/public/${f.username}`); }}
              className="flex flex-col items-center gap-1 min-w-0"
              data-testid={`top8-card-${f.username}`}
            >
              <div className="rounded-full p-[2px] aspect-square w-full" style={{ background: "var(--primary)", maxWidth: 52, position: "relative" }}>
                <UserAvatar
                  user={f}
                  size={48}
                  testid={`top8-avatar-${f.username}`}
                  style={{ border: "2px solid var(--bgc)", display: "block", width: "100%", height: "100%" }}
                />
              </div>
              <span className="text-[9px] font-semibold truncate w-full text-center" style={{ color: "var(--text-main)" }}>
                #{i + 1} @{f.username}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
