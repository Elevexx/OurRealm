/**
 * AuthCallback — processes the Emergent Auth `#session_id=` fragment.
 *
 * REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS,
 * THIS BREAKS THE AUTH
 */
import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import apiClient, { formatApiErrorDetail } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallback() {
  // useRef (not useState) — set synchronously so StrictMode double-mount
  // never exchanges the same session_id twice.
  const hasProcessed = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const [error, setError] = useState("");

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
        try { if (data.access_token) localStorage.setItem("ourrealm.access", data.access_token); } catch { /* ignore */ }
        await refreshMe();
        navigate("/feed", { replace: true });
      } catch (e) {
        setError(formatApiErrorDetail(e?.response?.data?.detail) || "Google sign-in failed. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-4" data-testid="auth-callback">
      <div className="or-surface p-8 text-center max-w-sm w-full">
        {!error ? (
          <>
            <Loader2 className="animate-spin mx-auto mb-3" style={{ color: "var(--primary)" }} />
            <div className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="auth-callback-loading">
              Signing you in…
            </div>
          </>
        ) : (
          <>
            <div className="text-sm mb-4" style={{ color: "#FF8080" }} data-testid="auth-callback-error">{error}</div>
            <button className="or-btn w-full" onClick={() => navigate("/signin", { replace: true })} data-testid="auth-callback-back">
              Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
