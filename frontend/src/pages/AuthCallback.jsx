/**
 * AuthCallback — processes the Emergent Auth `#session_id=` fragment.
 * NEW Google users must accept the same legal agreements as email signup
 * (ComplianceCheckboxes) BEFORE their account is created.
 *
 * REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
 * THIS BREAKS THE AUTH
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { ComplianceCheckboxes } from "@/components/ComplianceCheckboxes";

export default function AuthCallback() {
  // useRef (not useState) — set synchronously so StrictMode double-mount
  // never exchanges the same session_id twice.
  const hasProcessed = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const [error, setError] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [accepted, setAccepted] = useState({ tos: false, conditions: false, privacy: false, age: false });
  const [busy, setBusy] = useState(false);
  const allAccepted = accepted.tos && accepted.conditions && accepted.privacy && accepted.age;

  const completeLogin = async (data) => {
    try { if (data.access_token) localStorage.setItem("ourrealm.access", data.access_token); } catch { /* ignore */ }
    await refreshMe();
    navigate("/feed", { replace: true });
  };

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    const params = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    const sessionId = params.get("session_id");
    (async () => {
      if (!sessionId) {
        navigate("/signin", { replace: true });
        return;
      }
      try {
        const { data } = await apiClient.post("/auth/google/session", { session_id: sessionId });
        if (data.requires_terms) {
          setPendingToken(data.pending_token);
          return;
        }
        await completeLogin(data);
      } catch (e) {
        setError(formatApiErrorDetail(e?.response?.data?.detail) || "Google sign-in failed. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptAndContinue = async () => {
    if (!allAccepted || busy) return;
    setBusy(true);
    try {
      const { data } = await apiClient.post("/auth/google/session", {
        pending_token: pendingToken,
        accepted_terms: accepted.tos,
        accepted_conditions: accepted.conditions,
        accepted_privacy: accepted.privacy,
        age_confirmed_13: accepted.age,
      });
      await completeLogin(data);
    } catch (e) {
      setError(formatApiErrorDetail(e?.response?.data?.detail) || "Google sign-in failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" data-testid="auth-callback">
      <div className="or-surface p-8 text-center max-w-sm w-full">
        {error ? (
          <>
            <div className="text-sm mb-4" style={{ color: "#FF8080" }} data-testid="auth-callback-error">{error}</div>
            <button className="or-btn w-full" onClick={() => navigate("/signin", { replace: true })} data-testid="auth-callback-back">
              Back to sign in
            </button>
          </>
        ) : pendingToken ? (
          <div className="text-left">
            <h3 className="text-lg mb-1" style={{ fontFamily: "var(--font-display)" }}>One last step</h3>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              To finish creating your OurRealm account, please review and accept:
            </p>
            <ComplianceCheckboxes
              idPrefix="google"
              values={accepted}
              onChange={(key, v) => setAccepted((s) => ({ ...s, [key]: v }))}
            />
            <button
              className="or-btn w-full mt-4"
              disabled={!allAccepted || busy}
              style={{ opacity: allAccepted ? 1 : 0.5, minHeight: 44 }}
              onClick={acceptAndContinue}
              data-testid="google-terms-continue"
            >
              {busy ? <Loader2 size={14} className="animate-spin inline" /> : "Agree & create my account"}
            </button>
            <button
              className="or-btn or-btn-ghost w-full mt-2"
              disabled={busy}
              onClick={() => navigate("/signin", { replace: true })}
              data-testid="google-terms-cancel"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <Loader2 className="animate-spin mx-auto mb-3" style={{ color: "var(--primary)" }} />
            <div className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="auth-callback-loading">
              Signing you in…
            </div>
          </>
        )}
      </div>
    </div>
  );
}
