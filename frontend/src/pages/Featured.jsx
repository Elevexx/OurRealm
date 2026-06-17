import React, { useEffect, useState } from "react";
import { Flame, Sparkles, Star, Loader2, UserPlus, BadgeCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import apiClient from "@/api/client";
import { usePresence } from "@/contexts/PresenceContext";
import PresenceDot from "@/components/PresenceDot";

/**
 * Featured — Phase C rebuild.
 *
 * Replaces all mock CHARACTERS / makeMockPosts with a real query against
 * `/api/users/trending` (sorted by `follower_count DESC`). Only real
 * users are surfaced.
 */
export default function Featured() {
  const navigate = useNavigate();
  const { statuses } = usePresence();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await apiClient.get("/users/trending", { params: { limit: 24 } });
        if (!mounted) return;
        setUsers(data.users || []);
      } catch (e) {
        if (mounted) setErr(e?.response?.data?.detail || e.message || "Failed to load");
      } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="max-w-7xl mx-auto" data-testid="featured-page">
      <div className="mb-5 flex items-center gap-3">
        <Star size={28} style={{ color: "#F4C84A", filter: "drop-shadow(0 0 12px rgba(244,200,74,0.6))" }} />
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Trending creators on OurRealm</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Featured</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12" style={{ color: "var(--text-muted)" }} data-testid="featured-loading">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : err ? (
        <div className="or-surface p-6 text-center text-sm" style={{ color: "#FF8080" }} data-testid="featured-error">{err}</div>
      ) : users.length === 0 ? (
        <div className="or-surface p-10 text-center" data-testid="featured-empty">
          <div className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>No featured creators yet</div>
          <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>Once people connect on OurRealm they&apos;ll show up here.</p>
        </div>
      ) : (
        <>
          <div className="mb-7">
            <h3 className="text-xl mb-3 flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
              <Flame size={18} /> Top creators by followers
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {users.slice(0, 12).map((u) => {
                const status = statuses[u.id] || u.presence_status || "offline";
                return (
                  <button
                    key={u.id}
                    onClick={() => navigate(`/public/${u.username}`)}
                    className="or-surface p-4 text-center"
                    data-testid={`featured-creator-${u.username}`}
                  >
                    <div className="relative inline-block">
                      <div className="rounded-full p-[3px] mx-auto" style={{ background: "var(--primary)", width: 88, height: 88 }}>
                        <img
                          src={u.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name || u.username)}`}
                          alt={u.username}
                          className="w-full h-full rounded-full object-cover"
                          style={{ border: "3px solid var(--bgc)" }}
                        />
                      </div>
                      {status !== "offline" && (
                        <span style={{ position: "absolute", right: 4, bottom: 4 }}>
                          <PresenceDot status={status} size={12} data-testid={`featured-status-${u.username}`} />
                        </span>
                      )}
                    </div>
                    <div className="mt-3 font-semibold flex items-center justify-center gap-1" style={{ color: "var(--text-main)" }}>
                      @{u.username}
                      {u.is_founder && <BadgeCheck size={14} style={{ color: "var(--brand-green)" }} />}
                    </div>
                    <div className="text-[10px] mt-1 uppercase tracking-widest" style={{ color: "var(--brand-green)" }}>
                      {u.follower_count} follower{u.follower_count === 1 ? "" : "s"}
                    </div>
                    {u.bio ? (
                      <div className="text-xs mt-2 line-clamp-2" style={{ color: "var(--text-muted)" }}>{u.bio}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {users.length > 12 && (
            <div className="mb-4 flex items-baseline justify-between">
              <h3 className="text-xl flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
                <Sparkles size={18} /> Rising
              </h3>
            </div>
          )}
          {users.length > 12 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {users.slice(12).map((u) => (
                <button
                  key={u.id}
                  onClick={() => navigate(`/public/${u.username}`)}
                  className="or-surface p-4 text-left flex items-center gap-3"
                  data-testid={`featured-rising-${u.username}`}
                >
                  <img
                    src={u.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.name || u.username)}`}
                    alt={u.username}
                    className="rounded-full object-cover"
                    style={{ width: 48, height: 48, border: "2px solid var(--primary)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>@{u.username}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {u.follower_count} followers
                    </div>
                  </div>
                  <UserPlus size={16} style={{ color: "var(--primary)" }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
