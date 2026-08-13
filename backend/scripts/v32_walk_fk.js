// FK analysis: compute world-space foot trajectory per frame; report dominant horizontal axis.
// A forward stride oscillates along the facing axis; a strafe oscillates laterally.
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

const V = {
  qmul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  qrot: (q, v) => {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
  },
  nlerp: (a, b, t) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = d < 0 ? -1 : 1;
    const o = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
    const l = Math.hypot(...o);
    return o.map((v) => v / l);
  },
  lerp3: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

function sampler(track, size) {
  const times = track.getInput().getArray();
  const vals = track.getOutput().getArray();
  return (t) => {
    if (t <= times[0]) return Array.from(vals.slice(0, size));
    const last = times.length - 1;
    if (t >= times[last]) return Array.from(vals.slice(last * size, last * size + size));
    let i = 0;
    while (times[i + 1] < t) i++;
    const f = (t - times[i]) / (times[i + 1] - times[i]);
    const a = Array.from(vals.slice(i * size, i * size + size));
    const b = Array.from(vals.slice((i + 1) * size, (i + 1) * size + size));
    return size === 4 ? V.nlerp(a, b, f) : V.lerp3(a, b, f);
  };
}

async function analyze(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const dec = require('draco3dgltf');
  io.registerDependencies({ 'draco3d.decoder': await dec.createDecoderModule() });
  const doc = await io.read(file);
  const anim = doc.getRoot().listAnimations()[0];
  const chans = { t: new Map(), r: new Map() };
  let dur = 0;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!node) continue;
    const s = ch.getSampler();
    const times = s.getInput().getArray();
    dur = Math.max(dur, times[times.length - 1]);
    if (ch.getTargetPath() === 'translation') chans.t.set(node, sampler(s, 3));
    if (ch.getTargetPath() === 'rotation') chans.r.set(node, sampler(s, 4));
  }
  const scene = doc.getRoot().listScenes()[0];
  const targets = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'Hips'];
  const results = {};
  const worldPos = (node, t) => {
    // walk up hierarchy accumulating TRS
    let pos = [0, 0, 0], rot = [0, 0, 0, 1];
    const chain = [];
    let n = node;
    while (n) { chain.unshift(n); n = n.getParentNode ? n.getParentNode() : null; }
    for (const c of chain) {
      const lt = chans.t.get(c) ? chans.t.get(c)(t) : c.getTranslation();
      const lr = chans.r.get(c) ? chans.r.get(c)(t) : c.getRotation();
      const ls = c.getScale();
      const scaled = [lt[0], lt[1], lt[2]];
      const rotated = V.qrot(rot, scaled);
      pos = [pos[0] + rotated[0], pos[1] + rotated[1], pos[2] + rotated[2]];
      rot = V.qmul(rot, lr);
    }
    return pos;
  };
  const allNodes = doc.getRoot().listNodes();
  for (const tn of targets) {
    const node = allNodes.find((n) => n.getName() === tn);
    if (!node) continue;
    const N = 40;
    const pts = [];
    for (let i = 0; i < N; i++) pts.push(worldPos(node, (dur * i) / (N - 1)));
    const mean = [0, 0, 0];
    pts.forEach((p) => { mean[0] += p[0] / N; mean[1] += p[1] / N; mean[2] += p[2] / N; });
    // horizontal covariance (X, Z)
    let sxx = 0, szz = 0, sxz = 0;
    pts.forEach((p) => { const dx = p[0] - mean[0], dz = p[2] - mean[2]; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; });
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz) * 180 / Math.PI;
    const rangeX = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const rangeZ = Math.max(...pts.map((p) => p[2])) - Math.min(...pts.map((p) => p[2]));
    const minY = Math.min(...pts.map((p) => p[1]));
    results[tn] = { rangeX: rangeX.toFixed(3), rangeZ: rangeZ.toFixed(3), minY: minY.toFixed(2), dominantAxisDeg: angle.toFixed(1) };
  }
  console.log(`\n${file.split('/').pop()} clip="${anim.getName()}" dur=${dur.toFixed(2)}s`);
  for (const [k, v] of Object.entries(results)) console.log(`  ${k}: rangeX=${v.rangeX} rangeZ=${v.rangeZ} minY=${v.minY} axis(deg from +X)=${v.dominantAxisDeg}`);
}
(async () => { for (const f of process.argv.slice(2)) await analyze(f); })();
