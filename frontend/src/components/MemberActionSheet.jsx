/**
 * MemberActionSheet — contextual popover when a community member is
 * clicked. Decides between:
 *
 *   • Friends  → "Chat" (opens a floating DM window)
 *   • Strangers → "Request Friend" (uses the existing friend system)
 *
 * Always offers "View profile" + "Cancel". The friend-state check
 * runs on demand against /api/friends/list so we don't preload state
 * for the whole member list.
 */
import React, { useEffect, useState } from "react";
import { Loader2, MessageCircle, UserPlus, User, X } from "lucide-react";
import apiClient from "@/api/client";
import { useNavigate } from "react-router-dom";

export default function MemberActionSheet({ member, onClose, onOpenChat }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, areFriends: false, sentRequest: false, err: "" });

  useEffect(() => {
    if (!member?.username) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get("/friends/list");
        const friends = data?.friends || data?.list || data || [];
        const areFriends = !!friends.find(
          (f) => (f.username || "").toLowerCase() === (member.username || "").toLowerCase(),
        );
        if (!cancelled) setState({ loading: false, areFriends, sentRequest: false, err: "" });
      } catch {
        if (!cancelled) setState({ loading: false, areFriends: false, sentRequest: false, err: "" });
      }
    })();
    return () => { cancelled = true; };
  }, [member?.username]);

  const sendFriendRequest = async () => {
    if (!member?.username) return;
    setState((s) => ({ ...s, loading: true, err: "" }));
    try {
      await apiClient.post("/friends/request", { username: member.username });
      setState((s) => ({ ...s, loading: false, sentRequest: true }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, err: e?.response?.data?.detail || "Could not send request" }));
    }
  };

  if (!member) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      data-testid="member-action-sheet-backdrop"
    >
      <div
        className="or-surface w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="member-action-sheet"
      >
        <div className="flex items-center gap-3 mb-3">
          <img src={member.avatar_url || "/avatar-placeholder.svg"} alt="" className="rounded-full" style={{ width: 44, height: 44 }} />
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate" style={{ color: "var(--text-main)" }}>{member.display_name || member.username}</div>
            <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>@{member.username}</div>
          </div>
          <button onClick={onClose} className="or-chip" data-testid="member-action-close"><X size={12} /></button>
        </div>

        {state.loading ? (
          <div className="text-center py-6"><Loader2 size={16} className="inline animate-spin" style={{ color: "var(--text-muted)" }} /></div>
        ) : (
          <div className="space-y-2">
            {state.areFriends ? (
              <button
                onClick={() => { onOpenChat && onOpenChat(member); onClose && onClose(); }}
                className="or-btn w-full"
                data-testid="member-action-chat"
              ><MessageCircle size={14} /> Chat</button>
            ) : state.sentRequest ? (
              <button className="or-btn w-full" disabled data-testid="member-action-request-sent">
                Friend request sent
              </button>
            ) : (
              <button
                onClick={sendFriendRequest}
                className="or-btn w-full"
                data-testid="member-action-request"
              ><UserPlus size={14} /> Request Friend</button>
            )}
            <button
              onClick={() => { navigate(`/@${member.username}`); onClose && onClose(); }}
              className="or-chip w-full justify-center"
              data-testid="member-action-profile"
            ><User size={12} /> View profile</button>
            {state.err && <div className="text-sm" style={{ color: "#ff8080" }} data-testid="member-action-error">{state.err}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
