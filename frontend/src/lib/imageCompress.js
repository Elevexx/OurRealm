/**
 * Client-side image compression before upload. Keeps files under the
 * backend's 3 MB per-image cap (phone photos are often 4-10 MB, which
 * previously failed with 413s — the "multi-image upload error").
 * Preserves PNG transparency; GIFs pass through untouched (animation).
 */
const TARGET_BYTES = 2.5 * 1024 * 1024;
const MAX_DIM = 2048;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function hasAlpha(canvas) {
  const ctx = canvas.getContext("2d");
  const step = Math.max(1, Math.floor(canvas.width / 64));
  try {
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4 * step) {
      if (d[i] < 255) return true;
    }
  } catch { return true; } // be safe: assume alpha
  return false;
}

export async function compressImageFile(file) {
  try {
    if (!file || !/^image\//.test(file.type)) return file;
    if (file.type === "image/gif") return file; // never re-encode animations
    if (file.size <= TARGET_BYTES) return file;

    const img = await loadImage(file);
    let { width, height } = img;
    let scale = Math.min(1, MAX_DIM / Math.max(width, height));

    const isPng = file.type === "image/png";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const transparent = isPng && hasAlpha(canvas);
      const type = transparent ? "image/png" : "image/jpeg";
      const quality = transparent ? undefined : Math.max(0.6, 0.85 - attempt * 0.08);
      const blob = await canvasToBlob(canvas, type, quality);
      if (blob && blob.size <= TARGET_BYTES) {
        const ext = transparent ? "png" : "jpg";
        const name = (file.name || "image").replace(/\.[^.]+$/, "") + `.${ext}`;
        return new File([blob], name, { type });
      }
      scale *= 0.75; // shrink and retry
    }
    return file; // give up gracefully — server will validate
  } catch {
    return file;
  }
}
