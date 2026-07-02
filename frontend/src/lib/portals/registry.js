/**
 * OurRealm — Portals 1.1 · Realm registry
 * -----------------------------------------------------------------
 * Maps realmId → Realm class constructor. Add new realms here and
 * they become instantiable by /realms/portals/ar/xr?realm=<id>.
 *
 * Kept as an object of lazy factory functions so the Three.js code
 * splits out of any page that doesn't need it (Portals Hub, etc.).
 */
import RainforestRealm from "./realms/RainforestRealm";

const REGISTRY = {
  rainforest: () => new RainforestRealm(),
};

export function createRealm(realmId) {
  const factory = REGISTRY[realmId];
  if (!factory) throw new Error(`Realm not found in registry: ${realmId}`);
  return factory();
}

export function listRealmIds() {
  return Object.keys(REGISTRY);
}

export default { createRealm, listRealmIds };
