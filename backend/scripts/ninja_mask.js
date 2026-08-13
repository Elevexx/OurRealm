// Zero-credit ninja emissive mask: grayscale the baked-green emissive texture in the master GLB
// so runtime emissive color controls glow. Usage: node ninja_mask.js <in.glb> <out.glb>
const { NodeIO } = require('@gltf-transform/core');
const sharp = require('sharp');
(async () => {
  const [inF, outF] = process.argv.slice(2);
  const io = new NodeIO();
  const doc = await io.read(inF);
  let touched = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const tex = mat.getEmissiveTexture();
    if (tex) {
      const img = tex.getImage();
      const gray = await sharp(Buffer.from(img)).grayscale().linear(1.6, 0).png().toBuffer();
      tex.setImage(new Uint8Array(gray)); tex.setMimeType('image/png');
      mat.setEmissiveFactor([1, 1, 1]);
      touched += 1;
    } else if (mat.getEmissiveFactor().some((v) => v > 0.01)) {
      mat.setEmissiveFactor([1, 1, 1]); touched += 1;
    }
  }
  await io.write(outF, doc);
  console.log('emissive materials neutralized:', touched);
})();
