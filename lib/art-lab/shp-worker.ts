import { decodeShp } from "./shp";
self.onmessage = (event: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  try {
    const shp = decodeShp(event.data.bytes);
    self.postMessage({ id: event.data.id, shp }, { transfer: shp.frames.flatMap(f => [f.pixels.buffer as ArrayBuffer, ...(f.rgba ? [f.rgba.buffer as ArrayBuffer] : [])]) });
  } catch (e) { self.postMessage({ id: event.data.id, error: e instanceof Error ? e.message : "Sprite decode failed" }); }
};
