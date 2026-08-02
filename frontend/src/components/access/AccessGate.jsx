import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Wrench, Lock, MailQuestion, Sparkles, ShieldAlert, Home } from "lucide-react";
import apiClient from "@/api/client";
import { useAccessControl } from "@/contexts/AccessControlContext";

// AccessGate — wraps every RC/ORAi page. Renders the founder-configured
// screen for the feature's current mode. The BACKEND independently
// enforces every restriction; this only shapes the user experience.

function Screen({ Icon, iconColor, title, message, testid, children }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4" data-testid={testid}>
      <div className="or-surface p-8 max-w-md w-full text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${iconColor} 15%, transparent)` }}>
          <Icon size={28} style={{ color: iconColor }} aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "var(--font-display)" }}>{title}</h1>
        <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>{message}</p>
        {children}
        <button className="or-btn or-btn-ghost text-xs mt-4 inline-flex items-center gap-1.5"
          onClick={() => navigate("/home")} data-testid="access-gate-home-btn">
          <Home size={14} /> Back to Home
        </button>
      </div>
    </div>
  );
}

function PreviewScreen({ message }) {
  const [demo, setDemo] = useState(null);
  useEffect(() => {
    apiClient.get("/access-control/preview-demo").then((r) => setDemo(r.data)).catch(() => {});
  }, []);
  return (
    <div className="min-h-[60vh] px-4 py-8 max-w-2xl mx-auto" data-testid="access-gate-preview">
      <div className="or-surface p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={20} style={{ color: "var(--brand-blue)" }} aria-hidden="true" />
          <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Preview</h1>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {message || "You're viewing a preview. Live access is not open yet."}
        </p>
        {demo && (
          <div className="space-y-4" data-testid="access-preview-demo-content">
            <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: "rgba(46,160,255,0.1)", color: "var(--brand-blue)" }}>
              {demo.notice}
            </div>
            <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="font-bold text-sm">{demo.center?.name}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{demo.center?.description}</div>
            </div>
            <div>
              <div className="text-xs font-bold mb-1.5">Sample responsibilities</div>
              {(demo.sample_tasks || []).map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-xs border-b" style={{ borderColor: "var(--border-col)" }}>
                  <span>{t.title}</span>
                  <span className="uppercase text-[10px]" style={{ color: "var(--text-muted)" }}>{t.status?.replace("_", " ")}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(demo.capabilities || []).map((c, i) => (
                <span key={i} className="text-[10px] px-2 py-1 rounded-full" style={{ background: "rgba(16,230,112,0.1)", color: "var(--brand-green, #10E670)" }}>{c}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccessGate({ feature = "responsibility_center", children }) {
  const { getState, loading } = useAccessControl();
  const st = getState(feature);

  if (loading) return children;

  if (st.screen === "hidden") {
    return (
      <Screen Icon={ShieldAlert} iconColor="#FF6B6B" title="Page not found"
        message="The page you're looking for doesn't exist or isn't available."
        testid="access-gate-hidden" />
    );
  }
  if (st.screen === "maintenance") {
    return (
      <Screen Icon={Wrench} iconColor="#F4A73B" title="Under maintenance"
        message={st.message || "This area is under maintenance. Please check back soon."}
        testid="access-gate-maintenance" />
    );
  }
  if (st.screen === "locked") {
    return (
      <Screen Icon={Lock} iconColor="#FF6B6B" title="Temporarily locked"
        message={st.message || "This area is temporarily locked. All of your data is safe."}
        testid="access-gate-locked" />
    );
  }
  if (st.screen === "invite_only") {
    return (
      <Screen Icon={MailQuestion} iconColor="var(--brand-blue)" title="Invite only"
        message={st.message || "This area is currently open to invited members only."}
        testid="access-gate-invite" />
    );
  }
  if (st.screen === "preview") {
    return <PreviewScreen message={st.message} />;
  }

  return (
    <>
      {st.screen === "view_only" && (
        <div className="sticky top-0 z-30 px-4 py-2 flex items-center justify-center gap-2 text-xs font-semibold"
          style={{ background: "rgba(244,167,59,0.14)", color: "#F4A73B", borderBottom: "1px solid rgba(244,167,59,0.3)" }}
          data-testid="access-view-only-banner" role="status">
          <Eye size={14} aria-hidden="true" />
          <span>{st.message || "View Only — changes are temporarily disabled."}</span>
        </div>
      )}
      {st.bypass && st.mode !== "full_access" && (
        <div className="sticky top-0 z-30 px-4 py-1.5 flex items-center justify-center gap-2 text-[11px] font-semibold"
          style={{ background: "rgba(16,230,112,0.12)", color: "var(--brand-green, #10E670)", borderBottom: "1px solid rgba(16,230,112,0.25)" }}
          data-testid="access-bypass-chip" role="status">
          <ShieldAlert size={12} aria-hidden="true" />
          <span>Founder bypass active — this area is in "{st.mode.replace("_", " ")}" mode for everyone else.</span>
        </div>
      )}
      {children}
    </>
  );
}
