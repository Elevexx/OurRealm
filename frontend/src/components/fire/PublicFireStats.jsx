/**
 * PublicFireStats — the PUBLIC Fire Power summary shown on OTHER
 * people's profiles. Displays only progression facts (level, badge,
 * max fire per reaction) plus privacy-filtered Fire Received. The
 * backend never sends private wallet values to non-owners — hidden
 * stats arrive as {visible:false} with NO value in the JSON, HTML or
 * client state. Owners never see this component (they get the full
 * FireWalletCard instead).
 */
import React, { useEffect, useState } from "react";
import { Flame, Lock } from "lucide-react";
import apiClient from "@/api/client";
import { CollapsibleHeader, useAccordionState } from "@/components/progression/CollapsibleHeader";

const FIRE = "#FF7A1A";

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

  if (!data?.enabled) return null;
  const summary = data.public_summary || {};
  const received = data.stats?.fire_received || { visible: false };

  return (
    <div className="or-surface p-4 mb-5" data-testid="public-fire-stats">
      <CollapsibleHeader
        icon={<Flame size={16} style={{ color: FIRE }} fill={FIRE} aria-hidden="true" />}
        title="Fire Power"
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        testid="public-fire-stats-header"
        titleTestid="public-fire-stats-title"
        arrowTestid="public-fire-stats-toggle"
      />
      {expanded && (
      <>
      {/* Level + badge hero */}
      <div className="p-4 rounded-2xl mt-2.5 mb-3 flex items-center gap-4" style={{
        border: `1px solid color-mix(in srgb, ${FIRE} 40%, transparent)`,
        background: `radial-gradient(110% 100% at 50% 0%, color-mix(in srgb, ${FIRE} 12%, transparent), transparent 70%)`,
      }} data-testid="public-fire-level-section">
        {summary.level_badge_url ? (
          <img src={summary.level_badge_url} alt="" aria-hidden="true"
            className="shrink-0" style={{ width: 52, height: 52, objectFit: "contain", filter: `drop-shadow(0 0 10px color-mix(in srgb, ${FIRE} 50%, transparent))` }} />
        ) : (
          <img src="/fire-power-icon.png" alt="" aria-hidden="true"
            className="shrink-0" style={{ width: 52, height: 52, objectFit: "contain", filter: `drop-shadow(0 0 10px color-mix(in srgb, ${FIRE} 50%, transparent))` }} />
        )}
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Current Level</div>
          <div className="text-lg sm:text-xl font-bold truncate" style={{ color: FIRE }} data-testid="public-fire-level">
            Level {summary.level_number ?? 1}{summary.level_name ? ` · ${summary.level_name}` : ""}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl text-center" style={{ border: "1px solid var(--border-col)" }}
          data-testid="public-fire-stat-fire_received">
          <div className="text-lg sm:text-xl font-bold"
            style={{ color: received.visible ? "var(--text-main)" : "var(--text-muted)" }}
            data-testid="public-fire-stat-fire_received-value">
            {received.visible ? `${(received.value ?? 0).toLocaleString()} 🔥` : (
              <span className="inline-flex items-center gap-1 text-xs" aria-label="Private">
                <Lock size={10} /> Private
              </span>
            )}
          </div>
          <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>
            Total Fire Received
          </div>
        </div>
        <div className="p-3 rounded-xl text-center" style={{ border: "1px solid var(--border-col)" }}
          data-testid="public-fire-stat-max_reaction">
          <div className="text-lg sm:text-xl font-bold" style={{ color: FIRE }} data-testid="public-fire-stat-max_reaction-value">
            {summary.max_fire_per_reaction ?? 1}× 🔥
          </div>
          <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>
            Max Fire Per Reaction
          </div>
        </div>
      </div>

      {data.stats?.most_fired_post?.visible && data.stats.most_fired_post.post_id && (
        <div className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="public-fire-most-fired">
          🔥 Most fired post: <b style={{ color: FIRE }}>{data.stats.most_fired_post.value} 🔥</b>
          {" — "}{data.stats.most_fired_post.preview || "View post"}
        </div>
      )}

      <div className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }} data-testid="public-fire-explainer">
        Fire Power grows through community reactions. Members earn Fire from the community by creating great content.
      </div>
      <div className="mt-2 pt-2 text-[10px]" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-col)" }} data-testid="public-fire-footer">
        This is a public Fire Power summary.<br />
        Only the account owner can manage their Fire Power.
      </div>
      </>
      )}
    </div>
  );
}
