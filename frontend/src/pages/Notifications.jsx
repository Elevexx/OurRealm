import React from "react";
import { Heart, MessageCircle, UserPlus, AtSign, Mail, Share2, Users } from "lucide-react";
import { NOTIFICATIONS } from "@/data/mockData";

const ICONS = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  mention: AtSign,
  message: Mail,
  share: Share2,
  friend_request: Users,
};

export default function Notifications() {
  return (
    <div className="max-w-3xl mx-auto" data-testid="notifications-page">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.25em]" style={{ color: "var(--text-muted)" }}>Recent</div>
        <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>Notifications</h1>
      </div>
      <div className="space-y-2">
        {NOTIFICATIONS.map((n) => {
          const Icon = ICONS[n.type] || Heart;
          return (
            <div key={n.id} className="or-surface p-4 flex items-center gap-3" data-testid={`notification-${n.id}`}>
              <div className="p-2 rounded-full" style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)" }}>
                <Icon size={18} style={{ color: "var(--primary)" }} />
              </div>
              <div className="flex-1 text-sm" style={{ color: "var(--text-main)" }}>
                <span className="font-semibold">@{n.actor}</span>{" "}
                <span style={{ color: "var(--text-muted)" }}>
                  {n.type === "like" && "liked"}
                  {n.type === "comment" && "commented on"}
                  {n.type === "follow" && "started following you"}
                  {n.type === "mention" && "mentioned you"}
                  {n.type === "message" && "messaged you"}
                  {n.type === "share" && "shared"}
                  {n.type === "friend_request" && "sent a friend request"}
                </span>
                {n.target && <span> {n.target}</span>}
              </div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{n.when}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
