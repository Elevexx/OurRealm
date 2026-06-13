import React, { useEffect, useMemo, useState } from "react";
import { Heart, MessageCircle, Share2, Bookmark, Radio, Volume2, PlayCircle, Image as ImageIcon, Type } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { makeMockPosts } from "@/data/mockData";
import GuestPrompt from "@/components/GuestPrompt";

const FILTERS = [
  { id: "all", label: "All", icon: null },
  { id: "image", label: "Images", icon: ImageIcon },
  { id: "video", label: "Videos", icon: PlayCircle },
  { id: "live", label: "Lives", icon: Radio },
  { id: "sound", label: "Sounds", icon: Volume2 },
  { id: "post", label: "Posts", icon: Type },
];

const FILTER_KEY = "ourrealm.feedFilter";

function timeAgo(iso) {
  const d = new Date(iso); const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function Feed() {
  const { user, isGuest } = useAuth();
  const [filter, setFilter] = useState(() => {
    try { return localStorage.getItem(FILTER_KEY) || "all"; } catch { return "all"; }
  });
  const [serverPosts, setServerPosts] = useState([]);
  const [composeText, setComposeText] = useState("");
  const [guestPrompt, setGuestPrompt] = useState(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => { try { localStorage.setItem(FILTER_KEY, filter); } catch { /* ignore */ } }, [filter]);

  const loadPosts = async () => {
    try {
      const { data } = await apiClient.get("/posts", { params: filter === "all" ? {} : { media_type: filter } });
      setServerPosts(data.posts || []);
    } catch { setServerPosts([]); }
  };

  useEffect(() => { loadPosts(); /* eslint-disable-next-line */ }, [filter]);

  const mockPosts = useMemo(() => makeMockPosts(24), []);
  const allPosts = useMemo(() => {
    const merged = [...serverPosts, ...mockPosts];
    return filter === "all" ? merged : merged.filter((p) => p.media_type === filter);
  }, [serverPosts, mockPosts, filter]);

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

  const onAction = (label) => {
    if (!user || isGuest) setGuestPrompt(label);
  };

  return (
    <div className="max-w-3xl mx-auto" data-testid="feed-page">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>For you</div>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>The Feed</h1>
        </div>
        <span className="mode-badge">{filter === "all" ? "All media" : FILTERS.find(f => f.id === filter)?.label}</span>
      </div>

      {/* Media filter bar */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 -mx-1 px-1" data-testid="feed-filter-bar">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              data-testid={`feed-filter-${f.id}`}
              data-active={filter === f.id}
              className="or-chip shrink-0"
              onClick={() => setFilter(f.id)}
            >
              {Icon && <Icon size={14} />} {f.label}
            </button>
          );
        })}
        <button className="or-chip shrink-0 ml-2" data-testid="feed-filter-next">→ Next</button>
      </div>

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

      {/* Posts */}
      <div className="mt-5 space-y-4">
        {allPosts.length === 0 && (
          <div className="or-surface p-6 text-center" style={{ color: "var(--text-muted)" }}>
            No posts in this stream yet. Try switching filters or share something first.
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
            {p.media_url && p.media_type !== "post" && (
              <div className="overflow-hidden mb-3" style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-col)" }}>
                <img src={p.media_url} alt="" className="w-full h-72 sm:h-96 object-cover" />
                {p.media_type === "live" && (
                  <div className="absolute mt-[-3rem] ml-3 px-2 py-1 text-xs font-bold uppercase tracking-widest"
                    style={{ background: "#FF3344", color: "#fff", borderRadius: 4 }}>
                    ● Live · {Math.floor(p.likes / 10)} watching
                  </div>
                )}
              </div>
            )}
            <footer className="flex gap-5 text-sm" style={{ color: "var(--text-muted)" }}>
              <button data-testid={`feed-like-${p.id}`} onClick={() => onAction("like a post")} className="flex items-center gap-1.5 hover:text-pink-400">
                <Heart size={16} /> {p.likes}
              </button>
              <button data-testid={`feed-comment-${p.id}`} onClick={() => onAction("comment")} className="flex items-center gap-1.5 hover:opacity-80">
                <MessageCircle size={16} /> {p.comments}
              </button>
              <button data-testid={`feed-share-${p.id}`} onClick={() => onAction("share")} className="flex items-center gap-1.5 hover:opacity-80">
                <Share2 size={16} /> Share
              </button>
              <button data-testid={`feed-save-${p.id}`} onClick={() => onAction("save")} className="flex items-center gap-1.5 hover:opacity-80 ml-auto">
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
