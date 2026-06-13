import React, { useEffect, useMemo, useState } from "react";
import { Heart, MessageCircle, Share2, Bookmark, Sliders, Sparkles } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { makeMockPosts } from "@/data/mockData";
import GuestPrompt from "@/components/GuestPrompt";
import MediaTypeBar from "@/components/MediaTypeBar";

const FILTER_KEY = "ourrealm.feedMedia";

function timeAgo(iso) {
  const d = new Date(iso); const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function Feed() {
  const { user, isGuest } = useAuth();
  const [media, setMedia] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "[]"); } catch { return []; }
  });
  const [serverPosts, setServerPosts] = useState([]);
  const [composeText, setComposeText] = useState("");
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
    if (media.length === 0) return merged;
    return merged.filter((p) => media.includes(p.media_type));
  }, [serverPosts, mockPosts, media]);

  const submitPost = async () => {
    if (!user || isGuest) { setGuestPrompt("post a thought"); return; }
    if (!composeText.trim()) return;
    setPosting(true);
    try {
      await apiClient.post("/posts", { content: composeText.trim(), media_type: "post" });
      setComposeText("");
      await loadPosts();
    } finally { setPosting(false); }
  };
  const onAction = (label) => { if (!user || isGuest) setGuestPrompt(label); };

  return (
    <div className="max-w-3xl mx-auto" data-testid="feed-page">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Personalized stream</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
            For <span style={{ color: "var(--brand-green)" }}>You</span>
          </h1>
        </div>
        <button className="or-chip" data-testid="feed-customize">
          <Sliders size={14} /> Customize
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
            <div className="flex justify-end mt-2">
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
          <article key={p.id} className="or-surface p-4 sm:p-5" data-testid={`feed-post-${p.id}`}>
            <header className="flex items-center gap-3 mb-3">
              <img
                src={p.author_avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(p.author_name)}`}
                alt={p.author_name}
                className="rounded-full object-cover"
                style={{ width: 40, height: 40, border: "1px solid var(--border-col)" }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>@{p.author_name}</div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(p.created_at)} · {p.media_type}
                </div>
              </div>
              <button onClick={() => onAction("follow")} className="or-chip" data-testid={`feed-follow-${p.id}`}>+ Follow</button>
            </header>
            {p.content && <p className="mb-3 text-[15px] leading-relaxed" style={{ color: "var(--text-main)" }}>{p.content}</p>}
            {p.media_url && p.media_type !== "post" && p.media_type !== "thought" && (
              <div className="overflow-hidden mb-3" style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
                <img src={p.media_url} alt="" className="w-full h-72 sm:h-96 object-cover" />
              </div>
            )}
            <footer className="flex gap-5 text-sm" style={{ color: "var(--text-muted)" }}>
              <button data-testid={`feed-like-${p.id}`} onClick={() => onAction("like a post")} className="flex items-center gap-1.5 hover:text-pink-400">
                <Heart size={16} /> {p.likes}
              </button>
              <button data-testid={`feed-comment-${p.id}`} onClick={() => onAction("comment")} className="flex items-center gap-1.5">
                <MessageCircle size={16} /> {p.comments}
              </button>
              <button data-testid={`feed-share-${p.id}`} onClick={() => onAction("share")} className="flex items-center gap-1.5">
                <Share2 size={16} /> Share
              </button>
              <button data-testid={`feed-save-${p.id}`} onClick={() => onAction("save")} className="flex items-center gap-1.5 ml-auto">
                <Bookmark size={16} />
              </button>
            </footer>
          </article>
        ))}
      </div>

      <GuestPrompt open={!!guestPrompt} onClose={() => setGuestPrompt(null)} action={guestPrompt || "do this"} />
    </div>
  );
}
