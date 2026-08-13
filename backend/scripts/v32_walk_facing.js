// Compare hips average facing between clips (relative yaw around armature-vertical).
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

async function facing(file) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const dec = require('draco3dgltf');
  io.registerDependencies({ 'draco3d.decoder': await dec.createDecoderModule() });
  const doc = await io.read(file);
  const anim = doc.getRoot().listAnimations()[0];
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!node || node.getName() !== 'Hips' || ch.getTargetPath() !== 'rotation') continue;
    const out = ch.getSampler().getOutput().getArray();
    const n = out.length / 4;
    // average forward yaw across frames: rotate +Y (spine up in Z-up hips) & +Z
    let sx = 0, sz = 0;
    for (let i = 0; i < n; i++) {
      const q = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]];
      const f = rotate(q, [0, 1, 0]); // hips local +Y often points "forward-ish" after -90X rest
      sx += f[0]; sz += f[2];
    }
    const yawY = Math.atan2(sx / n, sz / n) * 180 / Math.PI;
    sx = 0; sz = 0;
    for (let i = 0; i < n; i++) {
      const q = [out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]];
      const f = rotate(q, [0, 0, 1]);
      sx += f[0]; sz += f[2];
    }
    const yawZ = Math.atan2(sx / n, sz / n) * 180 / Math.PI;
    console.log(`${file.split('/').pop()} clip="${anim.getName()}" frames=${n} avgYaw(+Y)=${yawY.toFixed(1)} avgYaw(+Z)=${yawZ.toFixed(1)}`);
  }
}
(async () => { for (const f of process.argv.slice(2)) await facing(f); })();
