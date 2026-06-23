/**
 * Centralized music genres list — Feb 20, 2026.
 *
 * Add / remove / reorder genres here only. The sound-upload UI, sounds
 * page filters, and any future recommendations all import `GENRES`
 * from this module so changes propagate everywhere with no rewrites.
 *
 * `TOP_VISIBLE` controls how many show in the "collapsed" picker
 * state. The remaining genres render after the user clicks
 * "View More".
 *
 * `LEGACY_GENRE_MAP` migrates display values from the previous
 * 13-genre list to the new canonical names so DB rows persisted
 * before this update still match. We never rewrite saved values —
 * normalisation happens on read.
 */

export const GENRES = [
  // 1–25 — top global / creator popularity ranking
  "Pop",
  "Hip-Hop/Rap",
  "Rock",
  "R&B/Soul",
  "Country",
  "Latin",
  "Electronic/Dance",
  "Afrobeats",
  "K-Pop",
  "House",
  "Indie",
  "Alternative",
  "Techno",
  "Lo-Fi",
  "Reggaeton",
  "Trap",
  "Folk",
  "Metal",
  "Dubstep",
  "Jazz",
  "Classical",
  "Reggae",
  "Gospel",
  "Blues",
  "Singer-Songwriter",
  // 26–50 — additional electronic genres and subgenres
  "Tech House",
  "Deep House",
  "Drum & Bass",
  "Future House",
  "Progressive House",
  "Melodic House",
  "Trance",
  "Psytrance",
  "Future Bass",
  "Bass House",
  "Electro House",
  "Tropical House",
  "Big Room",
  "Hardstyle",
  "Progressive Trance",
  "Minimal Techno",
  "Organic House",
  "UK Garage",
  "Breakbeat",
  "Electro",
  "Ambient",
  "Synthwave",
  "Midtempo",
  "Phonk",
  "Garage House",
];

// First N genres render before "View More".
export const TOP_VISIBLE = 20;

// Old display values → current canonical names. Saved genre values
// (e.g. "Lo-fi", "Hip-Hop") are normalised through this map at read
// time so existing uploads keep matching the new chips.
export const LEGACY_GENRE_MAP = {
  "Lo-fi":    "Lo-Fi",
  "Hip-Hop":  "Hip-Hop/Rap",
  "Indie":    "Indie",          // unchanged
  "Other":    "",               // dropped — "Other" is no longer offered
};

export function normalizeGenre(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (Object.prototype.hasOwnProperty.call(LEGACY_GENRE_MAP, s)) {
    return LEGACY_GENRE_MAP[s];
  }
  return s;
}
