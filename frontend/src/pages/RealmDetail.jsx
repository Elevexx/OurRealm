/**
 * /realms/:id — Realm page rebuilt around a real community chat (Phase 1).
 *
 *   • Banner with founder-only banner editor (unchanged from prior pass).
 *   • Tab strip — defaults to "Chat" which now renders a real-time
 *     community chat widget + a live members panel on the right.
 *   • Other tabs (feed/lives/videos/photos/sounds/events/members) keep
 *     their existing mock visuals so nothing regresses.
 *   • "Customize Community" button visible to realm owner/admins (and
 *     @stealth) — opens the chat title/description/welcome modal.
 *   • Member click → MemberActionSheet (Chat / Request Friend).
 *
 * Data flow:
 *   GET /api/communities/realms/:id             — live realm doc
 *   GET /api/communities/realm/:id/chats        — main chat row
 *   POST /api/communities/realm/:id/join        — join button
 *   PATCH /communities/realm/:id/chats/:cid     — admin rename
 *   WS /api/ws/community-chat/:cid              — realtime messages
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Users, Radio, Image as ImageIcon, Music2, MessageSquare, Calendar,
  Crown, Plus, Settings, Pin, ArrowLeft, Shield, Sparkles,
} from "lucide-react";
import apiClient from "@/api/client";
import { REALMS as MOCK_REALMS, CHARACTERS, makeMockPosts } from "@/data/mockData";
import BannerEditor, { BannerView } from "@/components/BannerEditor";
import CommunityChat from "@/components/CommunityChat";
import CommunityMembersPanel from "@/components/CommunityMembersPanel";
import CommunityChatTitleModal from "@/components/CommunityChatTitleModal";
import MemberActionSheet from "@/components/MemberActionSheet";
import { useMessagingPopups } from "@/contexts/MessagingPopupContext";
import RealmPollWidget from "@/components/RealmPollWidget";
import CommunityHubWidget from "@/components/CommunityHubWidget";
import RealmWidgetGrid from "@/components/RealmWidgetGrid";
import { useAuth } from "@/contexts/AuthContext";
import useHeartbeat from "@/hooks/useHeartbeat";

const BANNER_KEY = (id) => `ourrealm.realm_banner.${id}`;

const TABS = [
  { id: "chat",    label: "Chat",    Icon: MessageSquare },
  { id: "feed",    label: "Feed",    Icon: Sparkles },
  { id: "lives",   label: "Lives",   Icon: Radio },
  { id: "videos",  label: "Videos",  Icon: ImageIcon },
  { id: "photos",  label: "Photos",  Icon: ImageIcon },
  { id: "sounds",  label: "Sounds",  Icon: Music2 },
  { id: "events",  label: "Events",  Icon: Calendar },
  { id: "members", label: "Members", Icon: Users },
];

export default function RealmDetail() {
  useHeartbeat("realm");
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openDM } = useMessagingPopups();
  // Mock realm row used as a visual fallback while the live one loads.
  const fallback = MOCK_REALMS.find((r) => r.id === id) || null;

  const [realm, setRealm] = useState(fallback ? { ...fallback, description: fallback.desc } : null);
  const [chat, setChat] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [tab, setTab] = useState("chat");
  const [joined, setJoined] = useState(false);
  const [memberSheet, setMemberSheet] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const posts = useMemo(() => makeMockPosts(18), []);

  // Banner state (localStorage; same as previous pass).
  const [banner, setBanner] = useState(() => {
    try { return JSON.parse(localStorage.getItem(BANNER_KEY(id)) || "null"); } catch { return null; }
  });
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  // Phase 2 — widget edit mode. When false, the grid is read-only
  // (no resize/drag handles). Admin-only toggle in the toolbar.
  const [editMode, setEditMode] = useState(false);

  // Load live realm + main chat + widget list (Phase 2).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: r }, { data: c }, { data: w }] = await Promise.all([
          apiClient.get(`/communities/realms/${id}`),
          apiClient.get(`/communities/realm/${id}/chats`),
          apiClient.get(`/communities/realm/${id}/widgets`).catch(() => ({ data: { widgets: [] } })),
        ]);
        if (cancelled) return;
        setRealm(r);
        const main = (c?.chats || []).find((x) => x.is_main) || (c?.chats || [])[0] || null;
        setChat(main);
        setWidgets(w?.widgets || []);
      } catch { /* fall back to mock */ }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Refresh widgets on `widget:layout_changed` (broadcast by backend).
  useEffect(() => {
    const handler = async (e) => {
      const det = e.detail;
      if (!det || det.type !== "widget:layout_changed" || det.realm_id !== realm?.id) return;
      try {
        const { data } = await apiClient.get(`/communities/realm/${realm.id}/widgets`);
        setWidgets(data?.widgets || []);
      } catch { /* */ }
    };
    // Piggy-back on the CommunityChat WS — every layout change dispatches
    // a `community-chat:updated` window event whose `type` is the WS one.
    const wrap = (e) => handler({ detail: e.detail });
    window.addEventListener("community-chat:updated", wrap);
    return () => window.removeEventListener("community-chat:updated", wrap);
  }, [realm?.id]);

  // Refresh banner from localStorage on id change.
  useEffect(() => {
    try { setBanner(JSON.parse(localStorage.getItem(BANNER_KEY(id)) || "null")); }
    catch { setBanner(null); }
  }, [id]);

  // Listen for live chat:updated broadcasts.
  useEffect(() => {
    const handler = (e) => {
      const det = e.detail;
      if (!det || det.chat_id !== chat?.id) return;
      setChat((prev) => prev ? { ...prev, ...det.patch } : prev);
    };
    window.addEventListener("community-chat:updated", handler);
    return () => window.removeEventListener("community-chat:updated", handler);
  }, [chat?.id]);

  // Permissions: admin if owner / admin / global founder.
  const isAdmin = !!user && (
    (user.username || "").toLowerCase() === "stealth" ||
    realm?.owner_id === user.id ||
    (realm?.admin_ids || []).includes(user.id)
  );
  const canEditBanner = isAdmin;

  const saveBanner = (next) => {
    setBanner(next);
    try { localStorage.setItem(BANNER_KEY(id), JSON.stringify(next)); } catch { /* */ }
  };
  const clearBanner = () => {
    setBanner(null);
    try { localStorage.removeItem(BANNER_KEY(id)); } catch { /* */ }
  };

  const onJoin = async () => {
    if (!realm) return;
    if (joined) return;
    try {
      await apiClient.post(`/communities/realm/${realm.id}/join`);
      setJoined(true);
    } catch { /* */ }
  };

  if (!realm) {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="realm-not-found">
        <div className="text-lg mb-3">Realm not found</div>
        <button className="or-btn" onClick={() => navigate("/realms")}>← Back to Realms</button>
      </div>
    );
  }

  const accent = realm.accent || "#10E670";
  const onlineCount = realm.online_count ?? realm.online ?? 0;
  const memberCount = realm.member_count ?? realm.members ?? 0;
  const moderators = CHARACTERS.slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto" data-testid={`realm-detail-${realm.id}`}>
      {/* Banner */}
      <div className="or-surface overflow-hidden mb-5" data-testid="realm-banner">
        <div className="relative h-48 sm:h-64">
          {banner?.banner_url ? (
            <BannerView
              url={banner.banner_url}
              offsetY={banner.banner_offset_y ?? 50}
              scale={banner.banner_scale ?? 1}
              className="w-full h-full"
              testid="realm-banner-custom"
            />
          ) : (
            <img src={realm.banner} alt="" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 20%, ${accent}22 60%, rgba(0,0,0,0.7))`, pointerEvents: "none" }} />
          <button className="absolute top-3 left-3 starbar-icon" style={{ width: 36, height: 36, zIndex: 2 }} onClick={() => navigate("/realms")} data-testid="realm-back">
            <ArrowLeft size={16} />
          </button>
          {canEditBanner && (
            <button
              className="absolute top-3 right-3 or-chip"
              onClick={() => setBannerEditorOpen(true)}
              data-testid="realm-banner-edit"
              style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", zIndex: 2, touchAction: "manipulation" }}
            >
              <ImageIcon size={12} /> {banner?.banner_url ? "Change banner" : "Add banner"}
            </button>
          )}
          <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <div className="text-4xl mb-2">{realm.emoji}</div>
              <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)", color: "#fff", textShadow: `0 0 18px ${accent}` }}>{realm.name}</h1>
              <div className="text-sm mt-1 flex items-center gap-3" style={{ color: "#cfe3ff" }}>
                <span data-testid="realm-header-members"><Users size={12} className="inline" /> {Number(memberCount || 0).toLocaleString()}</span>
                {onlineCount > 0 && (
                  <span data-testid="realm-header-online" style={{ color: "#10E670" }}>● {onlineCount} online</span>
                )}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {isAdmin && (
                <button
                  className="or-chip"
                  style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
                  onClick={() => setRenameOpen(true)}
                  data-testid="realm-customize"
                ><Settings size={12} /> Customize Community</button>
              )}
              <button
                className={joined ? "or-btn or-btn-ghost" : "or-btn"}
                style={{ padding: "0.5rem 1rem" }}
                onClick={onJoin}
                data-testid="realm-join"
              >
                {joined ? "Joined" : <><Plus size={14} /> Join Realm</>}
              </button>
            </div>
          </div>
        </div>
        <div className="p-4 flex flex-wrap gap-2 items-center" style={{ borderTop: "1px solid var(--border-col)" }}>
          <p className="flex-1 text-sm" style={{ color: "var(--text-muted)" }}>{realm.description || realm.desc}</p>
          {(realm.tags || []).map((t) => (
            <span key={t} className="text-[10px] uppercase tracking-widest px-2 py-1 rounded" style={{ background: `${accent}22`, color: accent }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
        {TABS.map(({ id: tid, label, Icon }) => (
          <button
            key={tid}
            className="or-chip shrink-0"
            data-active={tab === tid}
            onClick={() => setTab(tid)}
            data-testid={`realm-tab-${tid}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* CHAT TAB — primary view */}
      {tab === "chat" && (
        <>
          <div className="grid lg:grid-cols-[1fr_300px] gap-4" data-testid="realm-chat-layout">
            <CommunityChat
              chat={chat}
              isAdmin={isAdmin}
              onRenameRequested={() => setRenameOpen(true)}
            />
            <CommunityMembersPanel
              communityType="realm"
              communityId={realm.id}
              onMemberClick={(m) => setMemberSheet(m)}
            />
          </div>
          {/* Phase 2 — widget grid below the chat. Admins toggle Edit
              mode to reveal per-widget size controls + drag handles;
              members and admins out of edit mode see a clean grid.
              Default Poll widget is auto-created for every realm. */}
          {isAdmin && (
            <div className="mt-5 flex items-center gap-2 flex-wrap" data-testid="realm-widgets-toolbar">
              <button
                className="or-chip"
                data-active={editMode}
                data-testid="realm-widgets-edit-toggle"
                onClick={() => setEditMode((v) => !v)}
                aria-pressed={editMode}
                style={{ touchAction: "manipulation" }}
              >
                {editMode ? "Done" : "Edit widgets"}
              </button>
              {editMode && (
                <>
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Add:</span>
                  {[
                    { type: "hub",           label: "Community Hub" },
                    { type: "poll",          label: "Poll" },
                    { type: "announcements", label: "Announcement" },
                    { type: "rules",         label: "Rules" },
                  ].map((opt) => (
                    <button
                      key={opt.type}
                      className="or-chip"
                      data-testid={`realm-widget-add-${opt.type}`}
                      onClick={async () => {
                        try {
                          const { data } = await apiClient.post(
                            `/communities/realm/${realm.id}/widgets`,
                            { type: opt.type, size: "medium" },
                          );
                          setWidgets((prev) => [...prev, data]);
                        } catch { /* */ }
                      }}
                    >
                      <Plus size={11} /> {opt.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {widgets.length > 0 && (
            <RealmWidgetGrid
              realmId={realm.id}
              widgets={widgets}
              isAdmin={isAdmin}
              editMode={editMode}
              onChanged={(updated) => setWidgets((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
              renderWidget={(w) => {
                if (w.type === "poll") {
                  return (
                    <RealmPollWidget
                      realmId={realm.id}
                      widget={w}
                      isAdmin={isAdmin}
                      onChanged={(updated) => setWidgets((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
                      onDelete={async (wid) => {
                        try {
                          await apiClient.delete(`/communities/realm/${realm.id}/widgets/${wid}`);
                          setWidgets((prev) => prev.filter((x) => x.id !== wid));
                        } catch { /* */ }
                      }}
                    />
                  );
                }
                if (w.type === "hub") {
                  return (
                    <CommunityHubWidget
                      realmId={realm.id}
                      widget={w}
                      isAdmin={isAdmin}
                      onDelete={async (wid) => {
                        try {
                          await apiClient.delete(`/communities/realm/${realm.id}/widgets/${wid}`);
                          setWidgets((prev) => prev.filter((x) => x.id !== wid));
                        } catch { /* */ }
                      }}
                    />
                  );
                }
                return (
                  <section className="or-surface p-4 h-full" data-testid={`realm-widget-${w.type}-${w.id}`}>
                    <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-muted)" }}>{w.type}</div>
                    <div className="text-sm" style={{ color: "var(--text-main)" }}>
                      {w.config?.announcement || w.config?.title || JSON.stringify(w.config || {}).slice(0, 120)}
                    </div>
                  </section>
                );
              }}
            />
          )}
        </>
      )}

      {/* Other tabs preserve their existing mock visuals. */}
      {tab !== "chat" && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          <div>
            <div className="or-surface p-4 mb-4" data-testid="realm-pinned" style={{ outline: `1px solid ${accent}` }}>
              <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-widest" style={{ color: accent }}>
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
                    <Music2 size={18} style={{ color: accent }} />
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
                {["Realm Meetup", "Live Q&A", "Block Party", "Studio Tour"].map((n, i) => (
                  <div key={n} className="or-surface p-3 flex items-center gap-3">
                    <Calendar size={18} style={{ color: accent }} />
                    <div className="flex-1">
                      <div className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{n}</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>Next {["Sat", "Sun", "Tue", "Fri"][i]} · {7 + i} PM</div>
                    </div>
                    <button className="or-btn" style={{ padding: "0.35rem 0.7rem", fontSize: "0.75rem" }}>RSVP</button>
                  </div>
                ))}
              </div>
            )}
            {tab === "members" && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {CHARACTERS.map((m) => (
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

          <aside className="space-y-3" data-testid="realm-widgets">
            <div className="or-surface p-4">
              <h4 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: accent }}>
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
              <h4 className="text-sm font-bold mb-3" style={{ color: accent }}>Realm Rules</h4>
              <ol className="text-xs space-y-1.5" style={{ color: "var(--text-muted)" }}>
                <li>1. Respect every member.</li>
                <li>2. Original content preferred.</li>
                <li>3. No spam or self-promo without context.</li>
                <li>4. Mods have final say.</li>
              </ol>
            </div>
            <div className="or-surface p-4">
              <h4 className="text-sm font-bold mb-3" style={{ color: accent }}>Active right now</h4>
              <div className="text-2xl font-bold" style={{ color: "var(--text-main)" }}>{onlineCount}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>online of {Number(memberCount || 0).toLocaleString()} members</div>
            </div>
          </aside>
        </div>
      )}

      {/* Modals & floating overlays */}
      <BannerEditor
        open={bannerEditorOpen}
        onClose={() => setBannerEditorOpen(false)}
        initial={{
          banner_url: banner?.banner_url || "",
          banner_offset_y: banner?.banner_offset_y ?? 50,
          banner_scale: banner?.banner_scale ?? 1,
        }}
        onSave={(next) => { saveBanner(next); setBannerEditorOpen(false); }}
        onRemove={() => { clearBanner(); setBannerEditorOpen(false); }}
        testid="realm-banner-editor"
      />
      <CommunityChatTitleModal
        open={renameOpen}
        chat={chat}
        communityType="realm"
        communityId={realm.id}
        onClose={() => setRenameOpen(false)}
        onSaved={(c) => setChat(c)}
      />
      {memberSheet && (
        <MemberActionSheet
          member={memberSheet}
          onClose={() => setMemberSheet(null)}
          onOpenChat={(m) => openDM(m)}
        />
      )}
    </div>
  );
}
