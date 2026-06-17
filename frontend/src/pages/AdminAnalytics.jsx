/** Admin Analytics — server-side guarded; only @stealth can view. */
import React, { useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const RANGES = [
  { id: "24h", label: "24 hours" }, { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },  { id: "all", label: "All time" },
];

function Stat({ label, value, sub }) {
  return (
    <div className="or-surface p-4">
      <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-2xl mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>{value ?? "—"}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

function MiniLine({ series, accent = "var(--primary)" }) {
  if (!series?.length) return null;
  const max = Math.max(1, ...series.map((p) => p.count));
  return (
    <svg viewBox={`0 0 ${series.length * 20} 60`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
      <polyline
        points={series.map((p, i) => `${i * 20},${60 - (p.count / max) * 55}`).join(" ")}
        fill="none" stroke={accent} strokeWidth="2"
      />
    </svg>
  );
}

function MiniBars({ dist, accent = "var(--brand-green)" }) {
  const entries = Object.entries(dist || {});
  if (!entries.length) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>No data.</div>;
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="text-xs">
          <div className="flex justify-between" style={{ color: "var(--text-muted)" }}>
            <span>{k}</span><span style={{ color: "var(--text-main)" }}>{v}</span>
          </div>
          <div className="w-full h-1.5 rounded" style={{ background: "var(--surface-2)" }}>
            <div style={{ width: `${(v / max) * 100}%`, height: "100%", background: accent, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [range, setRange] = useState("7d");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true); setErr("");
    apiClient.get("/admin/analytics", { params: { range } })
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [range]);

  if (!user) return <div className="or-surface p-6 max-w-md mx-auto" style={{ color: "var(--text-muted)" }}>Sign in required.</div>;

  return (
    <div className="max-w-6xl mx-auto" data-testid="admin-analytics">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck size={26} style={{ color: "#00FF66" }} />
          <div>
            <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Admin · Analytics</div>
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>OurRealm Pulse</h1>
          </div>
        </div>
        <div className="flex gap-1" data-testid="analytics-range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              data-active={range === r.id}
              data-testid={`analytics-range-${r.id}`}
              className="text-xs px-3 py-1.5"
              style={{
                borderRadius: 999,
                background: range === r.id ? "color-mix(in srgb, var(--primary) 18%, transparent)" : "transparent",
                color: range === r.id ? "var(--primary)" : "var(--text-muted)",
                border: `1px solid ${range === r.id ? "var(--primary)" : "var(--border-col)"}`,
              }}
            >{r.label}</button>
          ))}
        </div>
      </header>

      {err && (
        <div className="or-surface p-4 mb-4 text-sm" style={{ color: "#ff8080", border: "1px solid rgba(255,80,80,0.4)" }} data-testid="analytics-error">
          {err}
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center py-10" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {data && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Stat label="Total users" value={data.users.total} />
            <Stat label="New signups" value={data.users.new_signups} sub={`window: ${range}`} />
            <Stat label="DAU"          value={data.users.dau} />
            <Stat label="MAU"          value={data.users.mau} sub={`retention ~${data.users.retention_pct}%`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4 mb-5">
            <section className="or-surface p-4">
              <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Posts trend</h3>
              <div className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{data.content.posts} posts · {data.content.engagement.likes} likes · {data.content.engagement.comments} comments</div>
              <MiniLine series={data.content.series} />
            </section>
            <section className="or-surface p-4">
              <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>Media type distribution</h3>
              <MiniBars dist={data.content.media_distribution} />
            </section>
          </div>
          <div className="grid lg:grid-cols-3 gap-4 mb-5">
            <Stat label="Messages"  value={data.messaging.messages} />
            <Stat label="Chats"     value={data.messaging.chats} />
            <Stat label="Groups · Realms" value={`${data.messaging.groups} · ${data.messaging.realms}`} />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <section className="or-surface p-4">
              <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--brand-green)" }}>Sounds uploads trend</h3>
              <div className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{data.sounds.uploads_in_range} uploads · {data.sounds.total_plays} plays</div>
              <MiniLine series={data.sounds.series} accent="var(--brand-green)" />
              <h4 className="text-sm mt-3 mb-1" style={{ color: "var(--text-main)" }}>Categories</h4>
              <MiniBars dist={data.sounds.category_distribution} />
            </section>
            <section className="or-surface p-4">
              <h3 className="text-lg mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--brand-green)" }}>Top sounds</h3>
              <ol className="space-y-1.5 text-sm">
                {(data.sounds.top || []).map((t, i) => (
                  <li key={t.id} className="flex justify-between">
                    <span style={{ color: "var(--text-main)" }}>{i + 1}. {t.title}</span>
                    <span style={{ color: "var(--text-muted)" }}>{t.plays || 0} plays · {t.likes || 0} likes</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
