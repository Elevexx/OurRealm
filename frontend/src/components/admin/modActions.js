/**
 * modActions — shared moderation action helpers + status labels.
 * `source` is recorded in the audit log for every action.
 */
import apiClient from "@/api/client";

export async function postAction(contentType, id, action, { reason = null, source = "moderation_center" } = {}) {
  if (action === "unblur") {
    return apiClient.post(`/admin/moderation/${contentType}/${id}/unblur`, { reason, source });
  }
  if (action === "lock") {
    return apiClient.post(`/admin/moderation/post/${id}/lock-private`, { reason, source });
  }
  if (action === "unlock") {
    return apiClient.post(`/admin/moderation/post/${id}/unlock-private`, { reason, source });
  }
  if (action === "rescan") {
    return apiClient.post(`/admin/moderation/${contentType}/${id}/rescan`);
  }
  // approve | hide | restore | delete | ban | acknowledge
  return apiClient.post(`/admin/moderation/${contentType}/${id}/action`, { action, reason, source });
}

export function statusBadge(row) {
  if (row.review_locked) return { label: "Private Review", color: "#B98CFF" };
  const ms = row.moderation_status || "approved";
  if (ms === "hidden") return { label: "Hidden", color: "#FF8080" };
  if (ms === "rejected") return { label: "Removed", color: "#FF5A5A" };
  if (ms === "pending_review") return { label: "Under Review", color: "#FFC94D" };
  if (row.urgent) return { label: "Urgent", color: "#FF2D55" };
  if (row.manual_blur) return { label: "Blurred", color: "#FFA94D" };
  if ((row.severity || 0) >= 1) return { label: `Flagged L${row.severity}`, color: "#FFC94D" };
  return { label: "Safe", color: "#57D98A" };
}
