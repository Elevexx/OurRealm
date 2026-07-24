import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Home, Sparkles, Plus, Music2 as SoundsIcon, Users, User, Radio, Video, Image as ImageIcon, MessageSquare, X, Music2, Send, Globe2, Users as UsersIcon, Lock, UserCheck } from "lucide-react";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import VideoUploadPicker from "@/components/VideoUploadPicker";
import SoundUploadPicker from "@/components/SoundUploadPicker";
import AlbumPicker from "@/components/composer/AlbumPicker";
import HashtagInput, { appendHashtags } from "@/components/composer/HashtagInput";
import AudiencePicker from "@/components/AudiencePicker";
import RealmsIcon from "@/components/RealmsIcon";

// Bottom nav — required order:
//   1. 🏠 Home  2. ✨ For You  3. 🎵 Sounds  4. ➕ Create  5. 🌌 Realms  6. 👥 Friends  7. 👤 Profile (Public)
const ITEMS_LEFT = [
  { to: "/home",    label: "Home",    Icon: Home,       testid: "bottom-home" },
  { to: "/feed",    label: "For You", Icon: Sparkles,   testid: "bottom-foryou" },
  { to: "/sounds",  label: "Sounds",  Icon: SoundsIcon, testid: "bottom-sounds" },
];
const ITEMS_RIGHT = [
  { to: "/realms",  label: "Realms",  Icon: RealmsIcon, testid: "bottom-realms" },
  { to: "/friends", label: "Friends", Icon: Users,      testid: "bottom-friends" },
  { to: "/profile", label: "Profile", Icon: User,       testid: "bottom-profile" },
];

const CREATE_OPTIONS = [
  { id: "live",    label: "Go Live", Icon: Radio,         color: "#FF3F5A", desc: "Stream to your Realm now" },
  { id: "video",   label: "Video",   Icon: Video,         color: "var(--brand-blue)", desc: "Upload a clip or reel" },
  { id: "image",   label: "Image",   Icon: ImageIcon,     color: "var(--brand-green)", desc: "Share a photo album" },
  { id: "sound",   label: "Sound",   Icon: Music2,        color: "#C26BFF", desc: "Drop a track or audio post" },
  { id: "thought", label: "Thought", Icon: MessageSquare, color: "#F4C84A", desc: "Quick text from your mind" },
];

function CreateWorkflow({ option, onClose, onDone }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [posting, setPosting] = useState(false);
  // Video: relative `/api/videos/...` URL populated by VideoUploadPicker.
  const [videoUrl, setVideoUrl] = useState("");
  // Images: array of {url, thumbnailUrl?} — shared AlbumPicker (same as For You composer).
  const [images, setImages] = useState([]);
  // Sound: track record returned by SoundUploadPicker after /sounds/upload.
  const [sound, setSound] = useState(null);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [hashtags, setHashtags] = useState([]);
  const [audience, setAudience] = useState({ visibility: "public", user_ids: [] });
  const [audienceOpen, setAudienceOpen] = useState(false);

  if (!option) return null;
  const Icon = option.Icon;

  const submit = async () => {
    setPosting(true);
    try {
      // No automatic "Image"/"Video" label text — caption-less media posts
      // publish with an empty caption.
      const base = option.id === "thought"
        ? text.trim()
        : [title.trim(), text.trim()].filter(Boolean).join(" — ");
      const content = appendHashtags(base, hashtags);

      // Per-workflow validation guards.
      if (option.id === "video" && !videoUrl) {
        // eslint-disable-next-line no-alert
        alert("Pick a video file before sharing.");
        setPosting(false);
        return;
      }
      if (option.id === "image" && images.length === 0) {
        // eslint-disable-next-line no-alert
        alert("Add at least one image to publish.");
        setPosting(false);
        return;
      }
      if (option.id === "sound" && !sound) {
        // eslint-disable-next-line no-alert
        alert("Upload a sound file to publish.");
        setPosting(false);
        return;
      }
      if (option.id === "thought" && !content) { setPosting(false); return; }

      const mediaType = option.id === "thought" ? "thought"
        : option.id === "image" ? "image"
        : option.id === "video" ? "video"
        : option.id === "live"  ? "live"
        : "sound";
      const body = { content, media_type: mediaType, audience };
      if (videoUrl) { body.video_url = videoUrl; body.media_url = videoUrl; }
      if (images.length > 0) {
        body.image_url = images[0].url;          // primary thumbnail
        body.media_url = images[0].url;
        body.image_urls = images.map((i) => i.url); // album
      }
      if (sound) {
        // The sound is already uploaded — we attach its track id + URL
        // to the post. The feed renders the player inline.
        body.sound_track_id = sound.id;
        body.sound_url = sound.file_url;
        body.media_url = sound.file_url;
        body.sound_title = sound.title;
        body.sound_cover_url = sound.cover_url || null;
        body.sound_duration = sound.duration_seconds || null;
      }
      await apiClient.post("/posts", body);
      onDone();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[CreateWorkflow] /posts failed", {
        status: e?.response?.status,
        detail: e?.response?.data?.detail,
        body: { id: option.id, hasVideo: !!videoUrl, images: images.length, hasSound: !!sound },
      });
      // eslint-disable-next-line no-alert
      alert(e?.response?.data?.detail || "Could not publish post.");
    } finally { setPosting(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
      data-testid={`create-workflow-${option.id}`}
    >
      <div className="or-surface w-full max-w-lg p-6 grain max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: 48, height: 48,
              background: `color-mix(in srgb, ${option.color} 18%, transparent)`,
              border: `2px solid ${option.color}`,
              boxShadow: `0 0 14px ${option.color}66`,
              color: option.color,
            }}
          >
            <Icon size={22} />
          </div>
          <div className="flex-1">
            <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>{option.label}</h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{option.desc}</p>
          </div>
          <button className="starbar-icon" style={{ width: 36, height: 36 }} onClick={onClose}><X size={16} /></button>
        </div>

        {option.id === "live" && (
          <>
            <div className="or-surface p-4 mb-3" style={{ background: "var(--surface-2)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#FF3F5A" }} />
                <span className="text-xs uppercase tracking-widest font-bold" style={{ color: "#FF3F5A" }}>Pre-Live · Camera + mic check</span>
              </div>
              <input className="or-input mb-2" placeholder="Stream title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-live-title" />
              <textarea className="or-input resize-none" rows={2} placeholder="Tell viewers what you're doing…" value={text} onChange={(e) => setText(e.target.value)} data-testid="create-live-desc" />
            </div>
          </>
        )}
        {option.id === "video" && (
          <>
            <VideoUploadPicker
              videoUrl={videoUrl}
              onChange={setVideoUrl}
              testid="create-video-upload"
            />
            <input className="or-input mb-2 mt-2" placeholder="Video title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-video-title" />
            <textarea className="or-input resize-none" rows={2} placeholder="Description (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {option.id === "image" && (
          <>
            <AlbumPicker images={images} onChange={setImages} accent={option.color} testidPrefix="create-image" />
            <input className="or-input mb-2" placeholder="Album title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="create-image-title" />
            <textarea className="or-input resize-none" rows={2} placeholder="Caption (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        {option.id === "sound" && (
          <>
            {sound ? (
              <div className="or-surface p-4 mb-3" style={{ background: "var(--surface-2)" }} data-testid="create-sound-selected">
                <div className="flex items-center gap-3">
                  {sound.cover_url ? (
                    <img src={sound.cover_url} alt="" className="rounded shrink-0 object-cover" style={{ width: 48, height: 48 }} />
                  ) : (
                    <div className="rounded shrink-0 flex items-center justify-center" style={{ width: 48, height: 48, background: "var(--bgc)", color: option.color }}>
                      <Music2 size={20} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ color: "var(--text-main)" }}>{sound.title}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {sound.category}{sound.genre ? ` · ${sound.genre}` : ""}{sound.duration_seconds ? ` · ${Math.round(sound.duration_seconds)}s` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSound(null)}
                    className="starbar-icon"
                    style={{ width: 32, height: 32 }}
                    aria-label="Remove sound"
                    data-testid="create-sound-remove"
                  >
                    <X size={14} />
                  </button>
                </div>
                {/* HTML5 preview using the just-uploaded file URL. */}
                {sound.file_url && (
                  <audio
                    controls
                    preload="metadata"
                    src={sound.file_url.startsWith("http") ? sound.file_url : `${process.env.REACT_APP_BACKEND_URL || ""}${sound.file_url}`}
                    className="w-full mt-3"
                    data-testid="create-sound-preview"
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSoundPickerOpen(true)}
                className="or-surface p-5 mb-3 w-full text-left"
                style={{ background: "var(--surface-2)" }}
                data-testid="create-sound-launch"
              >
                <div className="flex items-end gap-1 h-12 mb-2">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <div key={i} className="flex-1 rounded-sm" style={{
                      height: `${20 + Math.abs(Math.sin(i * 0.7)) * 80}%`,
                      background: option.color, opacity: 0.7 + (i % 3) * 0.1,
                    }} />
                  ))}
                </div>
                <div className="text-xs text-center" style={{ color: "var(--text-muted)" }}>Tap to choose an audio file</div>
              </button>
            )}
            {sound && (
              <>
                <input className="or-input mb-2" placeholder="Caption (optional)" value={text} onChange={(e) => setText(e.target.value)} data-testid="create-sound-caption" />
              </>
            )}
          </>
        )}
        {option.id === "thought" && (
          <textarea
            className="or-input resize-none"
            rows={5}
            placeholder="What's on your mind right now?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="create-thought-text"
          />
        )}

        {/* Hashtags + audience — shared across every workflow (parity with the For You composer). */}
        <HashtagInput tags={hashtags} onChange={setHashtags} accent={option.color} testidPrefix={`create-${option.id}-hashtag`} />
        <div className="flex items-center mt-2">
          <button
            type="button"
            className="or-chip"
            onClick={() => setAudienceOpen(true)}
            data-testid={`create-${option.id}-audience`}
            title="Who can see this post?"
          >
            {audience.visibility === "public" && <><Globe2 size={12} /> Public</>}
            {audience.visibility === "friends" && <><UsersIcon size={12} /> Friends</>}
            {audience.visibility === "private" && <><Lock size={12} /> Private</>}
            {audience.visibility === "custom" && <><UserCheck size={12} /> Custom ({audience.user_ids?.length || 0})</>}
          </button>
        </div>

        <div className="flex gap-2 mt-4">
          <button className="or-btn flex-1" onClick={submit} disabled={posting} data-testid={`create-${option.id}-submit`}>
            {posting ? "Publishing…" : <><Send size={14} /> {option.id === "live" ? "Go live" : "Publish"}</>}
          </button>
          <button className="or-btn or-btn-ghost" onClick={onClose}>Cancel</button>
        </div>

        {/* Mounted pickers — share the existing app-wide upload pipelines. */}
        <AudiencePicker
          open={audienceOpen}
          value={audience}
          onChange={setAudience}
          onClose={() => setAudienceOpen(false)}
        />
        <SoundUploadPicker
          open={soundPickerOpen}
          onClose={() => setSoundPickerOpen(false)}
          onUploaded={(track) => {
            setSound(track);
            setSoundPickerOpen(false);
            if (!title) setTitle(track.title || "");
          }}
          defaultCategory="Music"
          testid="create-sound-picker"
        />
      </div>
    </div>
  );
}

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState(null);

  const onCreateClick = () => {
    if (!user) return;
    setShowCreate(true);
  };

  return (
    <>
      <nav
        className="fixed left-0 right-0 bottom-0 z-40"
        style={{
          background: "color-mix(in srgb, var(--bgc) 90%, transparent)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid var(--border-col)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          maxWidth: "100vw",
        }}
        data-testid="bottom-nav"
      >
        <div className="max-w-5xl mx-auto flex items-end px-1 sm:px-4 py-1.5 max-w-full">
          {ITEMS_LEFT.map(({ to, label, Icon, testid }) => {
            const active = location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <button key={testid} className="bottomnav-btn" data-active={active} data-testid={testid} onClick={() => navigate(to)}>
                <Icon size={22} />
                <span>{label}</span>
              </button>
            );
          })}

          <div className="flex-[0_0_56px] sm:flex-[0_0_72px] flex justify-center -translate-y-3">
            <button
              data-testid="bottom-create"
              onClick={onCreateClick}
              className="flex items-center justify-center"
              style={{
                width: 52, height: 52, borderRadius: 999,
                background: "linear-gradient(135deg, var(--primary), var(--secondary))",
                color: "var(--primary-fg)",
                border: "3px solid var(--bgc)",
                boxShadow: "0 0 24px color-mix(in srgb, var(--primary) 65%, transparent)",
              }}
              aria-label="Create"
            >
              <Plus size={24} />
            </button>
          </div>

          {ITEMS_RIGHT.map(({ to, label, Icon, testid }) => {
            // The Profile tab opens the *Public* view of the logged-in
            // user's profile (the top-bar profile icon opens the Edit view).
            const target = testid === "bottom-profile" && user?.username
              ? `/public/${user.username}`
              : to;
            const active = location.pathname === target || location.pathname === to || location.pathname.startsWith(to + "/");
            return (
              <button key={testid} className="bottomnav-btn" data-active={active} data-testid={testid} onClick={() => navigate(target)}>
                <Icon size={22} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Create radial menu */}
      {showCreate && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-24 sm:pb-0"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowCreate(false)}
          data-testid="create-overlay"
        >
          <div className="or-surface p-6 sm:p-8 w-full max-w-lg grain" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl" style={{ fontFamily: "var(--font-display)" }}>What are you creating?</h3>
              <button className="starbar-icon" onClick={() => setShowCreate(false)} style={{ width: 36, height: 36 }}>
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {CREATE_OPTIONS.map((opt) => {
                const Icon = opt.Icon;
                return (
                  <button
                    key={opt.id}
                    data-testid={`create-${opt.id}`}
                    onClick={() => { setShowCreate(false); setActiveWorkflow(opt); }}
                    className="or-surface p-4 flex flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <Icon size={26} style={{ color: opt.color }} />
                    <span className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <CreateWorkflow
        option={activeWorkflow}
        onClose={() => setActiveWorkflow(null)}
        onDone={() => { setActiveWorkflow(null); navigate("/feed"); }}
      />
    </>
  );
}
