// Decoded pixels of same-origin images (EarthScope's /api/imagery), cached per URL.
export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.decoding = "async";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image failed"));
    el.src = src;
  });
}
const pixelCache = new Map<string, Promise<ImageData>>();
/** Pixels of a same-origin image, decoded at `size`×`size` without smoothing (categorical colours stay exact). */
export function pixels(src: string, size: number) {
  let job = pixelCache.get(src);
  if (!job) {
    job = loadImage(src).then(el => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false; // categorical colours must not be blended
      ctx.drawImage(el, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size);
    });
    job.catch(() => pixelCache.delete(src));
    pixelCache.set(src, job);
  }
  return job;
}

