// REALMLIFE CANONICAL BLUEPRINT FURNITURE
// One shared renderer used by BOTH the owner's home and
// authorized guest views so every observer sees the exact
// same persisted furniture, colors and finishes.
import * as THREE from "three";

export const FURNITURE_TYPES = {
  sofa: { label: "Sofa", size: [3.0, 1.0, 1.2] },
  bed: { label: "Bed", size: [3.0, 0.65, 2.0] },
  tv: { label: "Television", size: [2.1, 1.4, 0.4] },
  fridge: { label: "Refrigerator", size: [1.2, 2.2, 1.1] },
  stove: { label: "Stove", size: [1.5, 1.05, 1.05] },
  shower: { label: "Shower", size: [1.55, 2.15, 1.55] },
  toilet: { label: "Toilet", size: [0.9, 0.75, 1.0] },
  bathroom_sink: { label: "Bathroom Sink", size: [0.85, 0.95, 0.65] },
  kitchen_sink: { label: "Kitchen Sink", size: [1.2, 0.95, 0.85] },
  dining_table: { label: "Dining Table", size: [1.8, 0.85, 1.05] },
  dining_chair: { label: "Dining Chair", size: [0.55, 0.95, 0.55] },
  dresser: { label: "Dresser", size: [1.6, 1.1, 0.6] },
  lamp: { label: "Floor Lamp", size: [0.45, 1.6, 0.45] },
};

const OWNER_ACTIONS = {
  sofa: [{ id: "relax", label: "Relax" }],
  bed: [{ id: "sleep", label: "Sleep" }],
  tv: [{ id: "tv", label: "Watch TV" }],
  fridge: [{ id: "snack", label: "Grab Snack · 🔥5" }],
  stove: [{ id: "cook", label: "Cook Meal · 🔥10" }],
  shower: [{ id: "shower", label: "Take Shower" }],
  toilet: [{ id: "toilet", label: "Use Toilet" }],
  bathroom_sink: [{ id: "admire", label: "Freshen Up" }],
  kitchen_sink: [{ id: "admire", label: "Rinse Up" }],
  dining_table: [{ id: "admire", label: "Admire" }],
  dining_chair: [{ id: "sit", label: "Sit" }],
  dresser: [{ id: "admire", label: "Browse" }],
  lamp: [{ id: "admire", label: "Admire" }],
};

const GUEST_ACTIONS = {
  sofa: [{ id: "sit", label: "Sit & Relax" }],
  bed: [{ id: "sit", label: "Rest on Bed" }],
  shower: [{ id: "shower", label: "Take Shower" }],
};

const APPROACH = {
  sofa: [0, -1.3],
  bed: [0, 1.6],
  tv: [-1.8, 0],
  fridge: [0, -1.3],
  stove: [0, -1.3],
  shower: [0, 1.3],
  toilet: [0, 1.15],
  bathroom_sink: [0, 1.1],
  kitchen_sink: [0, -1.2],
  dining_table: [0, 1.4],
  dining_chair: [0, 1.0],
  dresser: [0, 1.1],
  lamp: [0, 1.0],
};

const ANCHORS = {
  bed: { x: 0, y: 0, z: 0, rotationY: Math.PI / 2 },
  sofa: { x: 0, y: 0, z: -0.1, rotationY: Math.PI },
};

function mat(color, roughness = 0.72) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness: 0.04,
  });
}

function box(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Composite furniture builders. Root group sits at y=0; the
// palette-colorable "main" material is returned for recolors.
export function buildFurnitureMesh(type, colorHex) {
  const g = new THREE.Group();
  const main = mat(colorHex || "#888888");
  const t = type;

  if (t === "sofa") {
    const seat = box(3.0, 0.5, 1.2, main);
    seat.position.y = 0.35;
    const back = box(3.0, 0.62, 0.3, main);
    back.position.set(0, 0.85, -0.45);
    const armL = box(0.3, 0.4, 1.1, main);
    armL.position.set(-1.38, 0.7, 0);
    const armR = armL.clone();
    armR.position.x = 1.38;
    g.add(seat, back, armL, armR);
  } else if (t === "bed") {
    const base = box(3.0, 0.5, 2.0, main);
    base.position.y = 0.3;
    const pillow = box(0.6, 0.18, 0.85, mat("#f4efe4", 0.9));
    pillow.position.set(-1.05, 0.62, 0);
    const frame = box(3.12, 0.22, 2.1, mat("#5a4128", 0.7));
    frame.position.y = 0.11;
    g.add(frame, base, pillow);
  } else if (t === "tv") {
    const panel = box(2.1, 1.25, 0.14, mat("#161a22", 0.35));
    panel.position.y = 0.95;
    const screen = box(1.9, 1.05, 0.02, new THREE.MeshStandardMaterial({
      color: 0x1c2a38, emissive: 0x14324a, emissiveIntensity: 0.55,
      roughness: 0.2,
    }));
    screen.position.set(0, 0.95, 0.08);
    const stand = box(0.9, 0.32, 0.4, mat("#20242c", 0.5));
    stand.position.y = 0.16;
    g.add(stand, panel, screen);
  } else if (t === "fridge") {
    const bodyM = box(1.2, 2.2, 1.1, main);
    bodyM.position.y = 1.1;
    const handle = box(0.06, 0.9, 0.06, mat("#7d858a", 0.4));
    handle.position.set(0.45, 1.35, 0.56);
    g.add(bodyM, handle);
  } else if (t === "stove") {
    const bodyM = box(1.5, 1.05, 1.05, main);
    bodyM.position.y = 0.52;
    const top = box(1.5, 0.05, 1.05, mat("#15181c", 0.4));
    top.position.y = 1.06;
    for (const [bx, bz] of [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]]) {
      const burner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.03, 12),
        mat("#2a2f36", 0.5)
      );
      burner.position.set(bx, 1.1, bz);
      g.add(burner);
    }
    g.add(bodyM, top);
  } else if (t === "shower") {
    const tray = box(1.55, 0.14, 1.55, mat("#e8ecec", 0.6));
    tray.position.y = 0.07;
    const backWall = box(1.55, 2.15, 0.08, mat("#7ad4e5", 0.3));
    backWall.position.set(0, 1.07, -0.73);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.45, 1.95, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0xbfeaf5, transparent: true, opacity: 0.32,
        roughness: 0.12, metalness: 0.1,
      })
    );
    glass.position.set(0, 1.05, 0.74);
    const head = box(0.24, 0.06, 0.24, mat("#9aa4a8", 0.3));
    head.position.set(0, 2.02, -0.55);
    g.add(tray, backWall, glass, head);
  } else if (t === "toilet") {
    const base = box(0.62, 0.42, 0.68, mat("#f2f2eb", 0.55));
    base.position.set(0, 0.21, 0.1);
    const tank = box(0.62, 0.62, 0.26, mat("#f2f2eb", 0.55));
    tank.position.set(0, 0.62, -0.32);
    g.add(base, tank);
  } else if (t === "bathroom_sink") {
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 0.72, 10),
      mat("#eef0ec", 0.55)
    );
    pedestal.position.y = 0.36;
    const basin = box(0.85, 0.2, 0.62, mat("#eef0ec", 0.5));
    basin.position.y = 0.83;
    const faucet = box(0.07, 0.22, 0.07, mat("#9aa4a8", 0.3));
    faucet.position.set(0, 1.0, -0.2);
    g.add(pedestal, basin, faucet);
  } else if (t === "kitchen_sink") {
    const cab = box(1.2, 0.85, 0.85, mat("#8d7454", 0.7));
    cab.position.y = 0.42;
    const top = box(1.24, 0.08, 0.9, mat("#c9cdcf", 0.35));
    top.position.y = 0.9;
    const faucet = box(0.07, 0.3, 0.07, mat("#9aa4a8", 0.3));
    faucet.position.set(0, 1.05, -0.28);
    g.add(cab, top, faucet);
  } else if (t === "dining_table") {
    const top = box(1.8, 0.1, 1.05, main);
    top.position.y = 0.78;
    for (const [lx, lz] of [[-0.8, -0.42], [0.8, -0.42], [-0.8, 0.42], [0.8, 0.42]]) {
      const leg = box(0.1, 0.74, 0.1, main);
      leg.position.set(lx, 0.37, lz);
      g.add(leg);
    }
    g.add(top);
  } else if (t === "dining_chair") {
    const seat = box(0.55, 0.1, 0.55, main);
    seat.position.y = 0.48;
    const back = box(0.55, 0.5, 0.08, main);
    back.position.set(0, 0.78, -0.24);
    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
      const leg = box(0.07, 0.46, 0.07, main);
      leg.position.set(lx, 0.23, lz);
      g.add(leg);
    }
    g.add(seat, back);
  } else if (t === "dresser") {
    const bodyM = box(1.6, 1.1, 0.6, main);
    bodyM.position.y = 0.55;
    for (const dy of [0.3, 0.62, 0.94]) {
      const knob = box(0.09, 0.05, 0.05, mat("#d8c9a8", 0.4));
      knob.position.set(0, dy, 0.32);
      g.add(knob);
    }
    g.add(bodyM);
  } else if (t === "lamp") {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.06, 10),
      mat("#2f3438", 0.5)
    );
    base.position.y = 0.03;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.2, 8),
      mat("#2f3438", 0.5)
    );
    pole.position.y = 0.65;
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, 0.32, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex || "#e9dfc8"),
        emissive: 0xffe9c0, emissiveIntensity: 0.35,
        roughness: 0.85, side: THREE.DoubleSide,
      })
    );
    shade.position.y = 1.42;
    g.add(base, pole, shade);
    return { group: g, mainMaterial: shade.material };
  } else {
    const spec = FURNITURE_TYPES[t] || { size: [1, 1, 1] };
    const fallback = box(spec.size[0], spec.size[1], spec.size[2], main);
    fallback.position.y = spec.size[1] / 2;
    g.add(fallback);
  }

  return { group: g, mainMaterial: main };
}

// Renders ONE level of a property blueprint at a lot origin.
export function createBlueprintLayer({
  scene,
  colliders,
  interactive,
  objectMap,
  originX,
  originZ,
  scale = 1,
  blueprint,
  level = "ground",
  guest = false,
  idPrefix = "",
}) {
  const layer = new THREE.Group();
  layer.name = `RealmLifeBlueprint-${idPrefix}${level}`;
  scene.add(layer);

  const layerTag = `${idPrefix}${level}-${Math.random().toString(36).slice(2, 8)}`;
  const registered = [];

  const items = (blueprint?.furniture || []).filter(
    (f) => (f.level || "ground") === level
  );

  items.forEach((f) => {
    const spec = FURNITURE_TYPES[f.type];
    if (!spec) return;

    const { group, mainMaterial } = buildFurnitureMesh(f.type, f.color);
    const wx = originX + f.x * scale;
    const wz = originZ + f.z * scale;
    group.position.set(wx, 0, wz);
    group.rotation.y = -((f.rot || 0) * Math.PI) / 180;

    const actions = guest
      ? GUEST_ACTIONS[f.type] || [{ id: "admire", label: "Admire" }]
      : OWNER_ACTIONS[f.type] || [{ id: "admire", label: "Admire" }];

    const id = `${idPrefix}${f.instance_id}`;
    group.userData.lifeObject = true;
    group.userData.id = id;
    group.userData.label = spec.label;
    group.userData.actions = actions;
    group.userData.approach = APPROACH[f.type] || [0, 1.25];
    group.userData.interactionAnchor = ANCHORS[f.type] || null;
    group.userData.rlEditable = !guest;
    group.userData.rlInstanceId = f.instance_id;
    group.userData.rlType = f.type;
    group.userData.rlMainMaterial = mainMaterial;

    layer.add(group);
    interactive.push(group);
    objectMap?.set(id, group);
    registered.push(group);

    // Bed stays walkable (bed hard-rescue behaviour preserved).
    if (f.type !== "bed") {
      const rot = (f.rot || 0) % 180;
      const [w, , d] = spec.size;
      const axisAligned = rot % 90 === 0;
      const swapped = axisAligned && rot === 90;
      const ext = Math.max(w, d);
      colliders.push({
        x: wx,
        z: wz,
        hw: (axisAligned ? (swapped ? d : w) : ext) / 2 * scale + 0.22,
        hd: (axisAligned ? (swapped ? w : d) : ext) / 2 * scale + 0.22,
        bpLayer: layerTag,
        objectId: id,
      });
    }
  });

  return {
    layerTag,
    group: layer,
    meshes: registered,
    dispose() {
      for (let i = colliders.length - 1; i >= 0; i -= 1) {
        if (colliders[i].bpLayer === layerTag) colliders.splice(i, 1);
      }
      registered.forEach((obj) => {
        const idx = interactive.indexOf(obj);
        if (idx >= 0) interactive.splice(idx, 1);
        objectMap?.delete(obj.userData.id);
      });
      scene.remove(layer);
    },
  };
}

export const LEVEL_LABELS = {
  ground: "GROUND",
  second: "LEVEL 2",
  third: "LEVEL 3",
  b1: "BASEMENT 1",
  b2: "BASEMENT 2",
  b3: "BASEMENT 3",
};

export function builtLevelKeys(levelsAbove, levelsBelow) {
  const keys = ["ground"];
  if (levelsAbove >= 2) keys.push("second");
  if (levelsAbove >= 3) keys.push("third");
  for (let i = 1; i <= (levelsBelow || 0); i += 1) keys.push(`b${i}`);
  return keys;
}
