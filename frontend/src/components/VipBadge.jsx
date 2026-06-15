import React, { useState } from "react";
import { Crown } from "lucide-react";

/**
 * VipBadge — early-adopter badge for grandfathered & first-1000 accounts.
 * Tap (mobile) or hover (desktop) reveals "VIP Member • Joined {date}".
 */
function fmt(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return ""; }
}

export default function VipBadge({ joinedAt, size = "sm", testid }) {
  const [open, setOpen] = useState(false);
  const px = size === "lg" ? "px-2.5 py-1 text-[11px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded font-bold uppercase ${px}`}
        style={{
          background: "linear-gradient(135deg, #FFD24A, #FF8AC2)",
          color: "#1a0d2a",
          letterSpacing: "0.08em",
          boxShadow: "0 0 10px rgba(255,210,74,0.45)",
        }}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-describedby="vip-tooltip"
        data-testid={testid || "vip-badge"}
      >
        <Crown size={size === "lg" ? 12 : 10} /> VIP
      </button>
      {open && (
        <span
          role="tooltip"
          id="vip-tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 mt-1 px-2 py-1 text-[10px] whitespace-nowrap rounded"
          style={{
            top: "100%",
            background: "var(--surface-2)",
            color: "var(--text-main)",
            border: "1px solid var(--border-col)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
          }}
          data-testid="vip-tooltip"
        >
          VIP Member · Joined {fmt(joinedAt)}
        </span>
      )}
    </span>
  );
}
