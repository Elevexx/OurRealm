import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "@/components/Logo";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

const FOUNDER_EMAIL = "slopestyle2022@gmail.com";

export default function SignIn() {
  const [email, setEmail] = useState("admin@ourrealm.app");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, refreshMe } = useAuth();
  const navigate = useNavigate();

  // OTP state
  const [otpMode, setOtpMode] = useState(false);
  const [otpDisplayed, setOtpDisplayed] = useState("");
  const [otpInput, setOtpInput] = useState("");

  const isFounder = email.trim().toLowerCase() === FOUNDER_EMAIL;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) navigate("/feed");
    else setError(res.error);
  };

  const requestOtp = async () => {
    setError(""); setLoading(true);
    try {
      const { data } = await apiClient.post("/auth/otp/request", { email });
      setOtpDisplayed(data.displayed_otp || "");
      setOtpMode(true);
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    setError(""); setLoading(true);
    try {
      const { data } = await apiClient.post("/auth/otp/verify", { email, code: otpInput });
      try { if (data.access_token) localStorage.setItem("ourrealm.access", data.access_token); } catch {/* */}
      await refreshMe();
      navigate("/profile/stealth");
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" data-testid="signin-page">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6"><Logo size={72} /></div>
        <div className="or-surface p-7 sm:p-8 grain">
          <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Welcome back</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Sign in to enter your Realm.
          </p>

          {!otpMode && (
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                type="email" placeholder="Email" required
                value={email} onChange={(e) => { setEmail(e.target.value); setOtpDisplayed(""); }}
                className="or-input" data-testid="signin-email" autoComplete="email"
              />
              {!isFounder && (
                <input
                  type="password" placeholder="Password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="or-input" data-testid="signin-password" autoComplete="current-password"
                />
              )}
              {error && (
                <div className="text-sm px-3 py-2" data-testid="signin-error"
                  style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}>
                  {error}
                </div>
              )}
              {isFounder ? (
                <button type="button" disabled={loading} className="or-btn w-full" data-testid="signin-otp-request" onClick={requestOtp}>
                  {loading ? "Sending…" : "Continue with OTP"}
                </button>
              ) : (
                <button type="submit" disabled={loading} className="or-btn w-full" data-testid="signin-submit">
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              )}
            </form>
          )}

          {otpMode && (
            <div className="space-y-3" data-testid="signin-otp-panel">
              {otpDisplayed && (
                <div className="or-surface p-3 text-center" style={{ background: "color-mix(in srgb, var(--primary) 12%, transparent)", border: "1px solid var(--primary)" }} data-testid="signin-otp-displayed">
                  <div className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Your one-time code</div>
                  <div className="text-3xl mt-1 tracking-[0.4em]" style={{ fontFamily: "var(--font-display)", color: "var(--primary)" }}>
                    {otpDisplayed}
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>Expires in 10 minutes</div>
                </div>
              )}
              <input
                type="text" inputMode="numeric" maxLength={6} placeholder="Enter 6-digit code"
                value={otpInput} onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                className="or-input text-center tracking-[0.3em] text-lg" data-testid="signin-otp-input"
              />
              {error && (
                <div className="text-sm px-3 py-2" style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}>
                  {error}
                </div>
              )}
              <button className="or-btn w-full" disabled={loading || otpInput.length !== 6} onClick={verifyOtp} data-testid="signin-otp-verify">
                {loading ? "Verifying…" : "Verify & enter"}
              </button>
              <button className="text-xs underline w-full text-center" onClick={() => { setOtpMode(false); setOtpInput(""); setOtpDisplayed(""); }} style={{ color: "var(--text-muted)" }} data-testid="signin-otp-back">
                ← Use a different email
              </button>
            </div>
          )}

          {!otpMode && (
            <div className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
              New to OurRealm? <Link to="/signup" className="underline" data-testid="signin-signup-link" style={{ color: "var(--primary)" }}>Create an account</Link>
            </div>
          )}
        </div>
        <div className="text-center mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <Link to="/" className="underline">← Back to landing</Link>
        </div>
      </div>
    </div>
  );
}
