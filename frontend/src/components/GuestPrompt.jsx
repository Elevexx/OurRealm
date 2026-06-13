import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import Logo from "@/components/Logo";

/**
 * Modal shown when a guest attempts a restricted action (post, like, comment, etc.)
 */
export default function GuestPrompt({ open, onClose, action = "do this" }) {
  const navigate = useNavigate();
  const { setGuest } = useAuth();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      data-testid="guest-prompt"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="or-surface w-full max-w-md p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <Logo size={36} />
          <div>
            <div className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              Realm access
            </div>
            <h3 className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
              Join OurRealm to {action}
            </h3>
          </div>
        </div>
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>
          You're browsing as a guest. Create a free account to post, follow creators, save widgets,
          customize your profile, and unlock the full OurRealm experience.
        </p>
        <div className="flex gap-3">
          <button
            className="or-btn flex-1"
            data-testid="guest-prompt-signup"
            onClick={() => { setGuest(false); onClose?.(); navigate("/signup"); }}
          >
            Create account
          </button>
          <button
            className="or-btn or-btn-ghost flex-1"
            data-testid="guest-prompt-signin"
            onClick={() => { setGuest(false); onClose?.(); navigate("/signin"); }}
          >
            Sign in
          </button>
        </div>
        <button
          className="block mx-auto mt-4 text-xs"
          style={{ color: "var(--text-muted)" }}
          data-testid="guest-prompt-keep-browsing"
          onClick={onClose}
        >
          Keep browsing as guest
        </button>
      </div>
    </div>
  );
}
