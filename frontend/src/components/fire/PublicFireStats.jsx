/**
 * PublicFireStats — privacy-filtered fire stats on public profiles.
 * The backend only sends values the viewer may see; hidden stats
 * arrive as {visible:false} and render as "🔒 Private" (no value in
 * JSON, HTML, tooltips or aria labels). Null when the wallet flag is
 * OFF or nothing to show.
 */
import React, { useEffect, useState } from "react";
import { Flame, Lock } from "lucide-react";
import apiClient from "@/api/client";
import { CollapsibleHeader, useAccordionState } from "@/components/progression/CollapsibleHeader";

const LABELS = [
  ["lifetime_fire", "Lifetime Fire"],
  ["fire_received", "Fire Received"],
  ["fire_given", "Fire Given"],
  ["fire_collected", "Fire Collected"],
  ["vault_balance", "Vault Balance"],
  ["unique_supporters", "Supporters"],
  ["weekly_fire", "Weekly Fire"],
];

export default function PublicFireStats({ username }) {
  const [data, setData] = useState(null);
  // Same accordion behavior as Creator Progress / Progression Badges —
  // always collapsed on open, resets per viewed profile, never persisted.
  const [expanded, setExpanded] = useAccordionState(username, false);
  useEffect(() => {
    if (!username) return;
    let on = true;
    apiClient.get(`/fire/wallet/stats/${username}`)
      .then((r) => { if (on) setData(r.data); })
      .catch(() => { if (on) setData({ enabled: false }); });
    return () => { on = false; };
  }, [username]);

  if (!data?.enabled || !data.stats) return null;

  return (
    <div className="or-surface p-4 mb-5" data-testid="public-fire-stats">
      <CollapsibleHeader
        icon={<Flame size={16} style={{ color: "#FF7A1A" }} fill="#FF7A1A" aria-hidden="true" />}
        title="Fire Power"
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        testid="public-fire-stats-header"
        titleTestid="public-fire-stats-title"
        arrowTestid="public-fire-stats-toggle"
      />
      {expanded && (
      <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2.5">
        {LABELS.map(([key, label]) => {
          const s = data.stats[key] || { visible: false };
          return (
            <div key={key} className="p-2.5 rounded-xl text-center"
              style={{ border: "1px solid var(--border-col)" }}
              data-testid={`public-fire-stat-${key}`}>
              <div className="text-sm font-bold"
                style={{ color: s.visible ? "var(--text-main)" : "var(--text-muted)" }}
                data-testid={`public-fire-stat-${key}-value`}>
                {s.visible ? `${(s.value ?? 0).toLocaleString()}${key === "unique_supporters" ? "" : " 🔥"}` : (
                  <span className="inline-flex items-center gap-1 text-xs" aria-label="Private">
                    <Lock size={10} /> Private
                  </span>
                )}
              </div>
              <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
      {data.stats.most_fired_post?.visible && data.stats.most_fired_post.post_id && (
        <div className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="public-fire-most-fired">
          🔥 Most fired post: <b style={{ color: "#FF7A1A" }}>{data.stats.most_fired_post.value} 🔥</b>
          {" — "}{data.stats.most_fired_post.preview || "View post"}
        </div>
      )}
      </>
      )}
    </div>
  );
}
