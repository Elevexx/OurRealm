/**
 * dedupePosts — frontend safety net mirroring the backend rule: a post
 * id renders at most once, and a Sound surfaces through at most one
 * canonical post per track (creator reposts are non-canonical and
 * unaffected). First (highest-ranked) instance wins.
 */
export function dedupePosts(items) {
  const seen = new Set();
  const canonTracks = new Set();
  const out = [];
  for (const p of items || []) {
    if (!p) continue;
    if (p.id && seen.has(p.id)) continue;
    if (p.is_canonical_sound && p.sound_track_id) {
      if (canonTracks.has(p.sound_track_id)) continue;
      canonTracks.add(p.sound_track_id);
    }
    if (p.id) seen.add(p.id);
    out.push(p);
  }
  return out;
}
