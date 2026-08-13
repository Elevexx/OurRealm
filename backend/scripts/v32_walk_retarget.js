// V32 zero-credit walk retarget (final): copy natural "walking_man" clip onto each avatar's
// walk GLB by bone name; solve hips-Y additive offset so toe ground level matches the old clip.
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { prune } = require('@gltf-transform/functions');

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
    const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
    const o = [a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t];
    const l = Math.hypot(...o);
    return o.map((v) => v / l);
  },
  lerp3: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

function trackSampler(times, values, size) {
  return (t) => {
    if (t <= times[0]) return values.slice(0, size);
    const last = times.length - 1;
    if (t >= times[last]) return values.slice(last * size, last * size + size);
    let i = 0;
    while (times[i + 1] < t) i++;
    const f = (t - times[i]) / (times[i + 1] - times[i]);
    const a = values.slice(i * size, i * size + size), b = values.slice((i + 1) * size, (i + 1) * size + size);
    return size === 4 ? V.nlerp(a, b, f) : V.lerp3(a, b, f);
  };
}

function extractTracks(anim) {
  const tracks = [];
  let dur = 0;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!node) continue;
    const s = ch.getSampler();
    const times = Array.from(s.getInput().getArray());
    dur = Math.max(dur, times[times.length - 1]);
    tracks.push({ name: node.getName(), path: ch.getTargetPath(), times, values: Array.from(s.getOutput().getArray()), interp: s.getInterpolation() });
  }
  return { tracks, dur };
}

// FK: min world Y of toe/foot bones over the clip, using given hierarchy + tracks
function minToeY(doc, tracks, dur) {
  const byNode = { t: new Map(), r: new Map() };
  const nodeByName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
  for (const t of tracks) {
    const node = nodeByName.get(t.name);
    if (!node) continue;
    const s = trackSampler(t.times, t.values, t.path === 'rotation' ? 4 : 3);
    if (t.path === 'translation') byNode.t.set(node, s);
    if (t.path === 'rotation') byNode.r.set(node, s);
  }
  const worldPos = (node, t) => {
    let pos = [0, 0, 0], rot = [0, 0, 0, 1];
    const chain = [];
    let n = node;
    while (n) { chain.unshift(n); n = n.getParentNode ? n.getParentNode() : null; }
    for (const c of chain) {
      const lt = byNode.t.get(c) ? byNode.t.get(c)(t) : c.getTranslation();
      const lr = byNode.r.get(c) ? byNode.r.get(c)(t) : c.getRotation();
      const rd = V.qrot(rot, lt);
      pos = [pos[0] + rd[0], pos[1] + rd[1], pos[2] + rd[2]];
      rot = V.qmul(rot, lr);
    }
    return pos;
  };
  let min = Infinity;
  for (const bn of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) {
    const node = nodeByName.get(bn);
    if (!node) continue;
    for (let i = 0; i < 40; i++) {
      const y = worldPos(node, (dur * i) / 39)[1];
      if (y < min) min = y;
    }
  }
  return min;
}

(async () => {
  const [srcFile, ...pairs] = process.argv.slice(2);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const dec = require('draco3dgltf');
  io.registerDependencies({ 'draco3d.decoder': await dec.createDecoderModule(), 'draco3d.encoder': await dec.createEncoderModule() });
  const srcDoc = await io.read(srcFile);
  const { tracks: srcTracks, dur: srcDur } = extractTracks(srcDoc.getRoot().listAnimations()[0]);
  console.log(`source clip tracks=${srcTracks.length} dur=${srcDur.toFixed(2)}s`);

  for (const pair of pairs) {
    const [dst, out] = pair.split(':');
    const doc = await io.read(dst);
    const root = doc.getRoot();
    const nodeByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
    const missing = [...new Set(srcTracks.filter((t) => !nodeByName.has(t.name)).map((t) => t.name))];
    if (missing.length) { console.error(`SKIP ${dst}: missing bones ${missing.join(',')}`); continue; }
    const oldAnim = root.listAnimations()[0];
    const { tracks: oldTracks, dur: oldDur } = extractTracks(oldAnim);
    const oldMin = minToeY(doc, oldTracks, oldDur);
    // build hybrid: source rotations + dest's own bone-length translations; hips bob rebased to dest mean
    const meanOf = (vals, axis) => {
      let s = 0; const n = vals.length / 3;
      for (let i = 0; i < n; i++) s += vals[i * 3 + axis];
      return s / n;
    };
    const oldHipsT = oldTracks.find((t) => t.name === 'Hips' && t.path === 'translation');
    const srcHipsT = srcTracks.find((t) => t.name === 'Hips' && t.path === 'translation');
    const oldMean = [0, 1, 2].map((a) => meanOf(oldHipsT.values, a));
    const srcMean = [0, 1, 2].map((a) => meanOf(srcHipsT.values, a));
    const hybrid = [];
    for (const t of srcTracks) {
      if (t.path === 'rotation') { hybrid.push(t); continue; }
      if (t.name === 'Hips' && t.path === 'translation') {
        hybrid.push({ ...t, values: t.values.map((v, i) => oldMean[i % 3] + (v - srcMean[i % 3])) });
        continue;
      }
      // bone-length translation/scale: use dest's own (static) track if present, else dest rest
      const own = oldTracks.find((o) => o.name === t.name && o.path === t.path);
      hybrid.push(own ? { ...t, times: [0], values: own.values.slice(0, t.path === 'rotation' ? 4 : 3) } : t);
    }
    const newMin0 = minToeY(doc, hybrid, srcDur);
    const offset = oldMin - newMin0;
    const hipsIdx = hybrid.findIndex((t) => t.name === 'Hips' && t.path === 'translation');
    hybrid[hipsIdx] = { ...hybrid[hipsIdx], values: hybrid[hipsIdx].values.map((v, i) => (i % 3 === 1 ? v + offset : v)) };
    for (const a of root.listAnimations()) a.dispose();
    const buffer = root.listBuffers()[0] || doc.createBuffer();
    const anim = doc.createAnimation('walk_natural_forward');
    for (const t of hybrid) {
      const vals = t.values;
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(t.times)).setBuffer(buffer);
      const output = doc.createAccessor().setType(t.path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(vals)).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(t.interp || 'LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodeByName.get(t.name)).setTargetPath(t.path).setSampler(sampler));
    }
    await doc.transform(prune());
    await io.write(out, doc);
    console.log(`OK ${out} oldToeMin=${oldMin.toFixed(2)} newToeMin0=${newMin0.toFixed(2)} hipsYOffset=${offset.toFixed(2)}`);
  }
})();
