import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Users, Radio, Image as ImageIcon, Music2, MessageSquare, Calendar, Crown, Plus, Settings, Pin, ArrowLeft, Shield } from "lucide-react";
import { REALMS, CHARACTERS, makeMockPosts } from "@/data/mockData";

const TABS = [
  { id: "feed",    label: "Feed",    Icon: MessageSquare },
  { id: "lives",   label: "Lives",   Icon: Radio },
  { id: "videos",  label: "Videos",  Icon: ImageIcon },
  { id: "photos",  label: "Photos",  Icon: ImageIcon },
  { id: "sounds",  label: "Sounds",  Icon: Music2 },
  { id: "events",  label: "Events",  Icon: Calendar },
  { id: "members", label: "Members", Icon: Users },
];

export default function RealmDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const realm = REALMS.find((r) => r.id === id);
  const [tab, setTab] = useState("feed");
  const [joined, setJoined] = useState(false);
  const posts = React.useMemo(() => makeMockPosts(18), []);

  if (!realm) {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center">
        <div className="text-lg mb-3">Realm not found</div>
        <button className="or-btn" onClick={() => navigate("/realms")}>← Back to Realms</button>
      </div>
    );
  }

  const members = CHARACTERS;
  const moderators = members.slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto" data-testid={`realm-detail-${realm.id}`}>
      {/* Banner */}
      <div className="or-surface overflow-hidden mb-5" data-testid="realm-banner">
        <div className="relative h-48 sm:h-64">
          <img src={realm.banner} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 20%, ${realm.accent}22 60%, rgba(0,0,0,0.7))` }} />
          <button className="absolute top-3 left-3 starbar-icon" style={{ width: 36, height: 36 }} onClick={() => navigate("/realms")} data-testid="realm-back">
            <ArrowLeft size={16} />
          </button>
          <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-3">
            <div>
              <div className="text-4xl mb-2">{realm.emoji}</div>
              <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)", color: "#fff", textShadow: `0 0 18px ${realm.accent}` }}>{realm.name}</h1>
              <div className="text-sm mt-1 flex items-center gap-3" style={{ color: "#cfe3ff" }}>
                <span><Users size={12} className="inline" /> {realm.members.toLocaleString()}</span>
                <span style={{ color: "#10E670" }}>● {realm.online} online</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className={joined ? "or-btn or-btn-ghost" : "or-btn"}
                style={{ padding: "0.5rem 1rem" }}
                onClick={() => setJoined(!joined)}
                data-testid="realm-join"
              >
                {joined ? "Joined" : <><Plus size={14} /> Join Realm</>}
              </button>
              <button className="or-btn or-btn-ghost" style={{ padding: "0.5rem" }} data-testid="realm-settings"><Settings size={14} /></button>
            </div>
          </div>
        </div>
        <div className="p-4 flex flex-wrap gap-2 items-center" style={{ borderTop: "1px solid var(--border-col)" }}>
          <p className="flex-1 text-sm" style={{ color: "var(--text-muted)" }}>{realm.desc}</p>
          {realm.tags.map((t) => (
            <span key={t} className="text-[10px] uppercase tracking-widest px-2 py-1 rounded" style={{ background: `${realm.accent}22`, color: realm.accent }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className="or-chip shrink-0"
            data-active={tab === id}
            onClick={() => setTab(id)}
            data-testid={`realm-tab-${id}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <div>
          {/* Pinned post */}
          <div className="or-surface p-4 mb-4" data-testid="realm-pinned" style={{ outline: `1px solid ${realm.accent}` }}>
            <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-widest" style={{ color: realm.accent }}>
              <Pin size={12} /> Pinned by moderator
            </div>
            <div className="flex items-center gap-3 mb-2">
              <img src={moderators[0].avatar} alt="" className="rounded-full" style={{ width: 36, height: 36 }} />
              <div>
                <div className="font-semibold" style={{ color: "var(--text-main)" }}>@{moderators[0].name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>Welcome to {realm.name} — read the rules below.</div>
              </div>
            </div>
          </div>

          {/* Feed list */}
          {tab === "feed" && posts.slice(0, 8).map((p) => (
            <article key={p.id} className="or-surface p-4 mb-3" data-testid={`realm-feed-${p.id}`}>
              <div className="flex items-center gap-3 mb-2">
                <img src={p.author_avatar} alt="" className="rounded-full" style={{ width: 36, height: 36 }} />
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>@{p.author_name}</div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{p.media_type}</div>
                </div>
              </div>
              {p.content && <p className="text-sm" style={{ color: "var(--text-main)" }}>{p.content}</p>}
              {p.media_url && p.media_type !== "post" && p.media_type !== "thought" && (
                <img src={p.media_url} alt="" className="w-full h-56 object-cover mt-2" style={{ borderRadius: "calc(var(--radius) - 4px)" }} />
              )}
            </article>
          ))}

          {tab === "lives" && (
            <div className="grid sm:grid-cols-2 gap-3">
              {posts.filter((p) => p.media_type === "live").slice(0, 6).map((p) => (
                <div key={p.id} className="or-surface overflow-hidden">
                  <div className="relative h-40"><img src={p.media_url} alt="" className="w-full h-full object-cover" /><span className="absolute top-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#FF3F5A", color: "#fff" }}>● LIVE</span></div>
                  <div className="p-3 text-sm font-semibold" style={{ color: "var(--text-main)" }}>@{p.author_name}</div>
                </div>
              ))}
            </div>
          )}
          {(tab === "videos" || tab === "photos") && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {posts.slice(0, 9).map((p) => (
                <img key={p.id} src={p.media_url} alt="" className="aspect-square w-full object-cover" style={{ borderRadius: "calc(var(--radius) - 4px)" }} />
              ))}
            </div>
          )}
          {tab === "sounds" && (
            <div className="space-y-2">
              {posts.slice(0, 6).map((p, i) => (
                <div key={p.id} className="or-surface p-3 flex items-center gap-3">
                  <Music2 size={18} style={{ color: realm.accent }} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>Track {i + 1}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>@{p.author_name}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "events" && (
            <div className="space-y-2">
              {["Realm Meetup","Live Q&A","Block Party","Studio Tour"].map((n, i) => (
                <div key={n} className="or-surface p-3 flex items-center gap-3">
                  <Calendar size={18} style={{ color: realm.accent }} />
                  <div className="flex-1">
                    <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{n}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Next {["Sat","Sun","Tue","Fri"][i]} · {7 + i} PM</div>
                  </div>
                  <button className="or-btn" style={{ padding: "0.35rem 0.7rem", fontSize: "0.75rem" }}>RSVP</button>
                </div>
              ))}
            </div>
          )}
          {tab === "members" && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {members.map((m) => (
                <div key={m.id} className="or-surface p-3 flex items-center gap-3">
                  <img src={m.avatar} alt="" className="rounded-full" style={{ width: 40, height: 40 }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>@{m.name}</div>
                    <div className="text-xs" style={{ color: m.ringColor }}>{m.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar widgets */}
        <aside className="space-y-3" data-testid="realm-widgets">
          <div className="or-surface p-4">
            <h4 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: realm.accent }}>
              <Shield size={14} /> Moderators
            </h4>
            <div className="space-y-2">
              {moderators.map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <img src={m.avatar} alt="" className="rounded-full" style={{ width: 28, height: 28 }} />
                  <div className="text-sm" style={{ color: "var(--text-main)" }}>@{m.name}</div>
                  <Crown size={12} style={{ marginLeft: "auto", color: "#F4C84A" }} />
                </div>
              ))}
            </div>
          </div>
          <div className="or-surface p-4">
            <h4 className="text-sm font-bold mb-3" style={{ color: realm.accent }}>Realm Rules</h4>
            <ol className="text-xs space-y-1.5" style={{ color: "var(--text-muted)" }}>
              <li>1. Respect every member.</li>
              <li>2. Original content preferred.</li>
              <li>3. No spam or self-promo without context.</li>
              <li>4. Mods have final say.</li>
            </ol>
          </div>
          <div className="or-surface p-4">
            <h4 className="text-sm font-bold mb-3" style={{ color: realm.accent }}>Active right now</h4>
            <div className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>{realm.online}</div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>online of {realm.members.toLocaleString()} members</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
