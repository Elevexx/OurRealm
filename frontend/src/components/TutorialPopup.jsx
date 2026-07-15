/**
 * TutorialPopup — live swipe-through onboarding for eligible users.
 * Fetches /api/tutorial/active once per session; server decides
 * eligibility (audience + version + completion). Progress is stored
 * server-side; localStorage is only a fast "already done" hint.
 *
 * Also usable in founder preview mode: <TutorialPopup preview={draft} />.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

const LS_KEY = "ourrealm.tutorial.done.v";

export default function TutorialPopup({ preview = null, onClosePreview }) {
  const { user, guest } = useAuth();
  const navigate = useNavigate();
  const [tut, setTut] = useState(preview);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(!!preview);
  const videoRef = useRef(null);
  const touchX = useRef(null);
  const isPreview = !!preview;

  useEffect(() => {
    if (isPreview || !user?.id || guest) return;
    let on = true;
    (async () => {
      try {
        const { data } = await apiClient.get("/tutorial/active");
        const t = data?.tutorial;
        if (!on || !t || !(t.slides || []).length) return;
        if (localStorage.getItem(LS_KEY) === String(t.version)) return; // perf hint only
        setTut(t);
        const delay = t.settings?.show_delay_ms ?? 800;
        setTimeout(() => { if (on) { setOpen(true); apiClient.post("/tutorial/progress/start", { version: t.version }).catch(() => {}); } }, delay);
      } catch { /* never block the app */ }
    })();
    return () => { on = false; };
  }, [user?.id, guest, isPreview]);

  const slides = tut?.slides || [];
  const settings = tut?.settings || {};
  const slide = slides[idx];

  const report = useCallback((path, extra = {}) => {
    if (isPreview || !tut?.version) return;
    apiClient.post(`/tutorial/progress/${path}`, { version: tut.version, last_slide_index: idx, ...extra }).catch(() => {});
  }, [isPreview, tut?.version, idx]);

  const close = useCallback(() => {
    setOpen(false);
    if (videoRef.current) { try { videoRef.current.pause(); } catch { /* */ } }
    if (isPreview) onClosePreview?.();
  }, [isPreview, onClosePreview]);

  const finish = useCallback(() => {
    report("complete");
    if (tut?.version) localStorage.setItem(LS_KEY, String(tut.version));
    close();
  }, [report, tut?.version, close]);

  const skip = useCallback(() => {
    report("skip");
    if (tut?.version) localStorage.setItem(LS_KEY, String(tut.version));
    close();
  }, [report, tut?.version, close]);

  const go = useCallback((next) => {
    setIdx((i) => {
      const n = Math.max(0, Math.min(slides.length - 1, i + next));
      return n;
    });
  }, [slides.length]);

  // report progress + pause videos when the slide changes
  useEffect(() => {
    if (!open) return;
    report("update");
    if (videoRef.current) { try { videoRef.current.pause(); } catch { /* */ } }
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard support
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape" && settings.allow_close !== false) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, close, settings.allow_close]);

  if (!open || !slide) return null;

  const onButton = () => {
    const a = slide.button_action;
    if (a === "next") go(1);
    else if (a === "finish") finish();
    else if (a === "route" && slide.button_target && /^\/[A-Za-z0-9/_-]*$/.test(slide.button_target)) {
      finish();
      navigate(slide.button_target);
    }
  };

  const last = idx === slides.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tut?.name || "Welcome tutorial"}
      className="fixed inset-0 z-[300] flex items-center justify-center px-4 py-5"
      style={{
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
      }}
      data-testid="tutorial-popup"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (dx < -50) go(1);
        else if (dx > 50) go(-1);
        touchX.current = null;
      }}
    >
      <div
        className="or-surface flex flex-col overflow-hidden"
        style={{
          // Centered modal with visible margins on every screen size — the
          // site remains visible behind the popup (desktop AND mobile).
          width: "min(calc(100vw - 32px), 560px)",
          height: "min(calc(100dvh - 40px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)), 680px)",
          maxHeight: "calc(100dvh - 40px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
          borderRadius: "var(--radius)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          background: slide.background || undefined,
        }}
      >
        {/* header row */}
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="text-xs" style={{ color: "var(--text-muted)" }} data-testid="tutorial-counter" aria-live="polite">
            {idx + 1} / {slides.length}
          </span>
          <div className="flex items-center gap-2">
            {settings.allow_skip !== false && !last && (
              <button className="text-xs underline" style={{ color: "var(--text-muted)" }}
                      onClick={skip} data-testid="tutorial-skip" aria-label="Skip tutorial">Skip</button>
            )}
            {settings.allow_close !== false && (
              <button className="starbar-icon" style={{ width: 30, height: 30 }} onClick={isPreview ? close : skip}
                      aria-label="Close tutorial" data-testid="tutorial-close"><X size={14} /></button>
            )}
          </div>
        </div>

        {/* media */}
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-2">
          {slide.media_type === "video" ? (
            <video
              key={slide.id}
              ref={videoRef}
              src={resolveMediaUrl(slide.media_url)}
              poster={slide.poster_url ? resolveMediaUrl(slide.poster_url) : undefined}
              controls={slide.show_controls !== false}
              autoPlay={slide.autoplay !== false}
              muted={slide.autoplay !== false ? true : !!slide.muted}
              loop={!!slide.loop}
              playsInline
              className="max-h-full max-w-full"
              style={{ borderRadius: "calc(var(--radius) - 4px)", objectFit: "contain" }}
              aria-label={slide.alt_text || slide.title || "Tutorial video"}
              data-testid={`tutorial-video-${slide.id}`}
            />
          ) : (
            <img
              src={resolveMediaUrl(slide.media_url)}
              alt={slide.alt_text || slide.title || "Tutorial slide"}
              className="max-h-full max-w-full"
              loading="lazy"
              style={{ borderRadius: "calc(var(--radius) - 4px)", objectFit: slide.image_fit || "cover" }}
              data-testid={`tutorial-image-${slide.id}`}
            />
          )}
        </div>

        {/* text + actions */}
        <div className="px-5 pb-4" style={{ textAlign: slide.text_align || "center" }}>
          {slide.title && <div className="text-lg font-bold mb-1" style={{ color: "var(--text-main)", fontFamily: "var(--font-display)" }} data-testid="tutorial-title">{slide.title}</div>}
          {slide.description && <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>{slide.description}</div>}
          {slide.button_label && slide.button_action !== "none" && (
            <button className="or-btn mb-2" onClick={onButton} data-testid="tutorial-slide-button">{slide.button_label}</button>
          )}

          <div className="flex items-center justify-between mt-1">
            <button className="starbar-icon" style={{ width: 38, height: 38, opacity: idx === 0 ? 0.3 : 1 }}
                    disabled={idx === 0} onClick={() => go(-1)} aria-label="Previous slide" data-testid="tutorial-prev">
              <ChevronLeft size={18} />
            </button>
            {settings.show_progress !== false && (
              <div className="flex gap-1.5" role="tablist" aria-label="Slide progress">
                {slides.map((s, i) => (
                  <button key={s.id} onClick={() => setIdx(i)} aria-label={`Go to slide ${i + 1}`}
                          role="tab" aria-selected={i === idx}
                          className="rounded-full"
                          style={{ width: 8, height: 8, background: i === idx ? "var(--primary)" : "var(--surface-2)" }}
                          data-testid={`tutorial-dot-${i}`} />
                ))}
              </div>
            )}
            {last ? (
              <button className="or-btn" onClick={finish} data-testid="tutorial-finish" style={{ padding: "0.45rem 1rem" }}>Finish</button>
            ) : (
              <button className="starbar-icon" style={{ width: 38, height: 38 }} onClick={() => go(1)}
                      aria-label="Next slide" data-testid="tutorial-next">
                <ChevronRight size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
