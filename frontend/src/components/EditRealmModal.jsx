/**
 * EditRealmModal — owner/founder/admin-only editor for Realm settings.
 *
 * Reuses the visual language and field set from CreateRealmModal so
 * the Edit experience feels native. Adds:
 *   • Privacy selector (public / private / invite_only)
 *   • Profile image + Banner URL inputs (uses existing image-upload
 *     pipeline via /api/images/upload).
 *   • Rules/guidelines textarea.
 *   • Destructive "Delete Realm" section gated by an in-modal
 *     confirmation prompt + typed acknowledgement.
 *
 * Patch and Delete authorization is enforced server-side too — the
 * UI gate is convenience only.
 */
import React, { useEffect, useRef, useState } from "react";
import { Loader2, Save, Trash2, X, Upload, AlertTriangle } from "lucide-react";
import apiClient from "@/api/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";

const PRIVACY_OPTIONS = [
  { id: "public",      label: "Public" },
  { id: "private",     label: "Private" },
  { id: "invite_only", label: "Invite only" },
];

export default function EditRealmModal({ realm, onClose, onSaved, onDeleted }) {
  // Esc → close (covers both the form and the danger-zone confirm).
  // Bound to window so it works even when focus is inside an input.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [name, setName]               = useState(realm?.name || "");
  const [description, setDescription] = useState(realm?.description || realm?.desc || "");
  const [banner, setBanner]           = useState(realm?.banner || "");
  const [profileImage, setProfileImage] = useState(realm?.profile_image || "");
  const [accent, setAccent]           = useState(realm?.accent || "#10E670");
  const [tags, setTags]               = useState((realm?.tags || []).join(", "));
  const [privacy, setPrivacy]         = useState(realm?.privacy || "public");
  const [rules, setRules]             = useState(realm?.rules || "");
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState("");

  // Destructive confirm state.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmInput, setConfirmInput]         = useState("");
  const [deleting, setDeleting]                 = useState(false);
  const expectedConfirm = realm?.name || "delete";

  const bannerFileRef  = useRef(null);
  const profileFileRef = useRef(null);
  const [uploading, setUploading] = useState(null);  // 'banner' | 'profile' | null

  const uploadImage = async (file, target) => {
    if (!file) return;
    setUploading(target); setErr("");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await apiClient.post("/images/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = data?.url || data?.image_url || "";
      if (!url) throw new Error("No URL returned from upload");
      if (target === "banner") setBanner(url);
      else                     setProfileImage(url);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Image upload failed");
    } finally { setUploading(null); }
  };

  const save = async (e) => {
    e?.preventDefault?.();
    if (!name.trim()) { setErr("Name is required"); return; }
    setBusy(true); setErr("");
    try {
      const payload = {
        name:          name.trim(),
        description:   description.trim(),
        banner:        banner.trim() || null,
        profile_image: profileImage.trim() || null,
        accent:        accent || "#10E670",
        tags:          tags.split(",").map((t) => t.trim()).filter(Boolean),
        privacy,
        rules:         rules.trim() || null,
      };
      const { data } = await apiClient.patch(`/communities/realms/${realm.id}`, payload);
      onSaved && onSaved(data);
    } catch (e2) {
      setErr(e2?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (deleting) return;
    setDeleting(true); setErr("");
    try {
      await apiClient.delete(`/communities/realms/${realm.id}`);
      onDeleted && onDeleted(realm.id);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
      data-testid="realm-edit-backdrop"
    >
      <form
        onSubmit={save}
        className="or-surface w-full max-w-lg p-5 my-8"
        onClick={(e) => e.stopPropagation()}
        data-testid="realm-edit-modal"
      >
        <div className="flex items-center mb-3">
          <h3 className="flex-1 text-lg" style={{ fontFamily: "var(--font-display)" }}>Edit Realm</h3>
          <button type="button" onClick={onClose} className="or-chip" data-testid="realm-edit-close">
            <X size={12} />
          </button>
        </div>

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Name *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
               className="or-input mb-3" required data-testid="realm-edit-name" />

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} rows={3}
                  className="or-input mb-3" data-testid="realm-edit-description" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Profile image</label>
            <div className="flex items-center gap-2 mt-1">
              {profileImage ? (
                <img src={resolveMediaUrl(profileImage)} alt=""
                     style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border-col)" }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: 8, background: "var(--surface-2)" }} />
              )}
              <input ref={profileFileRef} type="file" accept="image/*" style={{ display: "none" }}
                     onChange={(e) => { uploadImage(e.target.files?.[0], "profile"); e.target.value = ""; }}
                     data-testid="realm-edit-profile-file" />
              <button type="button" onClick={() => profileFileRef.current?.click()}
                      disabled={uploading === "profile"} className="or-chip" data-testid="realm-edit-profile-upload">
                {uploading === "profile" ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Cover banner</label>
            <div className="flex items-center gap-2 mt-1">
              {banner ? (
                <img src={resolveMediaUrl(banner)} alt=""
                     style={{ width: 64, height: 40, borderRadius: 6, objectFit: "cover", border: "1px solid var(--border-col)" }} />
              ) : (
                <div style={{ width: 64, height: 40, borderRadius: 6, background: "var(--surface-2)" }} />
              )}
              <input ref={bannerFileRef} type="file" accept="image/*" style={{ display: "none" }}
                     onChange={(e) => { uploadImage(e.target.files?.[0], "banner"); e.target.value = ""; }}
                     data-testid="realm-edit-banner-file" />
              <button type="button" onClick={() => bannerFileRef.current?.click()}
                      disabled={uploading === "banner"} className="or-chip" data-testid="realm-edit-banner-upload">
                {uploading === "banner" ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
              </button>
            </div>
          </div>
        </div>

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Privacy</label>
        <div className="flex gap-2 mb-3 flex-wrap" role="radiogroup" aria-label="Realm privacy">
          {PRIVACY_OPTIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="or-chip"
              data-active={privacy === p.id}
              data-testid={`realm-edit-privacy-${p.id}`}
              onClick={() => setPrivacy(p.id)}
              role="radio"
              aria-checked={privacy === p.id}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Categories / tags (comma-separated)</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)}
               className="or-input mb-3" placeholder="music, festivals" data-testid="realm-edit-tags" />

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Rules / guidelines</label>
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} maxLength={4000} rows={4}
                  className="or-input mb-3"
                  placeholder="Be respectful. No spam. Keep it on-topic."
                  data-testid="realm-edit-rules" />

        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Accent</label>
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)}
                 style={{ width: 36, height: 28, border: "1px solid var(--border-col)", background: "transparent" }}
                 data-testid="realm-edit-accent" />
        </div>

        {err && <div className="text-sm mb-2" style={{ color: "#FF8080" }} data-testid="realm-edit-error">{err}</div>}

        <div className="flex items-center justify-end gap-2 mb-4">
          <button type="button" onClick={onClose} className="or-chip" data-testid="realm-edit-cancel">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="or-btn" data-testid="realm-edit-save">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
          </button>
        </div>

        {/* Danger zone --------------------------------------------- */}
        <div className="mt-2 pt-4" style={{ borderTop: "1px solid var(--border-col)" }} data-testid="realm-edit-danger">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} style={{ color: "#FF8080" }} />
            <span className="text-xs uppercase tracking-widest" style={{ color: "#FF8080" }}>Danger zone</span>
          </div>
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="or-chip"
              data-testid="realm-edit-delete-open"
              style={{ color: "#FF8080" }}
            >
              <Trash2 size={12} /> Delete Realm
            </button>
          ) : (
            <div className="p-3" style={{ background: "var(--surface-2)", borderRadius: "var(--radius)", border: "1px solid #FF808055" }}>
              <p className="text-sm mb-2" data-testid="realm-edit-delete-prompt">
                Are you sure you want to <strong>permanently delete</strong> this Realm? This action cannot be undone.
              </p>
              <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                Type <code>{expectedConfirm}</code> to confirm:
              </p>
              <input
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                className="or-input mb-2"
                placeholder={expectedConfirm}
                data-testid="realm-edit-delete-confirm-input"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setConfirmingDelete(false); setConfirmInput(""); }}
                        className="or-chip" data-testid="realm-edit-delete-cancel">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={deleting || confirmInput.trim() !== expectedConfirm}
                  className="or-btn"
                  style={{ background: "#FF4444", color: "#fff" }}
                  data-testid="realm-edit-delete-confirm"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  &nbsp;Delete permanently
                </button>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
