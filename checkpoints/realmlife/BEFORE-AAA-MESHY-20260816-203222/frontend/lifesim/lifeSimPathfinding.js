const SQRT2 = Math.SQRT2;

const dist = (a, b) =>
  Math.hypot(a.x - b.x, a.z - b.z);

function lineClear(a, b, blocked, sample = 0.18) {
  const d = dist(a, b);
  if (d < 0.001) return true;

  const steps = Math.max(1, Math.ceil(d / sample));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;

    if (blocked(x, z)) return false;
  }

  return true;
}

function smoothPath(points, blocked) {
  if (points.length <= 2) return points;

  const result = [points[0]];
  let from = 0;

  while (from < points.length - 1) {
    let best = from + 1;

    for (let to = points.length - 1; to > from + 1; to--) {
      if (lineClear(points[from], points[to], blocked)) {
        best = to;
        break;
      }
    }

    result.push(points[best]);
    from = best;
  }

  return result;
}

export function findGridPath(
  start,
  goal,
  blocked,
  {
    step = 0.5,
    minX = -8,
    maxX = 8,
    minZ = -6,
    maxZ = 6,
  } = {}
) {
  const minGX = Math.ceil(minX / step);
  const maxGX = Math.floor(maxX / step);
  const minGZ = Math.ceil(minZ / step);
  const maxGZ = Math.floor(maxZ / step);

  const toCell = (p) => ({
    x: Math.round(p.x / step),
    z: Math.round(p.z / step),
  });

  const toWorld = (c) => ({
    x: c.x * step,
    z: c.z * step,
  });

  const key = (c) => `${c.x},${c.z}`;

  const inside = (c) =>
    c.x >= minGX &&
    c.x <= maxGX &&
    c.z >= minGZ &&
    c.z <= maxGZ;

  const cellBlocked = (c) => {
    if (!inside(c)) return true;
    const p = toWorld(c);
    return blocked(p.x, p.z);
  };

  const nearestOpen = (wanted) => {
    if (!cellBlocked(wanted)) return wanted;

    for (let radius = 1; radius <= 5; radius++) {
      let best = null;
      let bestD = Infinity;

      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (
            Math.abs(dx) !== radius &&
            Math.abs(dz) !== radius
          ) continue;

          const c = {
            x: wanted.x + dx,
            z: wanted.z + dz,
          };

          if (cellBlocked(c)) continue;

          const d = Math.hypot(dx, dz);

          if (d < bestD) {
            best = c;
            bestD = d;
          }
        }
      }

      if (best) return best;
    }

    return null;
  };

  const s = nearestOpen(toCell(start));
  const g = nearestOpen(toCell(goal));

  if (!s || !g) return [];

  if (s.x === g.x && s.z === g.z) {
    return [{ x: goal.x, z: goal.z }];
  }

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],

    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ];

  const open = new Map();
  const closed = new Set();
  const parents = new Map();
  const scores = new Map();

  const sk = key(s);

  scores.set(sk, 0);

  open.set(sk, {
    ...s,
    g: 0,
    f: Math.hypot(g.x - s.x, g.z - s.z),
  });

  let found = null;

  while (open.size) {
    let currentKey = null;
    let current = null;

    for (const [k, n] of open) {
      if (!current || n.f < current.f) {
        currentKey = k;
        current = n;
      }
    }

    open.delete(currentKey);

    if (current.x === g.x && current.z === g.z) {
      found = current;
      break;
    }

    closed.add(currentKey);

    for (const [dx, dz, cost] of dirs) {
      const next = {
        x: current.x + dx,
        z: current.z + dz,
      };

      const nk = key(next);

      if (closed.has(nk) || cellBlocked(next)) continue;

      // Prevent diagonal corner-cutting through furniture/walls.
      if (dx !== 0 && dz !== 0) {
        const sideA = { x: current.x + dx, z: current.z };
        const sideB = { x: current.x, z: current.z + dz };

        if (cellBlocked(sideA) || cellBlocked(sideB)) continue;
      }

      const tentative =
        current.g + cost;

      if (
        scores.has(nk) &&
        tentative >= scores.get(nk)
      ) continue;

      scores.set(nk, tentative);
      parents.set(nk, currentKey);

      const h = Math.hypot(
        g.x - next.x,
        g.z - next.z
      );

      open.set(nk, {
        ...next,
        g: tentative,
        f: tentative + h,
      });
    }
  }

  if (!found) return [];

  const cells = [];
  let cursor = key(found);

  while (cursor) {
    const [x, z] = cursor.split(",").map(Number);
    cells.push({ x, z });
    cursor = parents.get(cursor);
  }

  cells.reverse();

  let points = cells.map(toWorld);

  // Start from actual current position.
  points[0] = {
    x: start.x,
    z: start.z,
  };

  // Preserve exact destination when it is itself walkable.
  if (!blocked(goal.x, goal.z)) {
    points[points.length - 1] = {
      x: goal.x,
      z: goal.z,
    };
  }

  points = smoothPath(points, blocked);

  // Caller already knows current position.
  return points.slice(1);
}
