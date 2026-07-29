/**
 * ModPostRow — admin post card with status badges + full moderation
 * actions. Used by the Users panel, All Content search, and case lists.
 * Mobile-friendly: actions wrap as chips (large tap targets).
 */
import React, { useState } from "react";
import { toast } from "sonner";
import {
  Eye, EyeOff, Lock, Unlock, RotateCcw, Trash2, FolderOpen, Loader2,
  CheckCircle2, Flag,
} from "lucide-react";
import { absoluteImageUrl } from "@/components/ImageUploadPicker";
import AdminBlurModal from "@/components/AdminBlurModal";
import ReasonModal from "@/components/admin/ReasonModal";
import { postAction, statusBadge } from "@/components/admin/modActions";

export default function ModPostRow({ post, source = "moderation_center", onChanged, onOpenCase }) {
  const [busy, setBusy] = useState(false);
  const [blurOpen, setBlurOpen] = useState(false);
  const [modal, setModal] = useState(null); // {action, title, requireReason, destructive, label}
  const badge = statusBadge(post);

  const run = async (action, reason = null, successMsg = "Done") => {
    setBusy(true);
    try {
      await postAction("post", post.id, action, { reason, source });
      toast.success(successMsg);
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed");
      throw e;
    } finally { setBusy(false); }
  };

  const confirmThen = (action, title, { requireReason = false, destructive = false, msg } = {}) =>
    setModal({ action, title, requireReason, destructive, msg });

  const A = ({ id, Icon, label, onClick, destructive: dst }) => (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="or-chip"
      style={{ minHeight: 32, ...(dst ? { color: "#FF8080", borderColor: "rgba(255,80,80,0.4)" } : {}) }}
      data-testid={`modrow-${id}-${post.id}`}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />} {label}
    </button>
  );

  return (
    <div className="or-surface p-3" data-testid={`modrow-${post.id}`}>
      <div className="flex gap-3">
        {(post.image_url || post.video_url) && (
          <div className="shrink-0 overflow-hidden" style={{ width: 64, height: 64, borderRadius: 8, border: "1px solid var(--border-col)" }}>
            {post.image_url ? (
              <img src={absoluteImageUrl(post.image_url)} alt="" className="w-full h-full object-cover"
                style={{ filter: post.manual_blur || (post.severity || 0) >= 2 ? "blur(10px)" : "none" }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px]" style={{ color: "var(--text-muted)" }}>video</div>
            )}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ color: badge.color, border: `1px solid ${badge.color}` }} data-testid={`modrow-status-${post.id}`}>
              {badge.label}
            </span>
            <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{post.media_type}</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>vis: {post.visibility}</span>
            {post.report_count > 0 && (
              <span className="or-chip text-[10px]"><Flag size={9} /> {post.report_count}</span>
            )}
            {(post.categories || []).slice(0, 3).map((c) => (
              <span key={c} className="or-chip text-[10px]">{c}</span>
            ))}
          </div>
          <div className="text-sm or-wrap" style={{ color: "var(--text-main)" }}>
            {post.content || <em>(no caption)</em>}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            @{post.author_username || post.author_id} · {String(post.created_at || "").slice(0, 16)} · 🔥{post.fire_total} · 💬{post.comments} · AI: {post.scan_status || "not scanned"}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        <A id="safe" Icon={CheckCircle2} label="Mark Safe" onClick={() => run("approve", null, "Marked safe")} />
        {post.manual_blur ? (
          <A id="unblur" Icon={Eye} label="Unblur" onClick={() => run("unblur", null, "Blur removed")} />
        ) : (
          <A id="blur" Icon={EyeOff} label="Blur" onClick={() => setBlurOpen(true)} />
        )}
        {post.review_locked ? (
          <A id="unlock" Icon={Unlock} label="Restore Visibility"
            onClick={() => confirmThen("unlock", "Restore original visibility", { requireReason: true, msg: "The post returns to its exact original audience." })} />
        ) : (
          <A id="lock" Icon={Lock} label="Lock Private"
            onClick={() => confirmThen("lock", "Lock private while under review", { requireReason: true, msg: "Only the uploader and admins will see this post. Original visibility is saved for exact restoration." })} />
        )}
        {post.moderation_status === "hidden" || post.moderation_status === "rejected" ? (
          <A id="restore" Icon={RotateCcw} label="Restore" onClick={() => run("restore", null, "Post restored")} />
        ) : (
          <A id="hide" Icon={EyeOff} label="Hide"
            onClick={() => confirmThen("hide", "Hide post", { msg: "Hidden from all users except the uploader." })} />
        )}
        <A id="delete" Icon={Trash2} label="Delete" destructive
          onClick={() => confirmThen("delete", "Delete post permanently", { requireReason: true, destructive: true, msg: "This permanently deletes the post and its comments. This cannot be undone." })} />
        <A id="case" Icon={FolderOpen} label="Case" onClick={() => onOpenCase?.("post", post.id)} />
      </div>

      {blurOpen && (
        <AdminBlurModal
          contentType="post"
          contentId={post.id}
          onClose={() => setBlurOpen(false)}
          onDone={() => { toast.success("Blur applied"); onChanged?.(); }}
        />
      )}
      {modal && (
        <ReasonModal
          title={modal.title}
          message={modal.msg}
          requireReason={modal.requireReason}
          destructive={modal.destructive}
          confirmLabel={modal.title}
          onClose={() => setModal(null)}
          onConfirm={(reason) => run(modal.action, reason,
            modal.action === "lock" ? "Locked private for review"
            : modal.action === "unlock" ? "Original visibility restored"
            : modal.action === "delete" ? "Post deleted" : "Done")}
        />
      )}
    </div>
  );
}
