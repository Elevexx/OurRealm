import React from "react";
import * as Icons from "lucide-react";

/**
 * MiniWidget — a compact, read-only render of a profile widget.
 * Used by the Discover page horizontal swiper to preview each user's
 * actual saved widgets without exposing edit / drag handles.
 */
const TYPE_ICON = {
  live: "Radio",
  videos: "Video",
  music: "Music2",
  podcasts: "Mic",
  photos: "Image",
  merch: "ShoppingBag",
  events: "Calendar",
  tour: "MapPin",
  friends: "Users",
  weather: "CloudSun",
  news: "Newspaper",
  crypto: "Bitcoin",
  stocks: "TrendingUp",
  calendar: "Calendar",
  notes: "FileText",
  polls: "BarChart3",
  wallet: "Wallet",
  ads: "DollarSign",
  radar: "Radar",
  custom: "Sparkles",
};

const TYPE_ACCENT = {
  live: "#FF3F5A",
  music: "#C26BFF",
  merch: "#10E670",
  events: "#FFB72E",
  videos: "#2EA0FF",
  photos: "#10E670",
  friends: "#FF8AC2",
  polls: "#F4C84A",
  wallet: "#10E670",
  custom: "#2EA0FF",
};

function MiniBody({ w }) {
  switch (w.type) {
    case "live":
      return (
        <div className="text-[10px] leading-tight">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#FF3F5A" }} />
            <span className="font-bold" style={{ color: "#FF3F5A", letterSpacing: ".1em" }}>OFF AIR</span>
          </div>
          <div style={{ color: "var(--text-muted)" }}>Next stream Sat 9 PM</div>
        </div>
      );
    case "music":
      return (
        <div className="text-[10px] space-y-1">
          {["Stealth Mode", "Realm Anthem", "Neon Drift"].map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <Icons.Play size={9} style={{ color: "var(--primary)" }} />
              <span className="truncate" style={{ color: "var(--text-main)" }}>{t}</span>
            </div>
          ))}
        </div>
      );
    case "merch":
      return (
        <div className="grid grid-cols-3 gap-1">
          {[0,1,2].map((i) => (
            <div key={i} className="aspect-square rounded" style={{ background: "color-mix(in srgb, var(--primary) 20%, transparent)" }} />
          ))}
        </div>
      );
    case "events":
      return (
        <div className="text-[10px] space-y-1">
          <div className="flex justify-between"><span style={{ color: "var(--text-main)" }}>Realm Festival</span><span style={{ color: "var(--text-muted)" }}>Sat</span></div>
          <div className="flex justify-between"><span style={{ color: "var(--text-main)" }}>Stealth Set</span><span style={{ color: "var(--text-muted)" }}>Mar 22</span></div>
        </div>
      );
    case "polls":
      return (
        <div className="text-[10px] space-y-1">
          {[["Drop EP", 64],["Wait", 36]].map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between"><span style={{ color: "var(--text-main)" }}>{k}</span><span style={{ color: "var(--primary)" }}>{v}%</span></div>
              <div className="h-1 rounded" style={{ background: "var(--border-col)" }}>
                <div className="h-full rounded" style={{ background: "var(--primary)", width: `${v}%` }} />
              </div>
            </div>
          ))}
        </div>
      );
    case "wallet":
      return (
        <div>
          <div className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Balance</div>
          <div className="text-base font-bold" style={{ color: "var(--text-main)" }}>$12,420</div>
          <div className="text-[9px]" style={{ color: "var(--brand-green)" }}>+4.2%</div>
        </div>
      );
    default:
      return (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {w.title || w.type}
        </div>
      );
  }
}

export default function MiniWidget({ w }) {
  const IconName = TYPE_ICON[w.type] || "Sparkles";
  const Icon = Icons[IconName] || Icons.Sparkles;
  const accent = TYPE_ACCENT[w.type] || "var(--primary)";
  return (
    <div
      className="or-surface p-2.5 flex flex-col gap-1.5"
      style={{ background: "var(--surface-2)", minHeight: 90 }}
      data-testid={`mini-widget-${w.id || w.type}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} style={{ color: accent }} />
        <span className="text-[9px] font-bold uppercase tracking-widest truncate" style={{ color: accent }}>
          {w.title || w.type}
        </span>
      </div>
      <div className="flex-1"><MiniBody w={w} /></div>
    </div>
  );
}
