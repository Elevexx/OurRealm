/**
 * InstallPrompt — friendly "Download OurRealm to your phone" modal.
 * - Android/Chromium: uses the standard `beforeinstallprompt` event.
 * - iOS/Safari: shows the "Share → Add to Home Screen" instructional UI.
 * - Dismissals are remembered in localStorage so we don't annoy returning users.
 * - Styled with current OurRealm surfaces; respects mode colors via CSS vars.
 */
import React, { useEffect, useState } from "react";
import { Share, Plus, X, Smartphone, Download } from "lucide-react";

const DISMISS_KEY = "or.installPromptDismissedAt";
const DISMISS_TTL_DAYS = 14;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator?.standalone === true;
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/.test(ua);
}

function dismissedRecently() {
  try {
    const v = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (!v) return false;
    return (Date.now() - v) < DISMISS_TTL_DAYS * 24 * 3600 * 1000;
  } catch { return false; }
}

export default function InstallPrompt({ trigger = "auto", testid = "install-prompt" }) {
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState(null);  // Android beforeinstallprompt event

  useEffect(() => {
    if (isStandalone()) return;
    const onBIP = (e) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", onBIP);
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  useEffect(() => {
    if (isStandalone()) return;
    if (dismissedRecently()) return;
    if (trigger === "manual") return;
    // Show after a short delay so it doesn't interrupt the first paint
    const id = setTimeout(() => setOpen(true), trigger === "signup" ? 1500 : 5500);
    return () => clearTimeout(id);
  }, [trigger]);

  const close = (remember = true) => {
    setOpen(false);
    if (remember) {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    }
  };

  const installAndroid = async () => {
    if (!deferred) return;
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === "accepted") setOpen(false);
    } catch { /* ignore */ }
    setDeferred(null);
  };

  if (!open) return null;
  const ios = isIOS();

  return (
    <div
      className="fixed inset-0 z-[260] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
      onClick={() => close(true)}
      data-testid={testid}
    >
      <div
        className="or-surface w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
      >
        <div className="flex items-start gap-3 mb-3">
          <img
            src="/icon-192.png?v=3"
            alt="OurRealm"
            className="rounded-2xl shrink-0"
            style={{ width: 56, height: 56, boxShadow: "0 6px 22px rgba(46,160,255,0.45)" }}
            data-testid={`${testid}-icon`}
          />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-[0.32em]" style={{ color: "var(--primary)" }}>
              Get the app
            </div>
            <h3 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
              Add OurRealm to your Home Screen
            </h3>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Faster launch, full-screen mode, and instant access to your Realm.
            </p>
          </div>
          <button
            onClick={() => close(true)}
            className="starbar-icon"
            style={{ width: 32, height: 32 }}
            data-testid={`${testid}-close`}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {ios ? (
          <ol className="space-y-2.5 mb-2 text-sm" data-testid={`${testid}-ios-steps`} style={{ color: "var(--text-main)" }}>
            <li className="flex items-center gap-3">
              <span className="rounded-full p-2 shrink-0"
                style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)" }}>
                <Share size={16} />
              </span>
              Tap the <strong>Share</strong> button at the bottom of Safari.
            </li>
            <li className="flex items-center gap-3">
              <span className="rounded-full p-2 shrink-0"
                style={{ background: "color-mix(in srgb, var(--brand-green) 18%, transparent)", color: "var(--brand-green)" }}>
                <Plus size={16} />
              </span>
              Choose <strong>Add to Home Screen</strong>.
            </li>
            <li className="flex items-center gap-3">
              <span className="rounded-full p-2 shrink-0"
                style={{ background: "color-mix(in srgb, var(--primary) 18%, transparent)", color: "var(--primary)" }}>
                <Smartphone size={16} />
              </span>
              Tap <strong>Add</strong> — OurRealm lives on your phone.
            </li>
          </ol>
        ) : deferred ? (
          <button
            onClick={installAndroid}
            className="or-btn w-full"
            style={{ padding: "0.7rem 1rem", marginTop: 4 }}
            data-testid={`${testid}-android-install`}
          >
            <Download size={16} /> Install OurRealm
          </button>
        ) : (
          <div className="text-sm py-2" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-fallback`}>
            Open the browser menu and choose <strong>“Add to Home Screen”</strong> or <strong>“Install app”</strong> to drop OurRealm on your phone.
          </div>
        )}

        <button
          onClick={() => close(true)}
          className="or-btn or-btn-ghost w-full mt-3 text-sm"
          data-testid={`${testid}-not-now`}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
