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
  Crown, Plus, Settings, Pin, ArrowLeft, Shield, Sparkles, Edit3,
} from "lucide-react";
import apiClient from "@/api/client";
import RegistryWidgetPicker from "@/components/RegistryWidgetPicker";
import BannerEditor, { BannerView } from "@/components/BannerEditor";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import CommunityChat from "@/components/CommunityChat";
import CommunityMembersPanel from "@/components/CommunityMembersPanel";
import CommunityChatTitleModal from "@/components/CommunityChatTitleModal";
import MemberActionSheet from "@/components/MemberActionSheet";
import { useMessagingPopups } from "@/contexts/MessagingPopupContext";
import RealmPollWidget from "@/components/RealmPollWidget";
import CommunityHubWidget from "@/components/CommunityHubWidget";
import CustomWidgetRenderer from "@/components/widgets/CustomWidgetRenderer";
import RealmWidgetGrid from "@/components/RealmWidgetGrid";
import EditRealmModal from "@/components/EditRealmModal";
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

  const [realm, setRealm] = useState(null);
  const [realmLoading, setRealmLoading] = useState(true);
  const [chat, setChat] = useState(null);
  const [widgets, setWidgets] = useState([]);
  const [tab, setTab] = useState("chat");
  const [joined, setJoined] = useState(false);
  const [memberSheet, setMemberSheet] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Real realm members (June 2026 audit — mock characters removed).
  const [members, setMembers] = useState([]);

  // Load real members whenever the realm resolves (powers the Members
  // tab + real moderator list).
  useEffect(() => {
    if (!realm?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/communities/realm/${realm.id}/members`, { params: { limit: 60 } });
        if (!cancelled) setMembers(data?.members || data?.rows || []);
      } catch { if (!cancelled) setMembers([]); }
    })();
    return () => { cancelled = true; };
  }, [realm?.id]);

  // Banner state (localStorage; same as previous pass).
  const [banner, setBanner] = useState(() => {
    try { return JSON.parse(localStorage.getItem(BANNER_KEY(id)) || "null"); } catch { return null; }
  });
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [editRealmOpen, setEditRealmOpen]       = useState(false);
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

  // Spec (Feb 20, 2026): clear the aggregated realm-activity
  // notification for this user when they OPEN the realm. Fires
  // whenever the realm id changes (i.e. the user opens a new realm)
  // and once on the initial mount. Best-effort; never blocks the
  // page render if the endpoint is unreachable.
  useEffect(() => {
    if (!realm?.id) return;
    apiClient.post(`/realm-notifications/${realm.id}/clear`).catch(() => {});
    // When the user leaves the page or switches realms, the next
    // realm's mount will clear its own row; no other cleanup needed.
  }, [realm?.id]);

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

  // Persist the banner URL to the backend so the /realms Discover card
  // can render it too — localStorage only ever lived in the uploader's
  // browser, which is why Discover stayed gradient-only before this
  // patch. Offset/scale remain a per-viewer preview tweak in
  // localStorage; the backend just needs the URL itself.
  const persistBannerToRealm = async (url) => {
    if (!realm?.id) return;
    try {
      const { data } = await apiClient.patch(`/communities/realms/${realm.id}`, {
        banner: url || null,
      });
      // Use the refreshed realm doc so `updated_at` (used for `?v=` cache
      // busting on the Discover card) is current.
      if (data) setRealm(data);
    } catch (_e) { /* swallow — banner UI already updated locally */ }
  };

  const saveBanner = (next) => {
    setBanner(next);
    try { localStorage.setItem(BANNER_KEY(id), JSON.stringify(next)); } catch { /* */ }
    if (next?.banner_url) void persistBannerToRealm(next.banner_url);
  };
  const clearBanner = () => {
    setBanner(null);
    try { localStorage.removeItem(BANNER_KEY(id)); } catch { /* */ }
    void persistBannerToRealm(null);
  };

  const onJoin = async () => {
    if (!realm) return;
    if (joined) return;
    try {
      const { data } = await apiClient.post(`/communities/realm/${realm.id}/join`);
      setJoined(true);
      // Optimistic count refresh — backend returns the live count so
      // we don't need a second round-trip to display it.
      if (typeof data?.member_count === "number") {
        setRealm((prev) => prev ? { ...prev, member_count: data.member_count } : prev);
      }
    } catch { /* */ }
  };

  if (!realm) {
    if (realmLoading) {
      return (
        <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="realm-loading" style={{ color: "var(--text-muted)" }}>
          Loading realm…
        </div>
      );
    }
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="realm-not-found">
        <div className="text-lg mb-3">Realm not found</div>
        <button className="or-btn" onClick={() => navigate("/realms")}>← Back to Realms</button>
      </div>
    );
  }

  const accent = realm.accent || "#10E670";
  const onlineCount = realm.online_count ?? 0;
  const memberCount = realm.member_count ?? 0;
  const moderators = members.filter((m) => ["owner", "admin", "moderator"].includes(m.role));

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
          ) : (realm.banner_url || realm.banner) ? (
            <img
              src={(() => {
                const resolved = resolveMediaUrl(realm.banner_url || realm.banner);
                const ver = realm.updated_at
                  ? `${resolved.includes("?") ? "&" : "?"}v=${encodeURIComponent(realm.updated_at)}`
                  : "";
                return `${resolved}${ver}`;
              })()}
              alt=""
              className="w-full h-full object-cover"
              data-testid="realm-banner-image"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ) : null}
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
              {isAdmin && (
                <button
                  className="or-chip"
                  style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
                  onClick={() => setEditRealmOpen(true)}
                  data-testid="realm-edit-open"
                ><Edit3 size={12} /> Edit Realm</button>
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
                <button
                  className="or-chip"
                  data-testid="realm-widget-open-picker"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus size={11} /> Add from Library
                </button>
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
              onDeleted={(wid) => setWidgets((prev) => prev.filter((x) => x.id !== wid))}
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
                    <CustomWidgetRenderer w={w} />
                  </section>
                );
              }}
            />
          )}
        </>
      )}

      {/* Non-chat tabs — real database content only (June 2026 audit). */}
      {tab !== "chat" && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-5">
          <div>
            {["feed", "lives", "videos", "photos", "sounds"].includes(tab) && (
              <div className="or-surface p-8 text-center" data-testid={`realm-${tab}-empty`}>
                <div className="text-2xl mb-2">✨</div>
                <div className="font-semibold mb-1" style={{ color: "var(--text-main)" }}>
                  No {tab === "feed" ? "posts" : tab} in {realm.name} yet
                </div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Content shared by members will appear here.
                </div>
              </div>
            )}
            {tab === "events" && (
              <div className="or-surface p-8 text-center" data-testid="realm-events-empty">
                <Calendar size={22} className="mx-auto mb-2" style={{ color: accent }} />
                <div className="font-semibold mb-1" style={{ color: "var(--text-main)" }}>No events scheduled yet</div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Realm events will show up here once they're created.
                </div>
              </div>
            )}
            {tab === "members" && (
              members.length === 0 ? (
                <div className="or-surface p-8 text-center" data-testid="realm-members-empty">
                  <Users size={22} className="mx-auto mb-2" style={{ color: accent }} />
                  <div className="font-semibold mb-1" style={{ color: "var(--text-main)" }}>No members yet</div>
                  <div className="text-sm" style={{ color: "var(--text-muted)" }}>Be the first to join this realm.</div>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="realm-members-grid">
                  {members.map((m) => (
                    <button
                      key={m.user_id}
                      className="or-surface p-3 flex items-center gap-3 text-left"
                      onClick={() => m.username && navigate(`/profile/${m.username}`)}
                      data-testid={`realm-member-${m.username || m.user_id}`}
                    >
                      {m.avatar_url ? (
                        <img src={resolveMediaUrl(m.avatar_url)} alt="" className="rounded-full object-cover" style={{ width: 40, height: 40 }}
                             onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <div className="rounded-full flex items-center justify-center font-bold" style={{ width: 40, height: 40, background: "var(--surface-2)", color: accent }}>
                          {(m.username || "?")[0].toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>@{m.username || "member"}</div>
                        <div className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>{m.role || "member"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          <aside className="space-y-3" data-testid="realm-widgets">
            {moderators.length > 0 && (
              <div className="or-surface p-4">
                <h4 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: accent }}>
                  <Shield size={14} /> Moderators
                </h4>
                <div className="space-y-2">
                  {moderators.map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2">
                      {m.avatar_url ? (
                        <img src={resolveMediaUrl(m.avatar_url)} alt="" className="rounded-full object-cover" style={{ width: 28, height: 28 }} />
                      ) : (
                        <div className="rounded-full flex items-center justify-center text-xs font-bold" style={{ width: 28, height: 28, background: "var(--surface-2)", color: accent }}>
                          {(m.username || "?")[0].toUpperCase()}
                        </div>
                      )}
                      <div className="text-sm" style={{ color: "var(--text-main)" }}>@{m.username}</div>
                      <Crown size={12} style={{ marginLeft: "auto", color: "#F4C84A" }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
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
      {editRealmOpen && (
        <EditRealmModal
          realm={realm}
          onClose={() => setEditRealmOpen(false)}
          onSaved={(updated) => {
            // Merge server response into local realm state so UI
            // reflects the new name / accent / banner / privacy
            // without a full reload.
            setRealm((prev) => ({ ...(prev || {}), ...updated }));
            setEditRealmOpen(false);
          }}
          onDeleted={() => {
            // Navigate back to the realms list. The deleted realm
            // will not appear in subsequent fetches.
            setEditRealmOpen(false);
            navigate("/realms", { replace: true });
          }}
        />
      )}
      <RegistryWidgetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        viewer={user}
        placement="realm"
        onPickMany={async (items) => {
          setPickerOpen(false);
          // Add each picked widget to the realm sequentially so we
          // preserve ordering and surface backend errors cleanly.
          for (const item of items) {
            try {
              const { data } = await apiClient.post(
                `/communities/realm/${realm.id}/widgets`,
                { type: item.id, size: item.default_size || "medium" },
              );
              setWidgets((prev) => [...prev, data]);
            } catch (e) {
              console.error("realm widget add failed", item.id, e);
            }
          }
        }}
      />
    </div>
  );
}
