"use client";

import { useEffect, useRef } from "react";

export type Backdrop = "sand" | "grass" | "dark" | "checker" | "none";
export const backdrops: { id: Backdrop; label: string; rgb: [number, number, number] | null }[] = [
  { id: "sand", label: "Sand", rgb: [196, 160, 96] },
  { id: "grass", label: "Grass", rgb: [104, 116, 58] },
  { id: "dark", label: "Dark", rgb: [21, 24, 21] },
  { id: "checker", label: "Checker", rgb: null },
];

export function backdropRgb(id: Backdrop): [number, number, number] {
  return backdrops.find(b => b.id === id)?.rgb ?? [60, 64, 58];
}

export type PixelImage = { width: number; height: number; data: Uint8ClampedArray; anchorX: number; anchorY: number };

/** Paints a 1x image over a backdrop and the map tint, as OpenRA's tint pass tints the whole frame. */
export function paintPixels(canvas: HTMLCanvasElement, image: PixelImage, backdrop: Backdrop, tint: [number, number, number], diamond: boolean) {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, image.width, image.height);
  if (backdrop === "checker") {
    for (let y = 0; y < image.height; y += 4) for (let x = 0; x < image.width; x += 4) {
      ctx.fillStyle = ((x >> 2) + (y >> 2)) % 2 ? "#343832" : "#464b43";
      ctx.fillRect(x, y, 4, 4);
    }
  } else if (backdrop !== "none") {
    const [r, g, b] = backdropRgb(backdrop);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, image.width, image.height);
  }
  if (diamond) {
    // One 60x30 terrain cell under the actor's centre, for scale.
    const { anchorX: cx, anchorY: cy } = image;
    ctx.strokeStyle = "rgba(241, 210, 139, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy + 0.5); ctx.lineTo(cx, cy - 15 + 0.5); ctx.lineTo(cx + 30, cy + 0.5); ctx.lineTo(cx, cy + 15 + 0.5); ctx.closePath();
    ctx.stroke();
  }
  const layer = document.createElement("canvas");
  layer.width = image.width;
  layer.height = image.height;
  layer.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  ctx.drawImage(layer, 0, 0);
  if (tint[0] !== 1 || tint[1] !== 1 || tint[2] !== 1) {
    const frame = ctx.getImageData(0, 0, image.width, image.height);
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] *= tint[0]; frame.data[i + 1] *= tint[1]; frame.data[i + 2] *= tint[2];
    }
    ctx.putImageData(frame, 0, 0);
  }
}

/** A 1x image scaled with nearest-neighbour so every game pixel stays a crisp square. */
export function PixelCanvas({ image, zoom, backdrop = "sand", tint = [1, 1, 1], label, className, diamond = false }: {
  image: PixelImage | null;
  zoom: number;
  backdrop?: Backdrop;
  tint?: [number, number, number];
  label: string;
  className?: string;
  diamond?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && image) paintPixels(ref.current, image, backdrop, tint, diamond);
  }, [image, backdrop, tint, diamond]);
  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label={label}
      width={image?.width ?? 1}
      height={image?.height ?? 1}
      style={{ width: image ? image.width * zoom : 0, height: image ? image.height * zoom : 0, imageRendering: "pixelated" }}
    />
  );
}
