/**
 * Tiny global post-state store — single source of truth for like/comment
 * counts and per-viewer `liked` state, so any surface that mounts a card
 * (Feed, Profile My Feed widget, PostPopup, Notifications) stays in sync
 * the moment one of them mutates. No external deps; React state + an
 * event emitter.
 */
import { useEffect, useState } from "react";

const posts = new Map(); // id -> { liked, likes, comments }
const listeners = new Set();

function emit() {
  for (const l of listeners) l();
}

export function seedPost(id, snapshot = {}) {
  if (!id) return;
  const prev = posts.get(id) || {};
  posts.set(id, {
    liked: prev.liked ?? !!snapshot.liked,
    likes: snapshot.likes ?? prev.likes ?? 0,
    comments: snapshot.comments ?? prev.comments ?? 0,
  });
  emit();
}

export function setPost(id, next) {
  if (!id) return;
  const prev = posts.get(id) || { liked: false, likes: 0, comments: 0 };
  posts.set(id, { ...prev, ...next });
  emit();
}

export function getPost(id) {
  return posts.get(id);
}

/** Subscribe a component to a single post's live counters. */
export function usePostState(id, initial = {}) {
  const [snap, setSnap] = useState(() => {
    if (!id) return { liked: false, likes: initial.likes || 0, comments: initial.comments || 0 };
    const cur = posts.get(id);
    if (cur) return cur;
    const seeded = {
      liked: !!initial.liked,
      likes: initial.likes || 0,
      comments: initial.comments || 0,
    };
    posts.set(id, seeded);
    return seeded;
  });
  useEffect(() => {
    if (!id) return undefined;
    const onChange = () => {
      const cur = posts.get(id);
      if (cur) setSnap({ ...cur });
    };
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, [id]);
  return snap;
}
