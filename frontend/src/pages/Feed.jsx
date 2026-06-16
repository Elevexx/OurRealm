import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, Share2, Bookmark, Sliders, Sparkles, Globe2, Users as UsersIcon, Lock, UserCheck, MessageSquare, Image as ImageIcon, Video, Link2 } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { makeMockPosts } from "@/data/mockData";
import GuestPrompt from "@/components/GuestPrompt";
import MediaTypeBar from "@/components/MediaTypeBar";
import AudiencePicker from "@/components/AudiencePicker";
import UsernameLink from "@/components/UsernameLink";
import { openPostPopup } from "@/lib/postPopupController";
import { usePostState, setPost } from "@/lib/postStore";

const FILTER_KEY = "ourrealm.feedMedia";
const INTEREST_KEY = "ourrealm.interests";

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
  const [audiencePickerOpen, setAudiencePickerOpen] = useState(false);
  const [guestPrompt, setGuestPrompt] = useState(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(media)); } catch { /* ignore */ } }, [media]);

  const loadPosts = async () => {
    try {
      const { data } = await apiClient.get("/posts");
      setServerPosts(data.posts || []);
    } catch { setServerPosts([]); }
  };
  useEffect(() => { loadPosts(); }, []);

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
    if (!composeText.trim()) return;
    setPosting(true);
    try {
      await apiClient.post("/posts", {
        content: composeText.trim(),
        media_type: composeMediaType || "thought",
        media_url: composeMediaUrl || null,
        image_url: composeMediaType === "image" ? (composeMediaUrl || null) : null,
        video_url: composeMediaType === "video" ? (composeMediaUrl || null) : null,
        link_url: composeMediaType === "link" ? (composeMediaUrl || null) : null,
        audience: composeAudience,
      });
      setComposeText("");
      setComposeMediaType("thought");
      setComposeMediaUrl("");
      setComposeAudience({ visibility: "public", user_ids: [] });
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

      {/* Composer */}
      <div className="or-surface p-4 mt-4" data-testid="feed-composer">
        <div className="flex gap-3">
          <div className="rounded-full overflow-hidden shrink-0" style={{ width: 40, height: 40, border: "1px solid var(--border-col)" }}>
            <img
              alt="me"
              src={user?.avatar_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.name || "Guest")}`}
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
                  }}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
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
          src={p.author_avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.author_name)}`}
          alt={p.author_name}
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
          <img src={mediaImg} alt="" className="w-full h-72 sm:h-96 object-cover" data-testid={`feed-image-${p.id}`} />
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

