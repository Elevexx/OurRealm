/**
 * SoundFireControl — Bundle 1 Sound-player Fire.
 * Resolves a track's ONE canonical post server-side and renders the
 * shared FireButton (Quick Fire + full picker). A module cache keeps
 * duplicate mounts from re-fetching; postStore keeps totals in sync.
 */
import React, { useEffect, useState } from "react";
import apiClient from "@/api/client";
import FireButton from "@/components/fire/FireButton";
import { useFireStatus } from "@/lib/fireApi";
import { useAuth } from "@/contexts/AuthContext";

const cache = new Map(); // trackId -> canonical post promise

export default function SoundFireControl({ trackId, testidPrefix }) {
  const { user } = useAuth();
  const fireStatus = useFireStatus(user?.id);
  const [post, setPost] = useState(null);

  useEffect(() => {
    if (!trackId || !user?.id) return undefined;
    let on = true;
    if (!cache.has(trackId)) {
      cache.set(trackId, apiClient.get(`/sounds/${trackId}/canonical-post`)
        .then((r) => r.data.post).catch(() => null));
    }
    cache.get(trackId).then((p) => { if (on) setPost(p); });
    return () => { on = false; };
  }, [trackId, user?.id]);

  if (!post || !fireStatus?.enabled) return null;
  if ((post.audience?.visibility || "public") !== "public") return null;
  return (
    <FireButton post={post} fireStatus={fireStatus}
      testidPrefix={testidPrefix || `sound-fire-${trackId}`} />
  );
}
