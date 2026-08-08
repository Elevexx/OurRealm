import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, Image as ImageIcon, Music, Video, FileText, Loader2, Send, Lock,
  Gamepad2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const IMG = {
  pixel_art: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/b16c783a81c47751421a83d742d8ef9e53f04ee732d616b0308f14c6940d20dc.jpeg",
  hand_drawn_2d: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/b511eb5b776a9304efa986b273f4d468dffdac1659572ed13aea27c6b1301833.jpeg",
  cartoon: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/37a03836a397af6f2a5a68712f017499254be5686a027073f84232846977438b.jpeg",
  anime: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/afa545494d03ad5983911ba7a77ce208fc7b3d864a5dfdfd66189be95fbb69fc.jpeg",
  comic_book: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/b1e1236137a29e7a62722dad1b20e3ddbe00508be92d078dcda0958ce97d44ac.jpeg",
  low_poly: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/73360615f8cc84d5a8237525c6b20eeef126f61bc10456819a83bbdb73b3daf7.jpeg",
  stylized_3d: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/3d335161ec69f98b9a8ecc7602c64a35e7c65ff6a72d58004aab3e8568e29d02.jpeg",
  chibi: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/dff066cbc2fbd77ec82eaa5e08a4e08acc315eb84161fb86c25fa2c3d132b0d5.jpeg",
  watercolor: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/0013e3b0361a25c34e269ecec5ca521466b3f1c53de456c37846e0410545b644.jpeg",
  ink_brush: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/f9319acac867b88824974dc4733c311af0690943c85a66537f98e501da53d7ba.jpeg",
  action_rpg_2_5d: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/46e73ca8811a5bd919da83979a3d94c5634666bd9b8c1f850dc80293289170af.jpeg",
  turn_based_creature_rpg: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/6ac75b390945602cb36d649e483b33f25b5d4c70994749c881a2e2dcc821bc2c.jpeg",
  platformer: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/26c26f6d710e56789219e5decbef24e435648e8ece29dc82fb6cb31a1ca54d56.jpeg",
  top_down_adventure: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/c6d273e922ac69bf28280312e8179998ebfb1a8409833288d58f040c19ba9104.jpeg",
  open_world_rpg: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/8f5ae95bc5d3e19070cceab7456e55659bd9aee661acba4643ced14fc360eef0.jpeg",
  card_battle: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/a263441df3e3697ea386fc136de27c0ffe80b76017b98e565ee1ff64c7c90bca.jpeg",
  tower_defense: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/d84d38d92e1e270e725df68796df880097d99695e56e79a7ff0e61700cae8594.jpeg",
  match3: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/788f394684201327520ca7f5f8f0dffe200071cb931f3778ce8c0deb23908d25.jpeg",
  racing: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/56d49658e0b21dbaba7325c97f1a9c2016c05ddc76d2ec0d0e0a29d261d7e5d6.jpeg",
  shooter: "https://static.prod-images.emergentagent.com/jobs/1c985948-3d37-41fa-b0f3-a492d822a494/images/195e0933b3203579de73efe7209b46b7f59fb75336d3c09653a866f192d573d3.jpeg",
};

const BLUE = "#2EA0FF", GREEN = "#10E670", ORANGE = "#F4A73B";

const Card = ({ n, name, desc, img, color, selected, status, onClick, testid }) => (
  <button onClick={onClick} data-testid={testid}
    className="text-left rounded-xl overflow-hidden transition-transform duration-150 active:scale-95 relative"
    style={{
      background: "#060a14",
      border: `1.5px solid ${selected ? color : `${color}55`}`,
      boxShadow: selected ? `0 0 18px ${color}88, inset 0 0 12px ${color}22` : `0 0 6px ${color}22`,
    }}>
    <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
      <span className="w-5 h-5 rounded flex items-center justify-center text-[11px] font-black shrink-0"
        style={{ background: selected ? color : `${color}22`, color: selected ? "#04080f" : color,
          border: `1px solid ${color}88` }}>{n}</span>
      <b className="text-[10px] sm:text-[11px] leading-tight uppercase tracking-wide truncate"
        style={{ color: "#EAF2FF" }}>{name}</b>
    </div>
    <div className="relative" style={{ aspectRatio: "1.25/1" }}>
      <img src={img} alt={name} loading="lazy" className="w-full h-full object-cover" />
      {status === "planned" && (
        <span className="absolute top-1.5 right-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase"
          style={{ background: "rgba(4,8,18,0.85)", color: ORANGE, border: `1px solid ${ORANGE}` }}>Coming Soon</span>)}
      {selected && (
        <span className="absolute inset-0 flex items-center justify-center" style={{ background: `${color}22` }}>
          <CheckCircle2 size={30} style={{ color, filter: `drop-shadow(0 0 8px ${color})` }} />
        </span>)}
    </div>
    <p className="px-2 py-1.5 text-[8.5px] sm:text-[9.5px] leading-snug" style={{ color: "rgba(234,242,255,0.62)" }}>{desc}</p>
  </button>
);

export default function GameMakerPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [cat, setCat] = useState(null);
  const [style, setStyle] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [idea, setIdea] = useState("");
  const [files, setFiles] = useState([]);
  const [est, setEst] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    document.title = "OurRealm Game Maker";
    if (!user) return;
    apiClient.get("/gamemaker/catalog").then((r) => setCat(r.data)).catch(() => setCat({ access: { allowed: false } }));
  }, [user]);

  const pollJob = useCallback((jobId) => {
    clearInterval(pollRef.current);
    localStorage.setItem("gm.activeJob", jobId);
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiClient.get(`/jobs/${jobId}`);
        setJob(r.data.job);
        if (["completed", "failed", "cancelled"].includes(r.data.job.phase)) {
          clearInterval(pollRef.current);
          localStorage.removeItem("gm.activeJob");
          if (r.data.job.phase === "completed") toast.success("Your game is ready! 🎮");
        }
      } catch { /* keep polling */ }
    }, 3000);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("gm.activeJob");
    if (saved && user) { setJob({ id: saved, phase: "queued", pct: 0 }); pollJob(saved); }
    return () => clearInterval(pollRef.current);
  }, [user, pollJob]);

  const estimate = async () => {
    if (!style || !runtime || !idea.trim()) { toast.error("Pick a style, a runtime and describe your game"); return; }
    setBusy(true);
    try {
      const r = await apiClient.post("/gamemaker/create", { idea, style, runtime, dry_run: true });
      setEst(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Estimate failed"); }
    finally { setBusy(false); }
  };

  const create = async () => {
    setBusy(true);
    try {
      const rid = `gmcreate-${Date.now()}`;
      const r = await apiClient.post("/gamemaker/create", { idea, style, runtime, request_id: rid });
      setEst(null); setJob({ id: r.data.job_id, phase: "queued", pct: 0 });
      pollJob(r.data.job_id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not start the build"); }
    finally { setBusy(false); }
  };

  const locked = !user || (cat && !cat.access?.allowed);

  return (
    <div className="min-h-screen pb-16" style={{ background: "#04070f", color: "#EAF2FF" }} data-testid="gamemaker-page">
      <div className="max-w-5xl mx-auto px-3 pt-6">
        {/* 1. Logo treatment + 2. GAME MAKER title */}
        <div className="text-center mb-5">
          <h1 className="font-black leading-none" style={{
            fontSize: "clamp(2.6rem, 10vw, 5rem)", fontFamily: "var(--font-display, inherit)",
            background: "linear-gradient(90deg, #2EA0FF 0%, #10E670 45%, #F4C84A 75%, #F4A73B 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 18px rgba(46,160,255,0.35))" }} data-testid="gamemaker-logo">
            OurRealm
          </h1>
          <h2 className="font-black tracking-[0.18em] mt-1" style={{ fontSize: "clamp(1.5rem, 5.5vw, 2.6rem)", color: "#fff" }}
            data-testid="gamemaker-title">GAME MAKER</h2>
        </div>

        {locked && (
          <div className="rounded-2xl p-6 mb-6 text-center" data-testid="gamemaker-locked"
            style={{ border: `1.5px solid ${ORANGE}66`, background: "rgba(244,167,59,0.06)" }}>
            <Lock size={22} className="mx-auto mb-2" style={{ color: ORANGE }} />
            <p className="text-sm font-bold mb-1">Founder Preview</p>
            <p className="text-[11px]" style={{ color: "rgba(234,242,255,0.65)" }}>
              {cat?.access?.message || "OurRealm Game Maker is opening soon — sign in to check your access."}</p>
            {!user && (
              <button className="mt-3 px-5 py-2 rounded-full font-bold text-xs" style={{ background: GREEN, color: "#0a0a0a" }}
                onClick={() => navigate("/signin?next=%2Fgamemaker")} data-testid="gamemaker-signin-btn">Sign In</button>)}
          </div>
        )}

        {/* 3-4. 10 ANIMATION STYLES */}
        <section className="rounded-2xl p-3 sm:p-4 mb-6" data-testid="gamemaker-styles-section"
          style={{ border: `1.5px solid ${BLUE}66`, boxShadow: `0 0 22px ${BLUE}22, inset 0 0 40px rgba(46,160,255,0.04)` }}>
          <h3 className="text-center font-black tracking-[0.12em] mb-3 text-base md:text-lg" style={{ color: BLUE, textShadow: `0 0 12px ${BLUE}88` }}>
            10 ANIMATION STYLES</h3>
          <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {(cat?.styles || fallbackStyles).map((s, i) => (
              <Card key={s.key} n={i + 1} name={s.name} desc={s.description} img={IMG[s.key]} color={BLUE}
                selected={style === s.key} onClick={() => !locked && setStyle(s.key)}
                testid={`gm-style-${s.key}`} />
            ))}
          </div>
        </section>

        {/* 5-6. 10 POWERFUL GAME RUNTIMES */}
        <section className="rounded-2xl p-3 sm:p-4 mb-6" data-testid="gamemaker-runtimes-section"
          style={{ border: `1.5px solid ${GREEN}66`, boxShadow: `0 0 22px ${GREEN}22, inset 0 0 40px rgba(16,230,112,0.04)` }}>
          <h3 className="text-center font-black tracking-[0.12em] mb-3 text-base md:text-lg" style={{ color: GREEN, textShadow: `0 0 12px ${GREEN}88` }}>
            10 POWERFUL GAME RUNTIMES</h3>
          <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {(cat?.runtimes || fallbackRuntimes).map((r, i) => (
              <Card key={r.key} n={i + 1} name={r.name} desc={r.description} img={IMG[r.key]} color={GREEN}
                status={r.status} selected={runtime === r.key}
                onClick={() => { if (locked) return; if (r.status !== "live") { toast.info(`${r.name} is coming soon`); return; } setRuntime(r.key); }}
                testid={`gm-runtime-${r.key}`} />
            ))}
          </div>
        </section>

        {/* 7. CHAT WITH ORAI */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <section className="rounded-2xl p-4" data-testid="gamemaker-chat-panel"
            style={{ border: `1.5px solid ${BLUE}66`, boxShadow: `0 0 22px ${BLUE}22` }}>
            <h3 className="text-center font-black tracking-[0.12em] mb-3 text-sm md:text-base" style={{ color: BLUE, textShadow: `0 0 10px ${BLUE}88` }}>
              CHAT WITH ORAI</h3>
            <div className="flex gap-3 items-start">
              <div className="shrink-0 w-16 h-16 rounded-full flex items-center justify-center relative"
                style={{ border: `2px solid ${BLUE}`, boxShadow: `0 0 16px ${BLUE}66` }}>
                <Mic size={26} style={{ color: BLUE }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="rounded-xl rounded-tl-sm px-3 py-2 mb-2 text-[11.5px]"
                  style={{ background: "rgba(46,160,255,0.12)", border: `1px solid ${BLUE}44` }}>
                  Hello, Creator! 👋<br />What game do you want to build today?
                </div>
                {idea && (
                  <div className="rounded-xl rounded-tr-sm px-3 py-2 mb-2 text-[11.5px] ml-6"
                    style={{ background: "rgba(16,230,112,0.12)", border: `1px solid ${GREEN}44` }}
                    data-testid="gamemaker-idea-echo">{idea}</div>)}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input className="flex-1 rounded-full px-4 py-2.5 text-[12px] outline-none"
                style={{ background: "rgba(10,16,30,0.9)", border: `1px solid ${BLUE}44`, color: "#EAF2FF" }}
                placeholder="Type your ideas, ask questions, or describe your game…"
                value={idea} onChange={(e) => setIdea(e.target.value)} disabled={locked}
                data-testid="gamemaker-idea-input" />
              <button className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: `${BLUE}22`, border: `1px solid ${BLUE}66`, color: BLUE }}
                onClick={estimate} disabled={locked || busy} data-testid="gamemaker-send-btn" aria-label="Review & estimate">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </section>

          {/* 8. UPLOAD MEDIA */}
          <section className="rounded-2xl p-4" data-testid="gamemaker-upload-panel"
            style={{ border: `1.5px solid ${GREEN}66`, boxShadow: `0 0 22px ${GREEN}22` }}>
            <h3 className="text-center font-black tracking-[0.12em] mb-2 text-sm md:text-base" style={{ color: GREEN, textShadow: `0 0 10px ${GREEN}88` }}>
              UPLOAD MEDIA</h3>
            <p className="text-center text-[10.5px] font-bold mb-3" style={{ color: ORANGE }}>
              DRAG &amp; DROP YOUR IMAGES, AUDIOS<br />OR VIDEOS TO USE IN YOUR PROJECT</p>
            <input ref={fileRef} type="file" multiple hidden accept="image/*,audio/*,video/*,.pdf,.txt"
              onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 8)); toast.success("Added — reference files will guide your game's art"); }} />
            <div className="grid grid-cols-4 gap-2">
              {[["IMAGE", ImageIcon, GREEN], ["AUDIO", Music, "#C26BFF"], ["VIDEO", Video, "#B26BFF"], ["FILE", FileText, BLUE]].map(([label, Icon, c]) => (
                <button key={label} className="rounded-xl py-3 flex flex-col items-center gap-1.5"
                  style={{ background: `${c}14`, border: `1.5px solid ${c}66` }}
                  onClick={() => !locked && fileRef.current?.click()} data-testid={`gamemaker-upload-${label.toLowerCase()}`}>
                  <Icon size={20} style={{ color: c }} />
                  <span className="text-[9px] font-bold tracking-wider" style={{ color: "#EAF2FF" }}>{label}</span>
                </button>
              ))}
            </div>
            <p className="text-center text-[10px] mt-2" style={{ color: "rgba(234,242,255,0.5)" }}>
              or click to browse files{files.length > 0 && <b style={{ color: GREEN }}> · {files.length} added</b>}</p>
          </section>
        </div>

        {/* Summary + estimate + create */}
        {est && !job && (
          <div className="rounded-2xl p-4 mb-6" data-testid="gamemaker-summary"
            style={{ border: `1.5px solid ${ORANGE}88`, background: "rgba(244,167,59,0.05)" }}>
            <b className="text-sm block mb-1">Ready to build?</b>
            <p className="text-[11.5px] mb-2" style={{ color: "rgba(234,242,255,0.7)" }}>
              <b>{est.runtime}</b> · {String(style).replace(/_/g, " ")} style · Estimated AI usage: <b style={{ color: ORANGE }}>${est.estimated_cost}</b> ({est.model})</p>
            <p className="text-[11px] mb-3" style={{ color: "rgba(234,242,255,0.55)" }}>“{idea.slice(0, 180)}”</p>
            <div className="flex gap-2">
              <button className="px-5 py-2 rounded-full font-bold text-xs" style={{ background: GREEN, color: "#0a0a0a" }}
                onClick={create} disabled={busy} data-testid="gamemaker-create-btn">
                <Gamepad2 size={13} className="inline mr-1" /> Create My Game</button>
              <button className="px-4 py-2 rounded-full text-xs" style={{ border: "1px solid rgba(255,255,255,0.2)" }}
                onClick={() => setEst(null)} data-testid="gamemaker-cancel-est">Cancel</button>
            </div>
          </div>
        )}

        {/* Persistent job progress — survives refresh */}
        {job && (
          <div className="rounded-2xl p-4 mb-6" data-testid="gamemaker-job-progress"
            style={{ border: `1.5px solid ${BLUE}88`, background: "rgba(46,160,255,0.05)" }}>
            <div className="flex items-center gap-2 mb-2">
              {job.phase === "completed" ? <CheckCircle2 size={16} style={{ color: GREEN }} />
                : job.phase === "failed" ? <XCircle size={16} style={{ color: "#FF5A6E" }} />
                : <Loader2 size={16} className="animate-spin" style={{ color: BLUE }} />}
              <b className="text-sm capitalize" data-testid="gamemaker-job-phase">{job.phase.replace(/_/g, " ")}</b>
              <span className="text-[11px] ml-auto" style={{ color: "rgba(234,242,255,0.6)" }}>{job.pct || 0}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${job.pct || 2}%`, background: `linear-gradient(90deg, ${BLUE}, ${GREEN})` }} />
            </div>
            {job.note && <p className="text-[10.5px] mt-1.5" style={{ color: "rgba(234,242,255,0.55)" }}>{job.note}</p>}
            {job.error && <p className="text-[11px] mt-1.5" style={{ color: "#FF8A9A" }} data-testid="gamemaker-job-error">{job.error}</p>}
            <div className="flex gap-2 mt-3">
              {job.phase === "completed" && (
                <button className="px-4 py-1.5 rounded-full font-bold text-xs" style={{ background: GREEN, color: "#0a0a0a" }}
                  onClick={() => navigate(job.result?.game_id ? `/games?play=${job.result.game_id}` : "/gamemaker")}
                  data-testid="gamemaker-open-game">▶ Open My Game</button>)}
              {job.phase === "failed" && (
                <button className="px-4 py-1.5 rounded-full text-xs font-bold" style={{ border: `1px solid ${BLUE}`, color: BLUE }}
                  onClick={async () => { const r = await apiClient.post(`/jobs/${job.id}/retry`); setJob({ id: r.data.job_id, phase: "queued", pct: 0 }); pollJob(r.data.job_id); }}
                  data-testid="gamemaker-retry-job"><RotateCcw size={11} className="inline mr-1" />Retry</button>)}
              {!["completed", "failed", "cancelled"].includes(job.phase) && (
                <button className="px-4 py-1.5 rounded-full text-xs" style={{ border: "1px solid rgba(255,255,255,0.25)" }}
                  onClick={async () => { await apiClient.post(`/jobs/${job.id}/cancel`).catch(() => {}); }}
                  data-testid="gamemaker-cancel-job">Cancel</button>)}
              <button className="px-4 py-1.5 rounded-full text-xs ml-auto" style={{ border: "1px solid rgba(255,255,255,0.15)" }}
                onClick={() => { setJob(null); clearInterval(pollRef.current); localStorage.removeItem("gm.activeJob"); }}
                data-testid="gamemaker-dismiss-job">Dismiss</button>
            </div>
          </div>
        )}

        {user && !locked && (
          <div className="text-center">
            <button className="text-[11px] underline" style={{ color: "rgba(234,242,255,0.55)" }}
              onClick={() => navigate("/gamemaker/saved")} data-testid="gamemaker-saved-link">My Saved Games →</button>
          </div>
        )}
      </div>
    </div>
  );
}

const fallbackStyles = [
  { key: "pixel_art", name: "Pixel Art", description: "Classic retro pixels — charming & timeless." },
  { key: "hand_drawn_2d", name: "Hand-Drawn 2D", description: "Illustrated, expressive & full of character." },
  { key: "cartoon", name: "Cartoon", description: "Bold, colorful & fun for all ages." },
  { key: "anime", name: "Anime", description: "Stylized Japanese anime — vibrant & dynamic." },
  { key: "comic_book", name: "Comic Book", description: "Bold lines, cell shading & high impact." },
  { key: "low_poly", name: "Low Poly", description: "Clean, lightweight & performance friendly." },
  { key: "stylized_3d", name: "3D Stylized", description: "Real-time 3D with a stylized look." },
  { key: "chibi", name: "Chibi", description: "Cute, playful & full of personality." },
  { key: "watercolor", name: "Watercolor", description: "Painted by hand, beautiful & unique." },
  { key: "ink_brush", name: "Ink Brush", description: "Elegant ink brush & traditional feel." },
];
const fallbackRuntimes = [
  { key: "action_rpg_2_5d", name: "Action RPG 2.5D", description: "Real-time combat, spells, quests, bosses, loot & more.", status: "live" },
  { key: "turn_based_creature_rpg", name: "Turn-Based Creature RPG", description: "Capture creatures, train, evolve & battle in turn-based adventures.", status: "live" },
  { key: "platformer", name: "Platformer", description: "Classic side-scrolling platform action.", status: "live" },
  { key: "top_down_adventure", name: "Top-Down Adventure", description: "Explore, solve puzzles, fight enemies, collect items & more.", status: "live" },
  { key: "open_world_rpg", name: "Open World RPG", description: "Large seamless worlds, quests, factions, dynamic events & more.", status: "planned" },
  { key: "card_battle", name: "Card Battle", description: "Strategic card battles with decks, mana & abilities.", status: "live" },
  { key: "tower_defense", name: "Tower Defense", description: "Build towers, defend your base, upgrade & survive waves.", status: "live" },
  { key: "match3", name: "Match-3 Puzzle", description: "Swap, match, combo & achieve high scores.", status: "live" },
  { key: "racing", name: "Racing", description: "High-speed races, tracks, upgrades & challenges.", status: "live" },
  { key: "shooter", name: "Shooter", description: "FPS or TPS combat, weapons, AI, missions & more.", status: "planned" },
];
