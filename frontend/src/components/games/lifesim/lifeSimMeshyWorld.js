// REALMLIFE MESHY WORLD — loads generated AAA GLB assets and swaps
// them over the procedural placeholders (which stay as LOD fallback).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import apiClient from "@/api/client";

const BACKEND = process.env.REACT_APP_BACKEND_URL;

let glbCache = new Map();
const draco = new DRACOLoader();
draco.setDecoderPath("/draco/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

function loadGLB(url) {
  if (!glbCache.has(url)) {
    window.__REALMLIFE_MESHY_LOG = window.__REALMLIFE_MESHY_LOG || [];
    const log = window.__REALMLIFE_MESHY_LOG;
    log.push(`start ${url}`);
    glbCache.set(
      url,
      loader
        .loadAsync(`${BACKEND}${url}`)
        .then((gltf) => {
          log.push(`done ${url}`);
          gltf.scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          return gltf.scene;
        })
        .catch((err) => {
          log.push(`fail ${url} ${err?.message}`);
          throw err;
        })
    );
  }
  return glbCache.get(url);
}

// clone (shared geometry/materials), scale to footprint, sit on ground
function placeInstance(source, { x, z, ry = 0, footprint, parent }) {
  const inst = source.clone(true);
  const wrap = new THREE.Group();
  wrap.add(inst);

  const box = new THREE.Box3().setFromObject(inst);
  const size = box.getSize(new THREE.Vector3());
  const scale = footprint / Math.max(size.x, size.z, 0.001);
  inst.scale.setScalar(scale);

  const box2 = new THREE.Box3().setFromObject(inst);
  const center = box2.getCenter(new THREE.Vector3());
  inst.position.x -= center.x;
  inst.position.z -= center.z;
  inst.position.y -= box2.min.y;

  wrap.position.set(x, 0, z);
  wrap.rotation.y = ry;
  parent.add(wrap);
  return wrap;
}

const HOUSE_SLOTS = [
  "house_med_villa_a",
  "house_med_villa_b",
  "house_med_villa_c",
  "house_med_small_a",
  "house_med_small_b",
];

const BOAT_SLOTS = ["boat_speed", "boat_sail", "boat_yacht"];

// Fixed hero placements (world coordinates around Nexus center 85,360)
const NEXUS_PLACEMENTS = [
  { slot: "nexus_hero_tower", x: 85, z: 300, footprint: 26 },
  { slot: "nexus_portal_gate", x: 85, z: 338, footprint: 14 },
  { slot: "nexus_arcade_pavilion", x: 55, z: 390, footprint: 20, ry: Math.PI / 4 },
  { slot: "nexus_transit_station", x: 115, z: 390, footprint: 24, ry: -Math.PI / 4 },
  { slot: "prop_fountain", x: 85, z: 318, footprint: 8 },
  { slot: "tree_cypress", x: 74, z: 338, footprint: 3 },
  { slot: "tree_cypress", x: 96, z: 338, footprint: 3 },
];

export async function installRealmLifeMeshyWorld({ scene, gameId }) {
  window.__REALMLIFE_MESHY = { status: "fetching-manifest" };
  let assets = [];
  try {
    const r = await apiClient.get(`/games/${gameId}/realmlife/aaa-assets`);
    assets = r.data?.assets || [];
  } catch (err) {
    window.__REALMLIFE_MESHY = { status: "manifest-failed", error: err?.message };
    console.debug("[RealmLife Meshy] manifest unavailable", err?.message);
    return null;
  }
  if (!assets.length) {
    window.__REALMLIFE_MESHY = { status: "no-assets" };
    return null;
  }
  window.__REALMLIFE_MESHY = { status: "loading-glbs", count: assets.length };

  const bySlot = {};
  assets.forEach((a) => {
    bySlot[a.slot] = a.url;
  });

  const root = new THREE.Group();
  root.name = "RealmLifeMeshyWorld";
  scene.add(root);

  const homeLods = []; // { wrap, shell, x, z }
  const scratch = new THREE.Vector3();

  // ---- A) RESIDENTIAL: swap the 100 tagged privacy shells ----
  const houseUrls = HOUSE_SLOTS.filter((s) => bySlot[s]).map((s) => bySlot[s]);
  if (houseUrls.length) {
    const models = await Promise.all(houseUrls.map(loadGLB));
    const shells = [];
    scene.traverse((o) => {
      if (o.userData?.residentialCommunity) shells.push(o);
    });
    shells.forEach((shell, i) => {
      shell.getWorldPosition(scratch);
      const sBox = new THREE.Box3().setFromObject(shell);
      const sSize = sBox.getSize(new THREE.Vector3());
      const footprint = Math.min(
        14.5,
        Math.max(10, Math.max(sSize.x, sSize.z) * 0.82)
      );
      const wrap = placeInstance(models[i % models.length], {
        x: scratch.x,
        z: scratch.z,
        ry: shell.rotation.y,
        footprint,
        parent: root,
      });
      wrap.visible = false; // LOD update reveals when near
      homeLods.push({ wrap, shell, x: scratch.x, z: scratch.z });
    });
  }

  // ---- B) BOATS: swap every tagged prototype boat in place ----
  const boatUrls = BOAT_SLOTS.filter((s) => bySlot[s]).map((s) => bySlot[s]);
  if (boatUrls.length) {
    const boats = await Promise.all(boatUrls.map(loadGLB));
    const protos = [];
    scene.traverse((o) => {
      if (o.name === "RealmLifeProtoBoat") protos.push(o);
    });
    protos.forEach((proto, i) => {
      proto.getWorldPosition(scratch);
      const pBox = new THREE.Box3().setFromObject(proto);
      const pSize = pBox.getSize(new THREE.Vector3());
      const footprint = Math.max(4.5, Math.max(pSize.x, pSize.z));
      placeInstance(boats[i % boats.length], {
        x: scratch.x,
        z: scratch.z,
        ry: proto.rotation.y,
        footprint,
        parent: root,
      });
      proto.visible = false;
    });
  }

  // ---- C) PALMS: swap tagged prototype palms ----
  if (bySlot.tree_palm) {
    const palmModel = await loadGLB(bySlot.tree_palm);
    const protos = [];
    scene.traverse((o) => {
      if (o.name === "RealmLifeProtoPalm") protos.push(o);
    });
    protos.forEach((proto) => {
      proto.getWorldPosition(scratch);
      placeInstance(palmModel, {
        x: scratch.x,
        z: scratch.z,
        ry: (scratch.x * 13.7) % Math.PI,
        footprint: 4.2,
        parent: root,
      });
      proto.visible = false;
    });
  }

  // ---- D) NEXUS hero structures + landscaping (fixed spots) ----
  await Promise.all(
    NEXUS_PLACEMENTS.map(async (p) => {
      const url = bySlot[p.slot];
      if (!url) return;
      try {
        const model = await loadGLB(url);
        placeInstance(model, {
          x: p.x,
          z: p.z,
          ry: p.ry || 0,
          footprint: p.footprint,
          parent: root,
        });
      } catch (err) {
        console.debug(`[RealmLife Meshy] ${p.slot} failed`, err?.message);
      }
    })
  );

  console.debug(
    `[RealmLife Meshy] installed: ${homeLods.length} homes swapped, ` +
    `${Object.keys(bySlot).length} slots available`
  );

  window.__REALMLIFE_MESHY = {
    status: "installed",
    slots: Object.keys(bySlot),
    homesSwapped: homeLods.length,
    placed: root.children.length,
  };

  return {
    root,

    // distance LOD: GLB house near the player, procedural shell far away
    update(playerPos, drawDistance) {
      const near = Math.min(95, drawDistance * 0.35);
      const nearSq = near * near;
      for (const h of homeLods) {
        const dx = playerPos.x - h.x;
        const dz = playerPos.z - h.z;
        const isNear = dx * dx + dz * dz < nearSq;
        if (h.wrap.visible !== isNear) {
          h.wrap.visible = isNear;
          h.shell.visible = !isNear;
        }
      }
    },

    dispose() {
      scene.remove(root);
      glbCache = new Map(); // geometries are disposed by runtime teardown
    },
  };
}
