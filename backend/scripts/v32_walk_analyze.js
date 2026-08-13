// Analyze walk clips: measure foot bone local-space motion axes to detect strafe vs forward stride.
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

async function analyze(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  try {
    const dec = require('draco3dgltf');
    io.registerDependencies({ 'draco3d.decoder': await dec.createDecoderModule() });
  } catch (e) {}
  const doc = await io.read(file);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  console.log(`\n=== ${file} — ${anims.length} animation(s)`);
  for (const anim of anims) {
    console.log(`  clip: "${anim.getName()}" channels=${anim.listChannels().length}`);
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const name = node ? node.getName() : '?';
      if (!/hips|foot|root|pelvis/i.test(name)) continue;
      if (path !== 'translation') continue;
      const sampler = ch.getSampler();
      const out = sampler.getOutput().getArray();
      const n = out.length / 3;
      let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 3; a++) {
          const v = out[i * 3 + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }
      const range = max.map((v, i) => (v - min[i]).toFixed(4));
      const first = [out[0], out[1], out[2]];
      const last = [out[(n - 1) * 3], out[(n - 1) * 3 + 1], out[(n - 1) * 3 + 2]];
      const net = last.map((v, i) => (v - first[i]).toFixed(4));
      console.log(`    ${name} [translation] frames=${n} rangeXYZ=${range.join(', ')} first=${first.map(v=>v.toFixed(3)).join(',')} netXYZ=${net.join(', ')}`);
      if (/hips/i.test(name)) {
        const parent = node.getParentNode ? node.getParentNode() : null;
        console.log(`    hips parent: ${parent ? parent.getName() : 'scene-root'}`);
      }
    }
    // rotation of hips at first frame
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      if (!node || !/hips/i.test(node.getName()) || ch.getTargetPath() !== 'rotation') continue;
      const out = ch.getSampler().getOutput().getArray();
      const q0 = [out[0], out[1], out[2], out[3]].map((v) => v.toFixed(3));
      const mid = Math.floor(out.length / 8) * 4;
      const qm = [out[mid], out[mid + 1], out[mid + 2], out[mid + 3]].map((v) => v.toFixed(3));
      // yaw from quaternion (y-axis rotation approx)
      const yaw = (q) => (Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0])) * 180 / Math.PI).toFixed(1);
      console.log(`    ${node.getName()} [rotation] q0=${q0.join(',')} yaw0=${yaw(out.slice(0,4))} yawMid=${yaw(out.slice(mid, mid+4))}`);
    }
  }
}

(async () => {
  for (const f of process.argv.slice(2)) await analyze(f);
})();
