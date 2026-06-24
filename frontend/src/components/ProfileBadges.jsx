/**
 * ProfileBadges — renders admin-assigned badges on a public profile.
 * Pulls /api/profile/{username}/badges (filters disabled badges
 * server-side). Inline pill list; renders nothing for users with zero
 * assigned badges so the layout doesn't shift.
 */
import React, { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import apiClient from "@/api/client";

export default function ProfileBadges({ username }) {
  const [badges, setBadges] = useState([]);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/profile/${username}/badges`);
        if (!cancelled) setBadges(data?.badges || []);
      } catch { /* silent — admin badges are non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [username]);

  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="profile-badges">
      {badges.map((b) => {
        const Icon = Icons[b.icon] || Icons.Award;
        return (
          <span
            key={b.key}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full"
            style={{ background: `${b.color || "#00FF66"}22`, color: b.color || "#00FF66", border: `1px solid ${b.color || "#00FF66"}55` }}
            title={b.description || b.name}
            data-testid={`profile-badge-${b.key}`}
          >
            <Icon size={11} /> {b.name}
          </span>
        );
      })}
    </div>
  );
}
