/**
 * AvatarPicker — reusable modal to set the current user's profile picture.
 *
 * Two tabs:
 *  - Upload Photo  → /api/images/upload (CDN-rehosted, respects daily limits)
 *  - Post Image URL → /api/images/from-url (re-fetched + rehosted server-side)
 *
 * On success, calls PATCH /api/profile/me { avatar_url } and surfaces the
 * fresh avatar via `refreshMe()` so it updates everywhere the user appears.
 */
import React, { useState } from "react";
import { Upload, Link2, X, Loader2, AlertCircle } from "lucide-react";
import apiClient from "@/api/client";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import { useAuth } from "@/contexts/AuthContext";

export default function AvatarPicker({ open, onClose, onSaved, testid = "avatar-picker" }) {
  const { user, refreshMe } = useAuth();
  const [tab, setTab] = useState("device"); // device | url
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(null);   // local data URL while picking

  if (!open) return null;

  const current = absoluteImageUrl(user?.avatar_url)
    || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.name || "u")}`;

  const persist = async (avatarUrl) => {
    const { data } = await apiClient.patch("/profile/me", { avatar_url: avatarUrl });
    if (refreshMe) await refreshMe();
    onSaved?.(data?.user?.avatar_url || avatarUrl);
    onClose?.();
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr("Image too large (max 10 MB)"); return; }
    // Local preview so the user sees what they're about to save.
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result || null);
    reader.readAsDataURL(f);
    uploadFile(f);
  };

  const uploadFile = async (file) => {
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await apiClient.post("/images/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const next = data?.url || data?.image?.original_url;
      if (!next) throw new Error("Upload returned no URL");
      await persist(next);
    } catch (e) {
      const code = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (code === 413) setErr(detail || "Image too large — max 3 MB per upload.");
      else if (code === 429) setErr(detail || "Daily upload limit reached.");
      else setErr(detail || "Upload failed.");
    } finally { setBusy(false); }
  };

  const saveFromUrl = async () => {
    const u = url.trim();
    if (!u) { setErr("Paste an image URL."); return; }
    setErr(""); setBusy(true);
    try {
      const { data } = await apiClient.post("/images/from-url", { url: u });
      const next = data?.url || data?.image?.original_url;
      if (!next) throw new Error("Image fetch returned no URL");
      await persist(next);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not fetch that URL.");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(10px)",
        paddingTop: "max(12px, env(safe-area-inset-top))",
        paddingBottom: "max(12px, env(safe-area-inset-bottom))",
        paddingLeft: 12, paddingRight: 12,
      }}
      onClick={onClose}
      data-testid={testid}
    >
      <div
        className="or-surface p-5"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw - 24px, 460px)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)",
          overflow: "auto",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg" style={{ fontFamily: "var(--font-display)", color: "var(--text-main)" }}>
            Change profile picture
          </h3>
          <button className="starbar-icon" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="Close" data-testid={`${testid}-close`}>
            <X size={14} />
          </button>
        </div>

        {/* Preview */}
        <div className="flex justify-center mb-4">
          <img
            src={preview || current}
            alt="Profile preview"
            className="rounded-full object-cover"
            style={{ width: 120, height: 120, border: "3px solid var(--primary)" }}
            data-testid={`${testid}-preview`}
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-3 p-1" style={{ background: "var(--surface-2)", borderRadius: "var(--radius)" }}>
          <button
            className="flex-1 text-xs uppercase tracking-widest py-2 flex items-center justify-center gap-1"
            onClick={() => setTab("device")}
            style={{
              borderRadius: "calc(var(--radius) - 4px)",
              background: tab === "device" ? "var(--primary)" : "transparent",
              color: tab === "device" ? "var(--primary-fg)" : "var(--text-muted)",
            }}
            data-testid={`${testid}-tab-device`}
          >
            <Upload size={12} /> Upload Photo
          </button>
          <button
            className="flex-1 text-xs uppercase tracking-widest py-2 flex items-center justify-center gap-1"
            onClick={() => setTab("url")}
            style={{
              borderRadius: "calc(var(--radius) - 4px)",
              background: tab === "url" ? "var(--primary)" : "transparent",
              color: tab === "url" ? "var(--primary-fg)" : "var(--text-muted)",
            }}
            data-testid={`${testid}-tab-url`}
          >
            <Link2 size={12} /> Post Image URL
          </button>
        </div>

        {tab === "device" ? (
          <div className="space-y-2">
            <label className="block">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onFileChange}
                className="hidden"
                data-testid={`${testid}-file-input`}
              />
              <span
                className="or-btn w-full justify-center cursor-pointer"
                style={{ padding: "0.75rem", display: "inline-flex" }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {busy ? "Uploading…" : "Choose from device"}
              </span>
            </label>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              JPG, PNG, WebP, or GIF. We compress and rehost on our CDN.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="url"
              placeholder="https://example.com/photo.jpg"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="or-input"
              data-testid={`${testid}-url-input`}
              autoFocus
            />
            <button
              className="or-btn w-full justify-center"
              onClick={saveFromUrl}
              disabled={busy}
              style={{ padding: "0.65rem" }}
              data-testid={`${testid}-url-save`}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {busy ? "Saving…" : "Use this URL"}
            </button>
          </div>
        )}

        {err && (
          <div
            className="mt-3 flex items-start gap-2 text-xs px-3 py-2"
            style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}
            data-testid={`${testid}-error`}
          >
            <AlertCircle size={14} className="shrink-0 mt-px" /> {err}
          </div>
        )}
      </div>
    </div>
  );
}
