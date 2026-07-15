// Canvas crop utility for ImageCropperModal — bakes the user's crop at
// full quality (no distortion, capped output dimensions).

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export async function getCroppedBlob(src, cropPixels, opts = {}) {
  const { maxWidth = 2560, mime = "image/jpeg", quality = 0.92 } = opts;
  const img = await loadImage(src);
  let outW = Math.round(cropPixels.width);
  let outH = Math.round(cropPixels.height);
  if (outW > maxWidth) {
    outH = Math.round(outH * (maxWidth / outW));
    outW = maxWidth;
  }
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  // alpha:true keeps the canvas transparent; clear instead of filling a
  // background so PNG/WebP exports keep their alpha channel intact.
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
    0, 0, outW, outH,
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Crop failed"))),
      mime, quality,
    );
  });
}
