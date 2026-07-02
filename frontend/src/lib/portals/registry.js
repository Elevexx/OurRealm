/**
 * OurRealm — Portals · Realm Registry
 * -----------------------------------------------------------------
 * Auto-discovers every realm in `realmMetadata` and pairs it with a
 * gameplay class. Realms with `hasGameplay: false` (or without a
 * registered class) automatically fall back to `PlaceholderRealm`
 * so the founder can still LAUNCH them from the Dev Hub.
 *
 *   createRealm("rainforest")     → RainforestRealm()
 *   createRealm("aquarium")       → PlaceholderRealm(meta)
 *   listRealmIds()                → ["rainforest", "aquarium", …]
 *
 * Adding a new fully-playable Realm:
 *   1. Add its metadata entry to `realmMetadata.js` (hasGameplay: true).
 *   2. Import its class here.
 *   3. Add one line to REALM_CLASSES.
 */
import PlaceholderRealm  from "./PlaceholderRealm";
import RainforestRealm   from "./realms/RainforestRealm";
import { REALM_METADATA, getRealmMeta } from "./realmMetadata";

// Playable realm classes. Adding one line here promotes a placeholder
// realm into a real gameplay experience.
const REALM_CLASSES = {
  rainforest: RainforestRealm,
};

/**
 * Instantiate a Realm by id. Falls back to the PlaceholderRealm so
 * every registered realm is *always* launchable.
 */
export function createRealm(realmId) {
  const meta = getRealmMeta(realmId);
  if (!meta) throw new Error(`Realm not registered in metadata: ${realmId}`);
  const Cls = REALM_CLASSES[realmId];
  if (Cls) return new Cls();
  return new PlaceholderRealm(meta);
}

/** Every realm id known to the platform (metadata + gameplay). */
export function listRealmIds() {
  return REALM_METADATA.map((r) => r.id);
}

/** Just the realm ids with a real gameplay class. */
export function listPlayableRealmIds() {
  return Object.keys(REALM_CLASSES);
}

export default { createRealm, listRealmIds, listPlayableRealmIds };
