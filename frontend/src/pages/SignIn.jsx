import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "@/components/Logo";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useAuth } from "@/contexts/AuthContext";

export default function SignIn() {
  const [email, setEmail] = useState("admin@ourrealm.app");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (res.ok) navigate("/feed");
    else setError(res.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" data-testid="signin-page">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-4"><Logo size={56} withWordmark /></div>
        <div className="flex justify-center mb-6"><ModeSwitcher /></div>
        <div className="or-surface p-7 sm:p-8 grain">
          <h2 className="text-2xl mb-1" style={{ fontFamily: "var(--font-display)" }}>Welcome back</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            Sign in to enter your Realm.
          </p>
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email" placeholder="Email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="or-input" data-testid="signin-email" autoComplete="email"
            />
            <input
              type="password" placeholder="Password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="or-input" data-testid="signin-password" autoComplete="current-password"
            />
            <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
              <label className="flex items-center gap-2" data-testid="signin-remember">
                <input type="checkbox" defaultChecked /> Remember me
              </label>
              <Link to="/forgot" className="underline" data-testid="signin-forgot-link">Forgot?</Link>
            </div>
            {error && (
              <div className="text-sm px-3 py-2" data-testid="signin-error"
                style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="or-btn w-full" data-testid="signin-submit">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <div className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
            New to OurRealm? <Link to="/signup" className="underline" data-testid="signin-signup-link" style={{ color: "var(--primary)" }}>Create an account</Link>
          </div>
        </div>
        <div className="text-center mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <Link to="/" className="underline">← Back to landing</Link>
        </div>
      </div>
    </div>
  );
}
