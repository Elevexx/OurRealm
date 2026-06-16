/**
 * Global controller for the Post Popup. Any component can call
 * `openPostPopup(post)` (or `openPostPopupById(id)`) and the popup mounted
 * once at the App root will surface, fetch latest state, and let the user
 * like/comment. All actions flow through `postStore` so every place the
 * post is rendered stays in sync.
 */
let currentSetter = null;
let pendingOpen = null;

export function registerPopupSetter(setter) {
  currentSetter = setter;
  if (pendingOpen) {
    const p = pendingOpen;
    pendingOpen = null;
    setter(p);
  }
  return () => { if (currentSetter === setter) currentSetter = null; };
}

export function openPostPopup(post) {
  if (!post) return;
  if (currentSetter) currentSetter({ post, postId: post.id });
  else pendingOpen = { post, postId: post.id };
}

export function openPostPopupById(postId) {
  if (!postId) return;
  if (currentSetter) currentSetter({ post: null, postId });
  else pendingOpen = { post: null, postId };
}

export function closePostPopup() {
  if (currentSetter) currentSetter(null);
  pendingOpen = null;
}
