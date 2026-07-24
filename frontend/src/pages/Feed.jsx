import React, { useEffect, useMemo, useState } from "react";
import useHeartbeat from "@/hooks/useHeartbeat";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, Share2, Bookmark, Sliders, Sparkles, Globe2, Users as UsersIcon, Lock, UserCheck, MessageSquare, Image as ImageIcon, Video, Link2, BarChart3, Music2 } from "lucide-react";
import ReactionAttachment from "@/components/ReactionAttachment";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import MediaTypeBar from "@/components/MediaTypeBar";
import AudiencePicker from "@/components/AudiencePicker";
import UsernameLink from "@/components/UsernameLink";
import { openPostPopup } from "@/lib/postPopupController";
import { usePostState, setPost } from "@/lib/postStore";
import ImageUploadPicker, { absoluteImageUrl } from "@/components/ImageUploadPicker";
import AlbumPicker from "@/components/composer/AlbumPicker";
import HashtagInput, { appendHashtags } from "@/components/composer/HashtagInput";
import SoundUploadPicker from "@/components/SoundUploadPicker";
import SoundPlayerCard from "@/components/SoundPlayerCard";
import UserAvatar from "@/components/UserAvatar";
import HashtagText from "@/components/HashtagText";
import TrendingHashtags from "@/components/TrendingHashtags";
import ZipRequiredModal from "@/components/ZipRequiredModal";
import PollComposer from "@/components/PollComposer";
import PollDisplay from "@/components/PollDisplay";
import AutoplayVideo from "@/components/AutoplayVideo";
import VideoEmbed from "@/components/VideoEmbed";
import ShareToUserModal from "@/components/ShareToUserModal";
import ImageLightbox from "@/components/ImageLightbox";
import VideoUploadPicker from "@/components/VideoUploadPicker";
import PostManagementMenu from "@/components/PostManagementMenu";
import ReportButton from "@/components/ReportButton";
import FireButton from "@/components/fire/FireButton";
import { useFireStatus } from "@/lib/fireApi";
import { getPostCharacterLimit } from "@/lib/postLimits";

const FILTER_KEY = "ourrealm.feedMedia";
const INTEREST_KEY = "ourrealm.interests";
const RADIUS_KEY = "ourrealm.feedRadius";
const FIRE_WINDOW_OPTIONS = [
  { id: "1h", label: "1h" }, { id: "12h", label: "12h" }, { id: "24h", label: "24h" },
  { id: "1w", label: "1w" }, { id: "1m", label: "1mo" }, { id: "all", label: "All" },
];
const RADIUS_OPTIONS = [
  { id: "any", label: "Any" },
  { id: "10",  label: "10 mi" },
  { id: "20",  label: "20 mi" },
  { id: "50",  label: "50 mi" },
  { id: "100", label: "100 mi" },
  { id: "250", label: "250 mi" },
  { id: "500", label: "500 mi" },
];

function timeAgo(iso) {
  const d = new Date(iso); const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function Feed() {
  useHeartbeat("feed");
  const { user } = useAuth();
  const navigate = useNavigate();
  const fireStatus = useFireStatus(user?.id);
  const [fireSort, setFireSort] = useState(false);
  const [fireWindow, setFireWindow] = useState("24h");
  const charLimit = getPostCharacterLimit(user);
  const [media, setMedia] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "[]"); } catch { return []; }
  });
  // BUG FIX: load saved interests so the feed actually filters by them
  const [interests, setInterests] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(INTEREST_KEY) || "[]")); } catch { return new Set(); }
  });
  // When user data loads, prefer server-persisted interests
  useEffect(() => {
    if (user?.interests?.length) {
      const set = new Set(user.interests);
      setInterests(set);
      try { localStorage.setItem(INTEREST_KEY, JSON.stringify([...set])); } catch { /* */ }
    }
  }, [user]);

  const [serverPosts, setServerPosts] = useState([]);
  const [composeText, setComposeText] = useState("");
  const [composeMediaType, setComposeMediaType] = useState("thought"); // thought | image | video | link
  const [composeMediaUrl, setComposeMediaUrl] = useState("");
  const [composeAudience, setComposeAudience] = useState({ visibility: "public", user_ids: [] });
  const [composePoll, setComposePoll] = useState(null);   // Phase 4B
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  // Multi-image album (up to 6) — shared AlbumPicker, same as the "+" composer.
  const [composeImages, setComposeImages] = useState([]);
  const [composeTags, setComposeTags] = useState([]);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  // Sound attachment — populated by SoundUploadPicker (the same picker
  // used on the Sounds page) when the user picks "Sound" in the composer.
  const [composeSound, setComposeSound] = useState(null);
  // Phase-2 — Radius filter ("any" | "10" | "20" | "50" | "100" | "250" | "500").
  const [radius, setRadius] = useState(() => {
    try { return localStorage.getItem(RADIUS_KEY) || "any"; } catch { return "any"; }
  });
  const [zipRequiredOpen, setZipRequiredOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem(RADIUS_KEY, radius); } catch { /* ignore */ } }, [radius]);
  const [posting, setPosting] = useState(false);
  // VIP tooltip peek — toggled on tap (mobile) or always-visible at ≥260 chars (desktop).
  const [vipPeek, setVipPeek] = useState(false);
  useEffect(() => {
    if (!vipPeek) return;
    const t = setTimeout(() => setVipPeek(false), 3500);
    return () => clearTimeout(t);
  }, [vipPeek]);
  useEffect(() => {
    // Reset the mobile peek whenever the user drops back below the threshold
    // (so it can re-trigger next time they approach the cap).
    if (composeText.length < 260) setVipPeek(false);
  }, [composeText.length]);

  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(media)); } catch { /* ignore */ } }, [media]);

  const loadPosts = async () => {
    try {
      // Radius queries require a stored ZIP code on the viewer. When the
      // viewer hasn't set one we either fall back to "any" silently or, if
      // they explicitly chose a radius, gate the action via the modal.
      const params = {};
      // Always pass viewer so backend can mark poll votes for the current user.
      if (user?.username) params.viewer = user.username;
      // Pass the active media filter so the backend can serve the right
      // surface. Critical for `media === ["sound"]` because the server
      // merges real `db.tracks` rows into the response only when the
      // filter is explicit — without this, the Sounds tab fell back to
      // the client-side mockPosts buffer (the "fake sound posts" bug).
      // `media` is an array (multi-select); we only pass it when there's
      // exactly one selection, since the backend accepts a single string.
      if (Array.isArray(media) && media.length === 1) {
        params.media_type = media[0];
      }
      if (fireSort && fireStatus?.ranked_feed_enabled) {
        params.sort = "fire";
        params.window = fireWindow;
      }
      if (radius && radius !== "any") {
        if (!user?.zip_code) {
          setRadius("any");
          setZipRequiredOpen(true);
          const { data } = await apiClient.get("/posts", { params });
          setServerPosts(data.posts || []);
          return;
        }
        params.radius = radius;
      }
      const { data } = await apiClient.get("/posts", { params });
      setServerPosts(data.posts || []);
    } catch { setServerPosts([]); }
  };
  useEffect(() => { loadPosts(); }, [radius, JSON.stringify(media), user?.zip_code, user?.username, fireSort, fireWindow, fireStatus?.ranked_feed_enabled]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Real database posts only (June 2026 audit — mock post padding removed).
  const allPosts = useMemo(() => {
    const seen = new Set();
    let filtered = serverPosts.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    // Media type filter. A post with an attached poll IS a poll — the
    // Polls filter shows only polls and Thoughts excludes them (backend
    // enforces the same rules; this covers multi-select client filtering).
    if (media.length > 0) {
      filtered = filtered.filter((p) => {
        const isPoll = !!p?.poll || p?.media_type === "poll";
        if (isPoll) return media.includes("poll");
        return media.includes(p.media_type);
      });
    }
    // Apply interest filter when at least one interest is selected so the
    // For You feed actually reflects the user's saved preferences.
    if (interests.size > 0) {
      filtered = filtered.filter((p) => {
        // Posts may not have tags; pass them through if untagged so the feed
        // isn't empty. When tags exist, require at least one match.
        if (!p.tags || p.tags.length === 0) return true;
        return p.tags.some((t) => interests.has(t));
      });
    }
    return filtered;
  }, [serverPosts, media, interests]);

  const submitPost = async () => {
    if (!user) return;
    // Allow media-only posts (the previous text-required guard broke video
    // uploads in production — backend now accepts empty text iff at least
    // one of content / media_url / image_url / video_url / link_url / poll
    // is present).
    const hasImages = composeImages.length > 0;
    const hasMedia = !!(composeMediaUrl) || hasImages;
    const hasSound = !!composeSound;
    if (!composeText.trim() && !composeTags.length && !composePoll && !hasMedia && !hasSound) return;
    if (composeText.length > charLimit) return;  // safety net; Share is already disabled
    setPosting(true);
    try {
      const content = appendHashtags(composeText.trim() || (composePoll?.question || ""), composeTags);
      const body = {
        content,
        media_type: hasImages ? "image" : (composeMediaType || "thought"),
        media_url: hasImages ? composeImages[0].url : (composeMediaUrl || null),
        image_url: hasImages ? composeImages[0].url : (composeMediaType === "image" ? (composeMediaUrl || null) : null),
        image_urls: hasImages ? composeImages.map((i) => i.url) : undefined,
        video_url: composeMediaType === "video" ? (composeMediaUrl || null) : null,
        link_url: composeMediaType === "link" ? (composeMediaUrl || null) : null,
        audience: composeAudience,
        poll: composePoll || undefined,
      };
      if (composeSound) {
        body.media_type = "sound";
        body.sound_track_id = composeSound.id;
        body.sound_url = composeSound.file_url;
        body.media_url = composeSound.file_url;
        body.sound_title = composeSound.title;
        body.sound_cover_url = composeSound.cover_url || null;
        body.sound_duration = composeSound.duration_seconds || null;
      }
      await apiClient.post("/posts", body);
      setComposeText("");
      setComposeMediaType("thought");
      setComposeMediaUrl("");
      setComposeImages([]);
      setComposeTags([]);
      setComposeAudience({ visibility: "public", user_ids: [] });
      setComposePoll(null);
      setComposeSound(null);
      await loadPosts();
    } catch (e) {
      // Surface the server's reason so users don't see a silently-closed
      // composer. The most common case here is the 400 "Post is empty"
      // guard or the 413 upload-too-large branch.
      // eslint-disable-next-line no-console
      console.error("[Feed] /posts failed", {
        status: e?.response?.status,
        detail: e?.response?.data?.detail,
        payload: { media_type: composeMediaType, has_url: !!composeMediaUrl },
      });
      const detail = e?.response?.data?.detail || "Could not publish post.";
      // eslint-disable-next-line no-alert
      alert(detail);
    } finally { setPosting(false); }
  };

  return (
    <div className="max-w-3xl mx-auto" data-testid="feed-page">
      <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Personalized stream</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
            For <span style={{ color: "var(--brand-green)" }}>You</span>
          </h1>
        </div>
        <button
          className="or-btn"
          onClick={() => navigate("/interests")}
          data-testid="feed-customize-feed"
          title="Re-select interests"
        >
          <Sliders size={14} /> Customize Feed
        </button>
      </div>

      {/* New order (Feb 20, 2026): Customize → Radius → Trending
          Hashtags → Media Type bar → Feed. Lets users pick their
          location radius, glance at trending tags, then filter by
          media type just before the feed renders. */}

      {/* Phase-2 — Radius filter chips. Filters server posts by author
          location within `radius` miles of the viewer's ZIP. Default Any. */}
      <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar" data-testid="feed-radius-bar">
        <span className="text-[11px] uppercase tracking-wider shrink-0" style={{ color: "var(--text-muted)" }}>Radius</span>
        {RADIUS_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="or-chip shrink-0"
            data-active={radius === id}
            onClick={() => {
              if (id !== "any" && !user?.zip_code) { setZipRequiredOpen(true); return; }
              setRadius(id);
            }}
            data-testid={`feed-radius-${id}`}
          >
            {label}
          </button>
        ))}
      </div>

      <TrendingHashtags />

      {/* Media type bar — sits between Trending Hashtags and the
          composer so users can refine the feed by content type after
          glancing at trends. Icon-only on mobile (handled inside the
          MediaTypeBar component itself). The For You page uses Polls
          as the 6th filter chip (Next arrow is reserved for Customize
          Feed / Home onboarding only). */}
      <MediaTypeBar value={media} onChange={setMedia} trailing="poll" />

      {/* Composer */}
      <div className="or-surface p-4 mt-4" data-testid="feed-composer">
        <div className="flex gap-3">
          <UserAvatar user={user} size={40} dotOutset={2} testid="feed-composer-avatar" />
          <div className="flex-1">
            <textarea
              data-testid="feed-composer-input"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder="What's happening in your Realm?"
              rows={2}
              className="or-input resize-none"
              style={{ background: "transparent" }}
            />
            {/* Media type chips — laid out as a 3×2 grid so the order is
                always: row1 Thought / Image / Poll, row2 Video / Sound / Link.
                Wraps cleanly on every screen width (3 columns at all sizes). */}
            <div className="grid grid-cols-3 gap-1.5 mt-2" data-testid="feed-composer-media-row">
              {[
                { id: "thought", label: "Thought", Icon: MessageSquare, kind: "media" },
                { id: "image",   label: "Image",   Icon: ImageIcon,     kind: "media" },
                { id: "poll",    label: "Poll",    Icon: BarChart3,     kind: "poll" },
                { id: "video",   label: "Video",   Icon: Video,         kind: "media" },
                { id: "sound",   label: "Sound",   Icon: Music2,        kind: "media" },
                { id: "link",    label: "Link",    Icon: Link2,         kind: "media" },
              ].map(({ id, label, Icon, kind }) => {
                const isPoll = kind === "poll";
                const active = isPoll
                  ? !!composePoll
                  : (composeMediaType === id || (id === "sound" && !!composeSound));
                return (
                  <button
                    key={id}
                    type="button"
                    className="or-chip justify-center"
                    data-active={active}
                    data-testid={isPoll ? "feed-composer-poll" : `feed-composer-type-${id}`}
                    title={isPoll ? (composePoll ? "Edit poll" : "Add poll") : undefined}
                    onClick={() => {
                      if (isPoll) {
                        setPollComposerOpen(true);
                        return;
                      }
                      if (id === "sound") {
                        setSoundPickerOpen(true);
                        return;
                      }
                      setComposeMediaType(id);
                      if (id === "thought") { setComposeMediaUrl(""); setComposeImages([]); }
                    }}
                  >
                    <Icon size={12} /> {isPoll ? (composePoll ? "Poll on" : label) : label}
                  </button>
                );
              })}
            </div>
            {/* Inline "remove" affordances live on their own row — they only
                appear when something is attached, so they never push the
                primary chip grid around. */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {composePoll && (
                <button
                  type="button"
                  className="or-chip"
                  onClick={() => setComposePoll(null)}
                  data-testid="feed-composer-poll-clear"
                  title="Remove poll"
                  style={{ color: "var(--text-muted)" }}
                >
                  Remove poll
                </button>
              )}
              {composeSound && (
                <button
                  type="button"
                  className="or-chip"
                  onClick={() => setComposeSound(null)}
                  data-testid="feed-composer-sound-clear"
                  title="Remove sound"
                  style={{ color: "var(--text-muted)" }}
                >
                  Remove sound
                </button>
              )}
            </div>
            {composeMediaType !== "thought" && composeMediaType !== "image" && (
              <input
                className="or-input mt-2 text-sm"
                placeholder={
                  composeMediaType === "video" ? "Paste a video URL (mp4/youtube/vimeo)" :
                  "Paste a link URL"
                }
                value={composeMediaUrl}
                onChange={(e) => setComposeMediaUrl(e.target.value)}
                data-testid="feed-composer-media-url"
              />
            )}
            {composeMediaType === "image" && (
              <div className="mt-2" data-testid="feed-composer-album">
                <AlbumPicker
                  images={composeImages}
                  onChange={setComposeImages}
                  accent="var(--primary)"
                  testidPrefix="feed-composer-image"
                />
              </div>
            )}
            {composeMediaType === "video" && composeMediaUrl && (
              <div className="mt-2 text-xs flex items-center gap-1.5" data-testid="feed-composer-preview-video" style={{ color: "var(--text-muted)" }}>
                <Video size={12} /> Video will render in feed
              </div>
            )}
            {composeMediaType === "video" && (
              <VideoUploadPicker
                videoUrl={composeMediaUrl}
                onChange={(url) => setComposeMediaUrl(url)}
                testid="feed-composer-video-upload"
              />
            )}
            {composeMediaType === "link" && composeMediaUrl && (
              <div className="mt-2 text-xs flex items-center gap-1.5" data-testid="feed-composer-preview-link" style={{ color: "var(--text-muted)" }}>
                <Link2 size={12} /> <span className="truncate">{composeMediaUrl}</span>
              </div>
            )}
            {composeSound && (
              <div className="mt-2 p-2 text-xs flex items-center gap-2"
                style={{
                  borderRadius: "calc(var(--radius) - 4px)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-col)",
                }}
                data-testid="feed-composer-sound-preview"
              >
                <Music2 size={14} style={{ color: "var(--primary)" }} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>{composeSound.title}</div>
                  <div className="truncate" style={{ color: "var(--text-muted)" }}>
                    {composeSound.category}{composeSound.genre ? ` · ${composeSound.genre}` : ""}{composeSound.duration_seconds ? ` · ${Math.round(composeSound.duration_seconds)}s` : ""}
                  </div>
                </div>
              </div>
            )}
            {composePoll && (
              <div className="mt-2 p-2 text-xs flex items-start gap-2"
                style={{
                  borderRadius: "calc(var(--radius) - 4px)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-col)",
                }}
                data-testid="feed-composer-poll-preview"
              >
                <BarChart3 size={12} style={{ color: "var(--primary)", marginTop: 2 }} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>{composePoll.question}</div>
                  <div className="truncate" style={{ color: "var(--text-muted)" }}>
                    {composePoll.options.map((o) => o.text).join(" · ")}
                    {composePoll.duration_hours ? ` · ${composePoll.duration_hours}h` : " · no expiry"}
                  </div>
                </div>
              </div>
            )}
            <HashtagInput tags={composeTags} onChange={setComposeTags} testidPrefix="feed-composer-hashtag" />
            <div className="flex items-center justify-between mt-2 gap-2">
              <button
                className="or-chip"
                onClick={() => setAudiencePickerOpen(true)}
                data-testid="feed-composer-audience"
                title="Who can see this post?"
              >
                {composeAudience.visibility === "public" && <><Globe2 size={12} /> Public</>}
                {composeAudience.visibility === "friends" && <><UsersIcon size={12} /> Friends</>}
                {composeAudience.visibility === "private" && <><Lock size={12} /> Private</>}
                {composeAudience.visibility === "custom" && <><UserCheck size={12} /> Custom ({composeAudience.user_ids?.length || 0})</>}
              </button>
              <div className="flex items-center gap-3 ml-auto relative">
                {/* VIP conversion nudge — only for standard 300-cap users approaching the limit. */}
                {charLimit === 300 && composeText.length >= 260 && (
                  <span
                    className="text-[11px] whitespace-nowrap px-2 py-1 hidden sm:inline-flex items-center gap-1"
                    data-testid="feed-composer-vip-tooltip"
                    role="tooltip"
                    style={{
                      borderRadius: "calc(var(--radius) - 6px)",
                      background: "color-mix(in srgb, var(--primary) 14%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--primary) 35%, transparent)",
                      color: "var(--text-main)",
                      pointerEvents: "none",
                    }}
                  >
                    👑 unlock 500-char posts with VIP
                  </span>
                )}
                <span
                  className="text-xs relative"
                  data-testid="feed-composer-charcount"
                  // Mobile tap-target: tap the counter to peek the tooltip briefly.
                  onClick={() => setVipPeek(true)}
                  style={{
                    color: composeText.length > charLimit
                      ? "#FF5C5C"
                      : composeText.length > charLimit - 30
                        ? "#FFB72E"
                        : "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                    cursor: charLimit === 300 && composeText.length >= 260 ? "help" : "default",
                  }}
                >
                  {composeText.length} / {charLimit}
                  {/* Mobile peek bubble — fades after a few seconds. */}
                  {charLimit === 300 && composeText.length >= 260 && vipPeek && (
                    <span
                      className="absolute right-0 text-[11px] whitespace-nowrap px-2 py-1 sm:hidden"
                      data-testid="feed-composer-vip-tooltip-mobile"
                      role="status"
                      aria-live="polite"
                      style={{
                        top: "calc(100% + 4px)",
                        borderRadius: "calc(var(--radius) - 6px)",
                        background: "color-mix(in srgb, var(--primary) 18%, var(--surface))",
                        border: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
                        color: "var(--text-main)",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
                        zIndex: 5,
                      }}
                    >
                      👑 unlock 500-char posts with VIP
                    </span>
                  )}
                </span>
                <button
                  data-testid="feed-composer-submit"
                  className="or-btn"
                  disabled={posting || composeText.length > charLimit}
                  onClick={submitPost}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                >
                  {posting ? "Posting…" : "Share"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {fireStatus?.ranked_feed_enabled && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="feed-fire-rank-bar">
            <button
              className="or-chip"
              data-active={!fireSort}
              onClick={() => setFireSort(false)}
              data-testid="feed-sort-latest"
            >
              Latest
            </button>
            <button
              className="or-chip"
              data-active={fireSort}
              onClick={() => setFireSort(true)}
              data-testid="feed-sort-fire"
              style={fireSort ? { color: "#FF7A1A", borderColor: "#FF7A1A" } : undefined}
            >
              🔥 Top Fire
            </button>
            {fireSort && FIRE_WINDOW_OPTIONS.map((w) => (
              <button
                key={w.id}
                className="or-chip"
                data-active={fireWindow === w.id}
                onClick={() => setFireWindow(w.id)}
                data-testid={`feed-fire-window-${w.id}`}
                style={fireWindow === w.id ? { color: "#FF7A1A", borderColor: "#FF7A1A" } : undefined}
              >
                {w.label}
              </button>
            ))}
          </div>
        )}
        {allPosts.length === 0 && (
          <div className="or-surface p-8 text-center" data-testid="feed-empty-state">
            <div className="text-2xl mb-2">✨</div>
            <div className="font-semibold mb-1" style={{ color: "var(--text-main)" }}>
              {media.length > 0 || interests.size > 0
                ? "Nothing matches these filters yet"
                : "Your Realm feed starts here"}
            </div>
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              {media.length > 0 || interests.size > 0
                ? "Toggle some filters off to widen the feed."
                : "Be the first to share a thought, photo, or video with the community."}
            </div>
          </div>
        )}
        {allPosts.map((p) => (
          <FeedCard
            key={p.id}
            p={p}
            fireStatus={fireStatus}
            onPostDeleted={(id) => setServerPosts((s) => s.filter((x) => x.id !== id))}
            onPostUpdated={(updated) => setServerPosts((s) => s.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))}
          />
        ))}
      </div>

      <AudiencePicker
        open={audiencePickerOpen}
        value={composeAudience}
        onChange={setComposeAudience}
        onClose={() => setAudiencePickerOpen(false)}
      />
      <SoundUploadPicker
        open={soundPickerOpen}
        onClose={() => setSoundPickerOpen(false)}
        onUploaded={(track) => {
          setComposeSound(track);
          setSoundPickerOpen(false);
        }}
        defaultCategory="Music"
        deferPost
        testid="feed-sound-picker"
      />
      <PollComposer
        open={pollComposerOpen}
        initial={composePoll ? {
          question: composePoll.question,
          options: composePoll.options.map((o) => o.text),
          duration_hours: composePoll.duration_hours,
        } : null}
        onClose={() => setPollComposerOpen(false)}
        onSave={(payload) => setComposePoll(payload)}
        testid="feed-poll-composer"
      />
      <ZipRequiredModal open={zipRequiredOpen} onClose={() => setZipRequiredOpen(false)} testid="feed-zip-required" />
    </div>
  );
}

function isVideoFile(u) { return !!u && /\.(mp4|webm|ogg)$/i.test(u); }

function FeedCard({ p, fireStatus, onPostDeleted, onPostUpdated }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [shareOpen, setShareOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const viewerLiked = !!(user?.id && Array.isArray(p.liked_by) && p.liked_by.includes(user.id));
  const live = usePostState(p.id, { liked: viewerLiked, likes: p.likes || 0, comments: p.comments || 0 });
  const openPopup = () => openPostPopup(p);
  const onLike = async (e) => {
    e?.stopPropagation();
    const willLike = !live.liked;
    setPost(p.id, { liked: willLike, likes: Math.max(0, live.likes + (willLike ? 1 : -1)) });
    try {
      const { data } = await apiClient.post(`/posts/${p.id}/like`);
      setPost(p.id, { liked: !!data.liked, likes: data.likes ?? 0 });
    } catch { setPost(p.id, { liked: !willLike, likes: live.likes }); }
  };
  const onComment = (e) => {
    e?.stopPropagation();
    openPopup();
  };
  const mediaImg = p.image_url || (p.media_type === "image" ? p.media_url : null);
  const mediaImgs = Array.isArray(p.image_urls) && p.image_urls.length > 0 ? p.image_urls : null;
  const mediaVidRaw = p.video_url || (p.media_type === "video" ? p.media_url : null);
  // Self-hosted videos arrive as relative `/api/videos/...` paths — promote
  // to an absolute URL so the <video> element can stream them.
  const mediaVid = mediaVidRaw ? absoluteImageUrl(mediaVidRaw) : null;
  const mediaLink = p.link_url || (p.media_type === "link" ? p.media_url : null);
  const isSound = p.media_type === "sound" && (p.sound_url || p.media_url);
  return (
    <article className="or-surface p-4 sm:p-5" data-testid={`feed-post-${p.id}`} data-pinned={p.is_pinned ? "true" : undefined}>
      {p.is_pinned && (
        <div
          className="flex items-center gap-2 mb-3 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest"
          style={{
            background: "color-mix(in srgb, var(--primary) 18%, transparent)",
            color: "var(--primary)",
            border: "1px solid var(--primary)",
            width: "fit-content",
          }}
          data-testid={`feed-post-${p.id}-pinned-banner`}
        >
          <Sparkles size={11} /> Founder Announcement
        </div>
      )}
      <header className="flex items-center gap-3 mb-3">
        <UserAvatar
          user={{ id: p.author_id, username: p.author_username, name: p.author_name, avatar_url: p.author_avatar }}
          size={40}
          onClick={p.author_username ? () => navigate(`/profile/${p.author_username}`) : undefined}
          testid={`feed-post-${p.id}-avatar`}
        />
        <div className="flex-1 min-w-0">
          {p.author_username ? (
            <UsernameLink username={p.author_username} className="font-semibold truncate block" style={{ color: "var(--text-main)" }} />
          ) : (
            <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>@{p.author_name}</div>
          )}
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {timeAgo(p.created_at)} · {p.media_type}
          </div>
        </div>
        <button onClick={(e) => e.stopPropagation()} className="or-chip" data-testid={`feed-follow-${p.id}`}>+ Follow</button>
        {user && user.id !== p.author_id && (
          <ReportButton contentType="post" contentId={p.id} testid={`feed-report-${p.id}`} />
        )}
        <PostManagementMenu
          post={p}
          user={user}
          onDeleted={onPostDeleted}
          onUpdated={onPostUpdated}
          testid={`feed-manage-${p.id}`}
        />
      </header>
      {p.content && (
        <p
          className="mb-3 text-[15px] leading-relaxed or-wrap"
          style={{
            color: "var(--text-main)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            maxWidth: "100%",
            minWidth: 0,
          }}
        >
          <HashtagText text={p.content} testid={`feed-post-content-${p.id}`} />
        </p>
      )}
      {mediaImgs ? (
        <div
          className="grid gap-1 mb-3 overflow-hidden"
          style={{
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-col)",
            gridTemplateColumns: mediaImgs.length === 1 ? "1fr" : mediaImgs.length === 2 ? "1fr 1fr" : "1fr 1fr 1fr",
          }}
          data-testid={`feed-image-album-${p.id}`}
        >
          {mediaImgs.slice(0, 6).map((u, idx) => (
            <img
              key={idx}
              src={absoluteImageUrl(u)}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full object-cover cursor-zoom-in"
              style={{ height: mediaImgs.length === 1 ? 384 : 200 }}
              data-testid={`feed-image-${p.id}-${idx}`}
              onClick={(e) => { e.stopPropagation(); setLightboxOpen(true); }}
            />
          ))}
        </div>
      ) : mediaImg && (
        <div className="overflow-hidden mb-3" style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
          <img
            src={absoluteImageUrl(mediaImg)}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-72 sm:h-96 object-cover cursor-zoom-in"
            data-testid={`feed-image-${p.id}`}
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(true); }}
          />
        </div>
      )}
      {isSound && (
        <SoundPlayerCard post={p} testid={`feed-sound-${p.id}`} />
      )}
      {mediaVid && (
        <div className="overflow-hidden mb-3" style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
          <VideoEmbed url={mediaVid} testid={`feed-video-${p.id}`} />
        </div>
      )}
      {mediaLink && (
        <a href={mediaLink} target="_blank" rel="noreferrer" className="or-chip text-sm mb-3 inline-flex break-all" data-testid={`feed-link-${p.id}`} onClick={(e) => e.stopPropagation()}>
          <Link2 size={14} /> {mediaLink}
        </a>
      )}
      {p.poll && <PollDisplay post={p} />}
      <footer className="flex gap-5 text-sm" style={{ color: "var(--text-muted)" }}>
        {fireStatus?.enabled && ((p.audience?.visibility || "public") === "public") && !p.is_sound_track ? (
          <FireButton
            post={p}
            fireStatus={fireStatus}
            testidPrefix={`feed-fire-${p.id}`}
          />
        ) : (
          <button
            data-testid={`feed-like-${p.id}`}
            onClick={onLike}
            aria-pressed={live.liked}
            className="flex items-center gap-1.5"
            style={{ color: live.liked ? "#FF3F5A" : "var(--text-muted)" }}
          >
            <Heart size={16} fill={live.liked ? "#FF3F5A" : "none"} /> <span data-testid={`feed-like-count-${p.id}`}>{live.likes}</span>
          </button>
        )}
        <button data-testid={`feed-comment-${p.id}`} onClick={onComment} className="flex items-center gap-1.5">
          <MessageCircle size={16} /> <span data-testid={`feed-comment-count-${p.id}`}>{live.comments}</span>
        </button>
        <button
          data-testid={`feed-share-${p.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setShareOpen(true);
          }}
          title="Share with a friend"
          className="flex items-center gap-1.5"
        >
          <Share2 size={16} /> Share
        </button>
        <button data-testid={`feed-save-${p.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 ml-auto">
          <Bookmark size={16} />
        </button>
      </footer>
      <div
        className="mt-2"
        onClick={(e) => e.stopPropagation()}
        data-testid={`feed-reactions-row-${p.id}`}
      >
        {/* Public posts use ONLY Fire — emoji reactions stay in messaging.
            The launcher renders only for non-public posts. */}
        {!(fireStatus?.enabled && ((p.audience?.visibility || "public") === "public")) && (
          <ReactionAttachment
            mode="mongo"
            targetType="post"
            targetId={p.id}
            summary={p.reactions?.summary}
            myReaction={p.reactions?.my_reaction}
            pickerAlign="left"
            pickerPosition="above"
            testIdPrefix={`feed-reaction-${p.id}`}
          />
        )}
      </div>
      <ShareToUserModal
        open={shareOpen}
        postId={p.id}
        postPreview={p.content || p.title || ""}
        onClose={() => setShareOpen(false)}
        testid={`feed-share-modal-${p.id}`}
      />
      <ImageLightbox
        open={lightboxOpen && !!(mediaImg || (mediaImgs && mediaImgs[0]))}
        src={absoluteImageUrl(mediaImgs?.[0] || mediaImg)}
        alt={p.content || ""}
        onClose={() => setLightboxOpen(false)}
        testid={`feed-image-lightbox-${p.id}`}
      />
    </article>
  );
}

