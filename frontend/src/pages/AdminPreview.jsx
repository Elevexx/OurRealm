import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Hammer } from "lucide-react";
import apiClient from "@/api/client";

// Admin-only sandboxed viewer for ORAi preview builds. The generated HTML
// runs in an isolated iframe — no cookies, no auth, no production APIs.
export default function AdminPreview() {
  const { buildId } = useParams();
  const navigate = useNavigate();
  const [build, setBuild] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    apiClient.get(`/orai/builds/${buildId}`)
      .then((r) => setBuild(r.data))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load this preview"));
  }, [buildId]);

  if (err) {
    return (
      <div className="max-w-3xl mx-auto or-surface p-8 text-center" data-testid="admin-preview-error">
        <div className="text-sm mb-3" style={{ color: "#FF6B6B" }}>⚠ {err}</div>
        <button className="or-btn text-xs" onClick={() => navigate("/admin")} data-testid="admin-preview-back-err">
          <ArrowLeft size={13} /> Admin Hub
        </button>
      </div>
    );
  }
  if (!build) {
    return <div className="max-w-3xl mx-auto or-surface p-8 text-center"><Loader2 size={18} className="animate-spin inline" /></div>;
  }
  return (
    <div className="max-w-5xl mx-auto pb-10" data-testid="admin-preview-page">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button className="or-btn or-btn-ghost text-xs" onClick={() => navigate(-1)} data-testid="admin-preview-back">
          <ArrowLeft size={13} /> Back
        </button>
        <Hammer size={14} style={{ color: "#2EE6FF" }} />
        <span className="text-sm font-bold" data-testid="admin-preview-title">{build.title}</span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(244,167,59,0.15)", color: "#F4A73B" }}>
          SANDBOXED PREVIEW — ADMIN ONLY, NOT PUBLISHED
        </span>
      </div>
      {build.status !== "complete" ? (
        <div className="or-surface p-8 text-center text-xs" style={{ color: "var(--text-muted)" }} data-testid="admin-preview-status">
          {build.status === "building" ? <><Loader2 size={14} className="animate-spin inline mr-1" /> Still building…</>
            : build.status === "failed" ? `Build failed: ${build.error || "unknown error"}`
            : "This build has not been approved yet."}
        </div>
      ) : (
        <iframe title={build.title} srcDoc={build.spec?.html || ""} sandbox="allow-scripts"
          className="w-full rounded-xl" style={{ height: "78vh", border: "1px solid rgba(46,230,255,0.25)", background: "#0b1220" }}
          data-testid="admin-preview-iframe" />
      )}
    </div>
  );
}
