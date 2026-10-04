import { isPlayerColorMarker, remapImagePixels, validImagePlayerColor, type ImagePlayerColor } from "./image-remap";

/** Decode and color processing stay off the Studio's input/paint thread. No render timer. */
self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; mask: ImagePlayerColor; color: string }>) => {
  const { bitmap, mask, color } = event.data;
  try {
    if (!validImagePlayerColor(mask)) throw new Error("Invalid authored remap regions");
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const source = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const maskCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const m = maskCanvas.getContext("2d")!;
    m.scale(bitmap.width / mask.width, bitmap.height / mask.height);
    m.fillStyle = "white";
    for (const region of mask.regions) {
      m.beginPath(); region.forEach(([x, y], i) => i ? m.lineTo(x, y) : m.moveTo(x, y)); m.closePath(); m.fill();
    }
    const rgba = m.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const alpha = new Uint8ClampedArray(bitmap.width * bitmap.height);
    for (let p = 0; p < alpha.length; p++) {
      const i = p * 4;
      alpha[p] = mask.marker === "explicit" || isPlayerColorMarker(source.data[i], source.data[i + 1], source.data[i + 2]) ? rgba[i + 3] : 0;
    }
    source.data.set(remapImagePixels(source.data, alpha, color));
    ctx.putImageData(source, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Image color preview failed" });
  } finally { bitmap.close(); }
};
