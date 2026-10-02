import { invalid } from "./errors";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type InlineImage = {
  mediaType: ImageMediaType;
  data: string;
  bytes: number;
  width?: number;
  height?: number;
};

function sniff(bytes: Uint8Array): ImageMediaType | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function dimensions(bytes: Uint8Array, type: ImageMediaType): { width?: number; height?: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (type === "image/png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (type === "image/gif" && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (type === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + view.getUint16(offset + 2);
      }
    }
  } catch {
    // Unknown layout: fall back to the conservative token estimate.
  }
  return {};
}

/**
 * Accept only inline base64 data URLs. Remote image URLs are refused so the
 * proxy never fetches attacker-chosen addresses on the player's behalf.
 */
export function parseImageUrl(url: unknown, maxBytes: number): InlineImage {
  if (typeof url !== "string") throw invalid("unsupported_image", "image_url.url must be a string");
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!match) throw invalid("unsupported_image", "Only base64 PNG, JPEG, GIF or WebP data URLs are accepted");
  const data = match[2].replace(/\s+/g, "");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((data.length * 3) / 4) - padding;
  if (bytes > maxBytes) {
    throw invalid("image_too_large", `Each image must be at most ${Math.floor(maxBytes / 1_000)} KB; downscale it first`);
  }
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  } catch {
    throw invalid("unsupported_image", "Image data is not valid base64");
  }
  const mediaType = sniff(decoded);
  if (!mediaType) throw invalid("unsupported_image", "Image bytes are not PNG, JPEG, GIF or WebP");
  return { mediaType, data, bytes: decoded.length, ...dimensions(decoded, mediaType) };
}
