import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, Share2, Bookmark, Sliders, Sparkles, Globe2, Users as UsersIcon, Lock, UserCheck, MessageSquare, Image as ImageIcon, Video, Link2, BarChart3 } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { makeMockPosts } from "@/data/mockData";
import GuestPrompt from "@/components/GuestPrompt";
import MediaTypeBar from "@/components/MediaTypeBar";
import AudiencePicker from "@/components/AudiencePicker";
import UsernameLink from "@/components/UsernameLink";
import { openPostPopup } from "@/lib/postPopupController";
import { usePostState, setPost } from "@/lib/postStore";
import ImageUploadPicker, { absoluteImageUrl } from "@/components/ImageUploadPicker";
import ZipRequiredModal from "@/components/ZipRequiredModal";
import PollComposer from "@/components/PollComposer";
import PollDisplay from "@/components/PollDisplay";

const FILTER_KEY = "ourrealm.feedMedia";
const INTEREST_KEY = "ourrealm.interests";
const RADIUS_KEY = "ourrealm.feedRadius";
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
  const { user, isGuest } = useAuth();
  const navigate = useNavigate();
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
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  // Phase-2 — Radius filter ("any" | "10" | "20" | "50" | "100" | "250" | "500").
  const [radius, setRadius] = useState(() => {
    try { return localStorage.getItem(RADIUS_KEY) || "any"; } catch { return "any"; }
  });
  const [zipRequiredOpen, setZipRequiredOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem(RADIUS_KEY, radius); } catch { /* ignore */ } }, [radius]);
  const [guestPrompt, setGuestPrompt] = useState(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(media)); } catch { /* ignore */ } }, [media]);

  const loadPosts = async () => {
    try {
      // Radius queries require a stored ZIP code on the viewer. When the
      // viewer hasn't set one we either fall back to "any" silently or, if
      // they explicitly chose a radius, gate the action via the modal.
      const params = {};
      // Always pass viewer so backend can mark poll votes for the current user.
      if (user?.username) params.viewer = user.username;
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
  useEffect(() => { loadPosts(); }, [radius, user?.zip_code, user?.username]);  // eslint-disable-line react-hooks/exhaustive-deps

  const mockPosts = useMemo(() => makeMockPosts(24), []);
  const allPosts = useMemo(() => {
    const merged = [...serverPosts, ...mockPosts];
    // De-dupe by id (server backfill can produce overlapping ids,
    // and we never want React duplicate-key warnings on the feed).
    const seen = new Set();
    let filtered = merged.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    if (media.length > 0) filtered = filtered.filter((p) => media.includes(p.media_type));
    // Images category only: hide the two seeded "@Realm Admin" placeholder posts.
    // Scoped strictly to the Images filter — does not affect other categories
    // or the global post data.
    if (media.length === 1 && media[0] === "image") {
      filtered = filtered.filter((p) => (p.author_name || "").toLowerCase() !== "realm admin");
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
  }, [serverPosts, mockPosts, media, interests]);

  const submitPost = async () => {
    if (!user || isGuest) { setGuestPrompt("post a thought"); return; }
    if (!composeText.trim() && !composePoll) return;
    setPosting(true);
    try {
      await apiClient.post("/posts", {
        content: composeText.trim() || (composePoll?.question || ""),
        media_type: composeMediaType || "thought",
        media_url: composeMediaUrl || null,
        image_url: composeMediaType === "image" ? (composeMediaUrl || null) : null,
        video_url: composeMediaType === "video" ? (composeMediaUrl || null) : null,
        link_url: composeMediaType === "link" ? (composeMediaUrl || null) : null,
        audience: composeAudience,
        poll: composePoll || undefined,
      });
      setComposeText("");
      setComposeMediaType("thought");
      setComposeMediaUrl("");
      setComposeAudience({ visibility: "public", user_ids: [] });
      setComposePoll(null);
      await loadPosts();
    } finally { setPosting(false); }
  };
  const onAction = (label) => { if (!user || isGuest) setGuestPrompt(label); };

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
          onClick={() => navigate("/home")}
          data-testid="feed-customize-feed"
          title="Re-select interests"
        >
          <Sliders size={14} /> Customize Feed
        </button>
      </div>

      {/* Media type bar (matches uploaded design) */}
      <MediaTypeBar value={media} onChange={setMedia} onNext={() => {}} />

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

      {/* Composer */}
      <div className="or-surface p-4 mt-4" data-testid="feed-composer">
        <div className="flex gap-3">
          <div className="rounded-full overflow-hidden shrink-0" style={{ width: 40, height: 40, border: "1px solid var(--border-col)" }}>
            <img
              alt="me"
              src={absoluteImageUrl(user?.avatar_url) || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.name || "Guest")}`}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1">
            <textarea
              data-testid="feed-composer-input"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              placeholder={isGuest || !user ? "Sign up to share a thought…" : "What's happening in your Realm?"}
              rows={2}
              className="or-input resize-none"
              style={{ background: "transparent" }}
            />
            {/* Media type chips — image/video/link expand a URL input;
                clicking the active chip clears it back to a plain thought. */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap" data-testid="feed-composer-media-row">
              {[
                { id: "thought", label: "Thought", Icon: MessageSquare },
                { id: "image",   label: "Image",   Icon: ImageIcon },
                { id: "video",   label: "Video",   Icon: Video },
                { id: "link",    label: "Link",    Icon: Link2 },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="or-chip"
                  data-active={composeMediaType === id}
                  data-testid={`feed-composer-type-${id}`}
                  onClick={() => {
                    setComposeMediaType(id);
                    if (id === "thought") setComposeMediaUrl("");
                    // Tapping "Image" opens the upload picker (device or URL).
                    if (id === "image") setImagePickerOpen(true);
                  }}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
              {/* Phase 4B — Poll attachment */}
              <button
                type="button"
                className="or-chip"
                data-active={!!composePoll}
                data-testid="feed-composer-poll"
                onClick={() => setPollComposerOpen(true)}
                title={composePoll ? "Edit poll" : "Add poll"}
              >
                <BarChart3 size={12} /> {composePoll ? "Poll attached" : "Poll"}
              </button>
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
            </div>
            {composeMediaType !== "thought" && (
              <input
                className="or-input mt-2 text-sm"
                placeholder={
                  composeMediaType === "image" ? "Paste an image URL (jpg/png/gif/webp)" :
                  composeMediaType === "video" ? "Paste a video URL (mp4/youtube/vimeo)" :
                  "Paste a link URL"
                }
                value={composeMediaUrl}
                onChange={(e) => setComposeMediaUrl(e.target.value)}
                data-testid="feed-composer-media-url"
              />
            )}
            {composeMediaType === "image" && composeMediaUrl && (
              <div className="mt-2" data-testid="feed-composer-preview-image">
                <img src={composeMediaUrl} alt="" className="rounded" style={{ maxHeight: 180, maxWidth: "100%" }} />
              </div>
            )}
            {composeMediaType === "video" && composeMediaUrl && (
              <div className="mt-2 text-xs flex items-center gap-1.5" data-testid="feed-composer-preview-video" style={{ color: "var(--text-muted)" }}>
                <Video size={12} /> Video will render in feed
              </div>
            )}
            {composeMediaType === "link" && composeMediaUrl && (
              <div className="mt-2 text-xs flex items-center gap-1.5" data-testid="feed-composer-preview-link" style={{ color: "var(--text-muted)" }}>
                <Link2 size={12} /> <span className="truncate">{composeMediaUrl}</span>
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
              <button
                data-testid="feed-composer-submit"
                className="or-btn"
                disabled={posting}
                onClick={submitPost}
                style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
              >
                {posting ? "Posting…" : "Share"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {allPosts.length === 0 && (
          <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>
            Nothing matches these media types. Toggle some off to widen the feed.
          </div>
        )}
        {allPosts.map((p) => (
          <FeedCard
            key={p.id}
            p={p}
            onGuestAction={(label) => onAction(label)}
            isGuest={!user || isGuest}
          />
        ))}
      </div>

      <GuestPrompt open={!!guestPrompt} onClose={() => setGuestPrompt(null)} action={guestPrompt || "do this"} />
      <AudiencePicker
        open={audiencePickerOpen}
        value={composeAudience}
        onChange={setComposeAudience}
        onClose={() => setAudiencePickerOpen(false)}
      />
      <ImageUploadPicker
        open={imagePickerOpen}
        onClose={() => setImagePickerOpen(false)}
        onPicked={({ url }) => { setComposeMediaUrl(url); setComposeMediaType("image"); }}
        title="Add an image to your post"
        testid="feed-image-picker"
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

function FeedCard({ p, onGuestAction, isGuest }) {
  const { user } = useAuth();
  const viewerLiked = !!(user?.id && Array.isArray(p.liked_by) && p.liked_by.includes(user.id));
  const live = usePostState(p.id, { liked: viewerLiked, likes: p.likes || 0, comments: p.comments || 0 });
  const openPopup = () => openPostPopup(p);
  const onLike = async (e) => {
    e?.stopPropagation();
    if (isGuest) { onGuestAction("like a post"); return; }
    const willLike = !live.liked;
    setPost(p.id, { liked: willLike, likes: Math.max(0, live.likes + (willLike ? 1 : -1)) });
    try {
      const { data } = await apiClient.post(`/posts/${p.id}/like`);
      setPost(p.id, { liked: !!data.liked, likes: data.likes ?? 0 });
    } catch { setPost(p.id, { liked: !willLike, likes: live.likes }); }
  };
  const onComment = (e) => {
    e?.stopPropagation();
    if (isGuest) { onGuestAction("comment"); return; }
    openPopup();
  };
  const mediaImg = p.image_url || (p.media_type === "image" ? p.media_url : null);
  const mediaVid = p.video_url || (p.media_type === "video" ? p.media_url : null);
  const mediaLink = p.link_url || (p.media_type === "link" ? p.media_url : null);
  return (
    <article className="or-surface p-4 sm:p-5" data-testid={`feed-post-${p.id}`}>
      <header className="flex items-center gap-3 mb-3">
        <img
          src={absoluteImageUrl(p.author_avatar) || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.author_name)}`}
          alt={p.author_name}
          loading="lazy"
          decoding="async"
          className="rounded-full object-cover"
          style={{ width: 40, height: 40, border: "1px solid var(--border-col)" }}
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
        <button onClick={(e) => { e.stopPropagation(); onGuestAction("follow"); }} className="or-chip" data-testid={`feed-follow-${p.id}`}>+ Follow</button>
      </header>
      {p.content && <p className="mb-3 text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-main)" }}>{p.content}</p>}
      {mediaImg && (
        <div className="overflow-hidden mb-3" style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
          <img src={absoluteImageUrl(mediaImg)} alt="" loading="lazy" decoding="async" className="w-full h-72 sm:h-96 object-cover" data-testid={`feed-image-${p.id}`} />
        </div>
      )}
      {mediaVid && (
        <div className="overflow-hidden mb-3" style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
          {isVideoFile(mediaVid) ? (
            <video src={mediaVid} controls className="w-full" style={{ maxHeight: 480 }} data-testid={`feed-video-${p.id}`} />
          ) : (
            <a href={mediaVid} target="_blank" rel="noreferrer" className="or-chip text-sm m-3 inline-flex" data-testid={`feed-video-link-${p.id}`} onClick={(e) => e.stopPropagation()}>
              <Video size={14} /> Watch video
            </a>
          )}
        </div>
      )}
      {mediaLink && (
        <a href={mediaLink} target="_blank" rel="noreferrer" className="or-chip text-sm mb-3 inline-flex break-all" data-testid={`feed-link-${p.id}`} onClick={(e) => e.stopPropagation()}>
          <Link2 size={14} /> {mediaLink}
        </a>
      )}
      {p.poll && <PollDisplay post={p} />}
      <footer className="flex gap-5 text-sm" style={{ color: "var(--text-muted)" }}>
        <button
          data-testid={`feed-like-${p.id}`}
          onClick={onLike}
          aria-pressed={live.liked}
          className="flex items-center gap-1.5"
          style={{ color: live.liked ? "#FF3F5A" : "var(--text-muted)" }}
        >
          <Heart size={16} fill={live.liked ? "#FF3F5A" : "none"} /> <span data-testid={`feed-like-count-${p.id}`}>{live.likes}</span>
        </button>
        <button data-testid={`feed-comment-${p.id}`} onClick={onComment} className="flex items-center gap-1.5">
          <MessageCircle size={16} /> <span data-testid={`feed-comment-count-${p.id}`}>{live.comments}</span>
        </button>
        <button data-testid={`feed-share-${p.id}`} onClick={(e) => { e.stopPropagation(); onGuestAction("share"); }} className="flex items-center gap-1.5">
          <Share2 size={16} /> Share
        </button>
        <button data-testid={`feed-save-${p.id}`} onClick={(e) => { e.stopPropagation(); onGuestAction("save"); }} className="flex items-center gap-1.5 ml-auto">
          <Bookmark size={16} />
        </button>
      </footer>
    </article>
  );
}

