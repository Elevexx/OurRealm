import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "@/components/Logo";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useAuth } from "@/contexts/AuthContext";

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    const res = await register(email, password, name);
    setLoading(false);
    if (res.ok) navigate("/home");
    else setError(res.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" data-testid="signup-page">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-4"><Logo size={56} withWordmark /></div>
        <div className="flex justify-center mb-6"><ModeSwitcher /></div>
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
            <button type="submit" disabled={loading} className="or-btn w-full" data-testid="signup-submit">
              {loading ? "Creating account…" : "Join OurRealm"}
            </button>
          </form>
          <p className="text-[11px] mt-4" style={{ color: "var(--text-muted)" }}>
            By signing up you agree to OurRealm's Terms and Privacy Policy. Social sign-in
            (Google, Apple, X, Discord, Facebook) coming soon.
          </p>
          <div className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
            Already a member? <Link to="/signin" className="underline" data-testid="signup-signin-link" style={{ color: "var(--primary)" }}>Sign in</Link>
          </div>
        </div>
        <div className="text-center mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <Link to="/" className="underline">← Back to landing</Link>
        </div>
      </div>
    </div>
  );
}
