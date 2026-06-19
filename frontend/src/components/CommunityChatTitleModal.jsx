/**
 * CommunityChatTitleModal — small inline modal for admins to rename the
 * main community chat, edit its description, and set an optional
 * welcome/pinned message. Changes broadcast over the chat's WebSocket
 * so every connected member sees them instantly.
 */
import React, { useEffect, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import apiClient from "@/api/client";

const TITLE_MAX = 50;
const DESC_MAX  = 200;
const WELCOME_MAX = 400;

export default function CommunityChatTitleModal({
  open, onClose, chat, communityType, communityId, onSaved,
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [welcome, setWelcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !chat) return;
    setTitle(chat.title || "General Chat");
    setDescription(chat.description || "");
    setWelcome(chat.welcome_message || "");
    setErr("");
  }, [open, chat]);

  if (!open) return null;

  const save = async () => {
    if (!title.trim()) { setErr("Title is required"); return; }
    if (title.length > TITLE_MAX) { setErr(`Title must be ≤${TITLE_MAX} chars`); return; }
    setSaving(true); setErr("");
    try {
      const { data } = await apiClient.patch(
        `/communities/${communityType}/${communityId}/chats/${chat.id}`,
        {
          title:        title.trim(),
          description:  description.trim(),
          welcome_message: welcome.trim(),
        },
      );
      onSaved && onSaved(data);
      onClose && onClose();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
      data-testid="community-chat-title-modal-backdrop"
    >
      <div
        className="or-surface w-full max-w-md p-5 relative"
        onClick={(e) => e.stopPropagation()}
        data-testid="community-chat-title-modal"
      >
        <button onClick={onClose} className="absolute top-3 right-3 or-chip" data-testid="community-chat-title-modal-close"><X size={12} /></button>
        <h3 className="text-lg mb-3" style={{ fontFamily: "var(--font-display)" }}>Rename Community Chat</h3>

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Title <span style={{ color: title.length > TITLE_MAX ? "#ff8080" : "var(--text-muted)" }}>({title.length}/{TITLE_MAX})</span></label>
        <input
          className="or-input mb-3"
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="General Chat"
          data-testid="community-chat-title-input"
        />

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Description <span style={{ color: "var(--text-muted)" }}>({description.length}/{DESC_MAX})</span></label>
        <input
          className="or-input mb-3"
          maxLength={DESC_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — what's this chat about?"
          data-testid="community-chat-description-input"
        />

        <label className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Welcome / Pinned Message <span style={{ color: "var(--text-muted)" }}>({welcome.length}/{WELCOME_MAX})</span></label>
        <textarea
          className="or-input mb-3"
          maxLength={WELCOME_MAX}
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          placeholder="Optional — shown pinned at the top of the chat."
          rows={3}
          data-testid="community-chat-welcome-input"
        />

        {err && <div className="text-sm mb-2" style={{ color: "#ff8080" }} data-testid="community-chat-title-error">{err}</div>}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="or-chip" data-testid="community-chat-title-cancel">Cancel</button>
          <button onClick={save} className="or-btn" disabled={saving || !title.trim()} data-testid="community-chat-title-save">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
