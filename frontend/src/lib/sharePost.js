/**
 * sharePost — single shared logic for sharing a post's canonical URL.
 * Native share sheet (Web Share API) on supported devices, clipboard
 * fallback elsewhere. Links always use the production domain so shared
 * URLs never leak the preview environment. The URL format matches the
 * PostPopup deep link (?post=<id>), which survives the auth redirect
 * (/signup?next=…) and reopens the exact post after login/signup.
 */
import { toast } from "sonner";

const SHARE_ORIGIN = process.env.REACT_APP_SHARE_ORIGIN || "https://ourrealm.social";

let sharing = false; // guards against repeated taps opening multiple sheets

export function postShareUrl(postId) {
  return `${SHARE_ORIGIN}/feed?post=${encodeURIComponent(postId)}`;
}

export async function sharePostLink(post) {
  if (!post?.id || sharing) return false;
  sharing = true;
  try {
    const url = postShareUrl(post.id);
    const title = post.author_username
      ? `Post by @${post.author_username} on OurRealm`
      : "A post on OurRealm";
    const text = (post.content || post.sound_title || "").slice(0, 120);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text: text || title, url });
        return true;
      } catch (e) {
        if (e?.name === "AbortError") return false; // user closed the sheet
        // fall through to clipboard on any other failure
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success("Post link copied");
    return true;
  } finally {
    sharing = false;
  }
}
