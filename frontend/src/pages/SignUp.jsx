import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Logo from "@/components/Logo";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import apiClient from "@/api/client";
import { Check, X, Loader2, LogOut } from "lucide-react";

export default function SignUp() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [unCheck, setUnCheck] = useState({ status: "idle", suggestions: [] }); // idle | checking | ok | taken
  // ── Phase-1 compliance acknowledgements ──
  const [acceptedTos, setAcceptedTos] = useState(false);
  const [acceptedConditions, setAcceptedConditions] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const allAccepted = acceptedTos && acceptedConditions && acceptedPrivacy && ageConfirmed;
  const { register, user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLoggedIn = !!user;

  // Deep-link destination — same-origin paths only.
  const nextRaw = searchParams.get("next") || searchParams.get("to") || "";
  const nextPath = (nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//")) ? nextRaw : "";

  // Debounced username availability check
  useEffect(() => {
    if (!username || username.length < 3) {
      setUnCheck({ status: "idle", suggestions: [] });
      return;
    }
    setUnCheck({ status: "checking", suggestions: [] });
    const t = setTimeout(async () => {
      try {
        const { data } = await apiClient.post("/auth/username/check", { username });
        if (data.available) setUnCheck({ status: "ok", suggestions: [] });
        else setUnCheck({ status: "taken", suggestions: data.suggestions || [], message: data.message || "" });
      } catch {
        setUnCheck({ status: "idle", suggestions: [] });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (unCheck.status === "taken") {
      setError("That username is taken — try a suggestion below.");
      return;
    }
    if (!allAccepted) {
      setError("Please accept the Terms, Conditions, Privacy Policy, and confirm you are 13+.");
      return;
    }
    setLoading(true);
    const res = await register(email, password, name, username, {
      accepted_terms: acceptedTos,
      accepted_conditions: acceptedConditions,
      accepted_privacy: acceptedPrivacy,
      age_confirmed_13: ageConfirmed,
      policy_version: "2026-02-1",
    });
    setLoading(false);
    if (res.ok) navigate(nextPath || "/interests");
    else setError(res.error);
  };

  const StatusIcon = () => {
    if (unCheck.status === "checking") return <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />;
    if (unCheck.status === "ok") return <Check size={16} style={{ color: "var(--brand-green)" }} />;
    if (unCheck.status === "taken") return <X size={16} style={{ color: "#FF3F5A" }} />;
    return null;
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" data-testid="signup-page">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-4"><Logo size={56} withWordmark /></div>
        <div className="flex justify-center mb-6"><ModeSwitcher /></div>

        {isLoggedIn && (
          <div
            className="or-surface p-3 mb-4 flex items-center gap-2 flex-wrap"
            data-testid="signup-loggedin-strip"
            style={{ borderColor: "var(--primary)", outline: "1px solid color-mix(in srgb, var(--primary) 32%, transparent)" }}
          >
            <span className="text-xs flex-1 min-w-0" style={{ color: "var(--text-muted)" }}>
              You're signed in as <b style={{ color: "var(--text-main)" }}>@{user.username}</b>
            </span>
            <button
              className="or-btn or-btn-ghost"
              onClick={async () => { await logout(); window.location.reload(); }}
              data-testid="signup-signout"
              style={{ padding: "0.45rem 0.85rem", fontSize: "0.82rem" }}
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        )}

        <div className="or-surface p-7 sm:p-8 grain">
          <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Create your Realm</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Live. Connect. Experience. — claim your handle in seconds.
          </p>
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="text" placeholder="Display name" required minLength={1}
              value={name} onChange={(e) => setName(e.target.value)}
              className="or-input" data-testid="signup-name"
            />
            <div className="relative">
              <input
                type="text" placeholder="Username (a–z, 0–9, . or _)" required minLength={3} maxLength={24}
                pattern="^[a-zA-Z0-9_.]+$"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
                className="or-input pr-9"
                data-testid="signup-username"
                autoComplete="username"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <StatusIcon />
              </div>
            </div>
            {unCheck.status === "taken" && unCheck.message && (
              <p className="text-[11px]" style={{ color: "#ffb84d" }} data-testid="signup-username-message">
                {unCheck.message}
              </p>
            )}
            {unCheck.status === "taken" && unCheck.suggestions?.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="signup-username-suggestions">
                {unCheck.suggestions.slice(0, 4).map((s) => (
                  <button
                    type="button"
                    key={s}
                    className="or-chip"
                    onClick={() => setUsername(s)}
                    data-testid={`signup-suggest-${s}`}
                  >
                    @{s}
                  </button>
                ))}
              </div>
            )}
            <input
              type="email" placeholder="Email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="or-input" data-testid="signup-email" autoComplete="email"
            />
            <input
              type="password" placeholder="Password (min 6 chars)" required minLength={6}
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="or-input" data-testid="signup-password" autoComplete="new-password"
            />
            {error && (
              <div className="text-sm px-3 py-2" data-testid="signup-error"
                style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}>
                {error}
              </div>
            )}
            {/* ── Compliance acknowledgements (Phase 1) ── */}
            <div className="space-y-2 pt-1" data-testid="signup-compliance">
              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox" checked={acceptedTos}
                  onChange={(e) => setAcceptedTos(e.target.checked)}
                  data-testid="signup-accept-tos"
                  style={{ marginTop: 2, accentColor: "var(--primary)" }}
                />
                <span>
                  I have read and agree to the {" "}
                  <Link to="/terms" target="_blank" className="underline" style={{ color: "var(--primary)" }} data-testid="signup-link-terms">Terms of Service</Link>.
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox" checked={acceptedConditions}
                  onChange={(e) => setAcceptedConditions(e.target.checked)}
                  data-testid="signup-accept-conditions"
                  style={{ marginTop: 2, accentColor: "var(--primary)" }}
                />
                <span>
                  I have read and agree to OurRealm's {" "}
                  <Link to="/terms-conditions" target="_blank" className="underline" style={{ color: "var(--primary)" }} data-testid="signup-link-conditions">Terms &amp; Conditions</Link>.
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox" checked={acceptedPrivacy}
                  onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                  data-testid="signup-accept-privacy"
                  style={{ marginTop: 2, accentColor: "var(--primary)" }}
                />
                <span>
                  I have read and agree to the {" "}
                  <Link to="/privacy" target="_blank" className="underline" style={{ color: "var(--primary)" }} data-testid="signup-link-privacy">Privacy Policy</Link>.
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox" checked={ageConfirmed}
                  onChange={(e) => setAgeConfirmed(e.target.checked)}
                  data-testid="signup-accept-age"
                  style={{ marginTop: 2, accentColor: "var(--primary)" }}
                />
                <span>I confirm I am at least <b style={{ color: "var(--text-main)" }}>13 years old</b> (COPPA).</span>
              </label>
            </div>
            <button type="submit" disabled={loading || unCheck.status === "taken" || !allAccepted} className="or-btn w-full" data-testid="signup-submit">
              {loading ? "Creating account…" : "Join OurRealm"}
            </button>
          </form>
          <p className="text-[11px] mt-4" style={{ color: "var(--text-muted)" }}>
            By signing up you agree to OurRealm's Terms and Privacy Policy. Social sign-in
            (Google, Apple, X, Discord, Facebook) coming soon.
          </p>
          <div className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
            Already a member? <Link to={nextPath ? `/signin?next=${encodeURIComponent(nextPath)}` : "/signin"} className="underline" data-testid="signup-signin-link" style={{ color: "var(--primary)" }}>Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
