import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Logo from "@/components/Logo";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import apiClient from "@/api/client";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { ComplianceCheckboxes } from "@/components/ComplianceCheckboxes";
import { Check, X, Loader2, LogOut } from "lucide-react";

export default function SignUp() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [signupsOpen, setSignupsOpen] = useState(true);
  const [resEmail, setResEmail] = useState("");
  const [resUsername, setResUsername] = useState("");
  const [reserved, setReserved] = useState(false);
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

  // Waitlist invitation — prefill + lock the reserved username/email.
  const inviteToken = searchParams.get("invite") || "";
  const [invite, setInvite] = useState(null);
  useEffect(() => {
    if (!inviteToken) return;
    apiClient.get(`/waitlist/public/invite/${inviteToken}`)
      .then(({ data }) => {
        setInvite(data);
        setUsername(data.username);
        setEmail(data.email);
      })
      .catch((e) => setError(e?.response?.data?.detail || "Invalid invitation"));
  }, [inviteToken]); // eslint-disable-line react-hooks/exhaustive-deps

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
      birth_date: birthDate || undefined,
      invite_token: inviteToken || undefined,
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
          <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Join OurRealm</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Live. Connect. Experience. — claim your handle in seconds.
          </p>
          <GoogleSignInButton label="Sign up with Google" divider="below" next={nextPath} />
          {!signupsOpen && !inviteToken ? (
            <div className="space-y-3" data-testid="signup-paused-screen">
              <div className="text-sm px-3 py-2" style={{ background: "rgba(46,160,255,0.08)", border: "1px solid rgba(46,160,255,0.3)", borderRadius: "var(--radius)" }}>
                New signups are currently by reservation. Lock in your username
                on the waitlist and we'll invite you when approved.
              </div>
              <button type="button" className="or-btn or-btn-primary w-full"
                onClick={() => navigate("/waitlist")} data-testid="signup-goto-waitlist">
                Reserve My Username
              </button>
              <button type="button" className="or-btn or-btn-ghost w-full"
                onClick={() => navigate("/waitlist?view=status")} data-testid="signup-check-status">
                Check My Status
              </button>
            </div>
          ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {invite && (
              <div className="text-sm px-3 py-2" data-testid="signup-invite-banner"
                style={{ background: "rgba(244,200,74,0.08)", border: "1px solid rgba(244,200,74,0.4)", borderRadius: "var(--radius)" }}>
                🎉 Your reservation for <b>@{invite.username}</b> was approved — finish
                creating your account below.
              </div>
            )}
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
            <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
              Date of birth (13+ required — never shown publicly)
              <input
                type="date" required value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="or-input w-full mt-1" data-testid="signup-birthdate"
                max={new Date().toISOString().slice(0, 10)}
              />
            </label>
            {error && (
              <div className="text-sm px-3 py-2" data-testid="signup-error"
                style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}>
                {error}
              </div>
            )}
            {/* ── Compliance acknowledgements (Phase 1) ── */}
            <ComplianceCheckboxes
              values={{ tos: acceptedTos, conditions: acceptedConditions, privacy: acceptedPrivacy, age: ageConfirmed }}
              onChange={(key, v) => ({ tos: setAcceptedTos, conditions: setAcceptedConditions, privacy: setAcceptedPrivacy, age: setAgeConfirmed }[key](v))}
            />
            <button type="submit" disabled={loading || unCheck.status === "taken" || !allAccepted} className="or-btn w-full" data-testid="signup-submit">
              {loading ? "Creating account…" : "Join OurRealm"}
            </button>
          </form>
          )}
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
