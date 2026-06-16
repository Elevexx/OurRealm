/**
 * Share-to-Chat — opens FriendPicker, then sends a Supabase chat message
 * containing the shared track's title, creator handle, and stream URL.
 *
 * Uses the existing Phase 3 unified Messenger API. Does NOT modify any
 * Phase 3 logic or schema.
 */
import React, { useState } from "react";
import FriendPicker from "@/components/FriendPicker";
import { useAuth } from "@/contexts/AuthContext";
import { getOrCreateDirectChat, sendMessage } from "@/lib/messaging";
import { isSupabaseConfigured } from "@/lib/supabase";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
function absUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BACKEND}${u}`;
  return u;
}

export default function ShareToChatModal({ open, track, onClose, onSent, testid = "share-to-chat" }) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  if (!open) return null;

  if (!isSupabaseConfigured) {
    return (
      <div
        className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center px-2 pb-24 sm:pb-0"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}
        onClick={onClose}
        data-testid={`${testid}-not-configured`}
      >
        <div className="or-surface p-5 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg mb-1" style={{ fontFamily: "var(--font-display)" }}>Sharing is offline</h3>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Messenger is not configured in this environment, so we can&apos;t deliver this sound to a chat yet.
          </p>
          <div className="mt-4 flex justify-end">
            <button className="or-btn" onClick={onClose}>OK</button>
          </div>
        </div>
      </div>
    );
  }

  const pick = async (friend) => {
    if (!user || !track) return;
    setSending(true); setErr("");
    try {
      const chat = await getOrCreateDirectChat(user.id, friend.id);
      const stream = absUrl(track.file_url);
      const creator = track.artist_username ? `@${track.artist_username}` : "";
      const body = `🎵 Shared a sound from OurRealm\n"${track.title}"${creator ? ` · ${creator}` : ""}\n${stream}`;
      // Send via existing Supabase messaging — Phase 3 untouched.
      // We put the stream URL in `media_url` so future inline-audio renderers can find it,
      // AND in the text so it's always clickable regardless of renderer support.
      await sendMessage({
        contextType: "chat",
        contextId: chat.id,
        senderId: user.id,
        text: body,
        mediaUrl: stream,
      });
      onSent?.({ chat, friend });
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Could not share that sound. Try again.");
    } finally { setSending(false); }
  };

  return (
    <>
      <FriendPicker
        open={open}
        onClose={onClose}
        onPick={pick}
        title={`Share "${track?.title || "this sound"}" to chat`}
        emptyHelp="Add friends first so you can share sounds with them."
        testid={testid}
      />
      {(sending || err) && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[230] px-4 py-2 text-sm"
          style={{
            bottom: 24,
            background: err ? "rgba(255,80,80,0.18)" : "var(--surface-2)",
            color: err ? "#ff8080" : "var(--text-main)",
            borderRadius: "var(--radius)",
            border: err ? "1px solid rgba(255,80,80,0.5)" : "1px solid var(--border-col)",
          }}
          data-testid={`${testid}-toast`}
        >
          {err || "Sending…"}
        </div>
      )}
    </>
  );
}
