/**
 * Reusable Image Upload modal — opens whenever the user taps "Images"
 * (or any other surface that wants to add an image). Two tabs:
 *  - Upload from device      → multipart POST /api/images/upload
 *  - Upload via image URL    → POST   /api/images/from-url (re-hosted)
 *
 * Returns the hosted URL via the `onPicked(url)` callback. Callers can use
 * the absolute hosted URL anywhere (posts, profiles, messages, comments).
 *
 * Note: the API returns relative `/api/images/...` paths. We turn them
 * into absolute URLs against REACT_APP_BACKEND_URL via `absoluteImageUrl`.
 */
import React, { useEffect, useRef, useState } from "react";
import { Upload, Link2, X, Loader2, Image as ImageIcon, AlertCircle } from "lucide-react";
import apiClient from "@/api/client";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export function absoluteImageUrl(maybeRelative) {
  if (!maybeRelative) return maybeRelative;
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (maybeRelative.startsWith("/")) return `${BACKEND}${maybeRelative}`;
  return maybeRelative;
}

export default function ImageUploadPicker({ open, onClose, onPicked, title = "Add an image", testid = "image-picker" }) {
  const [tab, setTab] = useState("device"); // device | url
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const [quota, setQuota] = useState(null); // {used, remaining, per_day} | null
  const fileRef = useRef(null);

  // Fetch remaining daily image quota every time the picker opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/upload-limits/me");
        if (!cancelled) setQuota(data?.limits?.image || null);
      } catch {/* non-fatal */}
    })();
    return () => { cancelled = true; };
  }, [open]);

  const close = () => { if (!busy) onClose?.(); };
  const handle = (rec) => {
    onPicked?.({
      url: absoluteImageUrl(rec.original_url || rec.url),
      thumbnailUrl: absoluteImageUrl(rec.thumbnail_url || rec.thumbnailUrl),
      image: rec.image || rec,
    });
    onClose?.();
  };

  const uploadFile = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setErr("Image is too large (max 10 MB)."); return; }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await apiClient.post("/images/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      // Refresh quota after success
      apiClient.get("/upload-limits/me").then((r) => setQuota(r?.data?.limits?.image || null)).catch(() => {});
      handle(data);
    } catch (e) {
      const code = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (code === 413) setErr(detail || "Image is too large — max 3 MB per upload.");
      else if (code === 429) setErr(detail || "Daily image upload limit reached. Try again later.");
      else setErr(detail || "Upload failed.");
    } finally { setBusy(false); }
  };

  const uploadUrl = async () => {
    const u = url.trim();
    if (!u) { setErr("Paste an image URL."); return; }
    setErr(""); setBusy(true);
    try {
      const { data } = await apiClient.post("/images/from-url", { url: u });
      apiClient.get("/upload-limits/me").then((r) => setQuota(r?.data?.limits?.image || null)).catch(() => {});
      handle(data);
    } catch (e) {
      const code = e?.response?.status;
      const detail = e?.response?.data?.detail;
      if (code === 413) setErr(detail || "Image is too large — max 3 MB per upload.");
      else if (code === 429) setErr(detail || "Daily image upload limit reached. Try again later.");
      else setErr(detail || "Could not fetch that URL.");
    } finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center px-2 sm:px-4 py-4 sm:py-10"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
      onClick={close}
      data-testid={`${testid}-overlay`}
    >
      <div
        className="or-surface w-full sm:max-w-md max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid={testid}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 p-3 sm:p-4" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <ImageIcon size={16} style={{ color: "var(--primary)" }} />
          <div className="font-semibold flex-1" style={{ color: "var(--text-main)" }}>{title}</div>
          <button onClick={close} className="starbar-icon" style={{ width: 32, height: 32 }} aria-label="Close" data-testid={`${testid}-close`}>
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2 p-3" style={{ borderBottom: "1px solid var(--border-col)" }}>
          <button
            type="button"
            onClick={() => { setTab("device"); setErr(""); }}
            className="or-chip flex-1"
            data-active={tab === "device"}
            data-testid={`${testid}-tab-device`}
          >
            <Upload size={12} /> Upload from device
          </button>
          <button
            type="button"
            onClick={() => { setTab("url"); setErr(""); }}
            className="or-chip flex-1"
            data-active={tab === "url"}
            data-testid={`${testid}-tab-url`}
          >
            <Link2 size={12} /> Upload via URL
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          {tab === "device" && (
            <>
              <input
                ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => uploadFile(e.target.files?.[0])}
                style={{ display: "none" }}
                data-testid={`${testid}-file-input`}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="or-btn w-full"
                data-testid={`${testid}-device-pick`}
              >
                {busy ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : <><Upload size={14} /> Choose image</>}
              </button>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                JPG, PNG, WebP, or GIF. Max 3 MB per image. We compress &amp; rehost on our CDN for fast global delivery.
              </p>
              {quota && (
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }} data-testid={`${testid}-quota`}>
                  {quota.remaining === "unlimited"
                    ? "Founder account — unlimited uploads."
                    : `${quota.remaining} of ${quota.per_day} image uploads remaining today.`}
                </p>
              )}
            </>
          )}
          {tab === "url" && (
            <>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                className="or-input w-full"
                inputMode="url"
                autoComplete="off"
                data-testid={`${testid}-url-input`}
              />
              <button
                type="button"
                onClick={uploadUrl}
                disabled={busy || !url.trim()}
                className="or-btn w-full"
                data-testid={`${testid}-url-submit`}
              >
                {busy ? <><Loader2 size={14} className="animate-spin" /> Rehosting…</> : <><Link2 size={14} /> Fetch &amp; rehost</>}
              </button>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                We fetch the image and rehost it on OurRealm. External links are never rendered directly.
              </p>
            </>
          )}
          {err && (
            <div className="flex items-start gap-2 text-xs px-3 py-2"
              style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.4)", color: "#ff8080", borderRadius: "var(--radius)" }}
              data-testid={`${testid}-error`}
            >
              <AlertCircle size={14} /> {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
