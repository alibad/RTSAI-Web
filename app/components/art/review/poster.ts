"use client";
/* The before/after faction poster: every new unit at 1x, what is in game now beside the new game model, drawn
   from the Studio's own frames (project art and project-generated candidates only) on procedural ground. */
import type { FrameStore, Pose, StageItem, Frame } from "./frames";
import { groundFor, groundTile } from "./ground";

export type PosterRow = { name: string; category: string; current: StageItem | null; next: StageItem | null; note: string };

const POSE: Pose = { facing: 896, turret: 0, tick: 0, animation: "stand", color: "F21818", shadow: true, tint: [1, 1, 1], airborne: false };

/** Waits (without blocking) until every picture is rendered, or the time limit passes. */
async function framesFor(items: (StageItem | null)[], frames: FrameStore, limitMs = 20000) {
  const out = new Map<StageItem, Frame>();
  const start = performance.now();
  while (performance.now() - start < limitMs) {
    for (const item of items) {
      if (!item || out.has(item)) continue;
      const f = frames.peek(item, POSE);
      if (f) out.set(item, f); else frames.want(item, POSE, true);
    }
    if (items.every(i => !i || out.has(i) || frames.failed(i))) break;
    await new Promise(r => setTimeout(r, 60));
  }
  return out;
}

const CELL_W = 236, CELL_H = 150, PIC_W = 112, COLS = 5, HEAD = 92;

/** Draws the poster and returns it as a PNG blob (encoding happens off the main thread). */
export async function composePoster(title: string, subtitle: string, rows: PosterRow[], frames: FrameStore): Promise<Blob> {
  const items = rows.flatMap(r => [r.current, r.next]);
  const pictures = await framesFor(items, frames);
  const cols = Math.min(COLS, Math.max(1, rows.length));
  const canvas = document.createElement("canvas");
  canvas.width = 24 * 2 + cols * CELL_W;
  canvas.height = HEAD + Math.ceil(rows.length / cols) * CELL_H + 28;
  // CPU-backed, so encoding the PNG never waits on a GPU readback.
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0e110e"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f0eee6"; ctx.font = "700 24px Arial, sans-serif"; ctx.fillText(title, 24, 40);
  ctx.fillStyle = "#a3a397"; ctx.font = "500 13px Arial, sans-serif"; ctx.fillText(subtitle, 24, 64);
  rows.forEach((row, i) => {
    const x = 24 + (i % cols) * CELL_W, y = HEAD + Math.floor(i / cols) * CELL_H;
    ctx.fillStyle = "#141814"; ctx.fillRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
    for (const [k, item] of [[0, row.current], [1, row.next]] as const) {
      const cx = x + 8 + k * PIC_W + PIC_W / 2, cy = y + 66;
      // Each picture stays inside its half of the cell (a large ship at 1x would run into its neighbour).
      ctx.save(); ctx.beginPath(); ctx.rect(x + 6 + k * PIC_W, y + 6, PIC_W - 2, 108); ctx.clip();
      const ground = groundTile(groundFor(row.category, "sand"), [1, 1, 1], 90);
      ctx.drawImage(ground.canvas, Math.round(cx - ground.anchorX), Math.round(cy - ground.anchorY));
      const f = item ? pictures.get(item) : undefined;
      if (f) ctx.drawImage(f.canvas, Math.round(cx - f.anchorX), Math.round(cy - f.anchorY));
      else { ctx.fillStyle = "#73776d"; ctx.font = "500 11px Arial, sans-serif"; ctx.textAlign = "center"; ctx.fillText(item ? "not rendered" : "no new model yet", cx, cy + 4); ctx.textAlign = "left"; }
      ctx.restore();
      ctx.fillStyle = "#73776d"; ctx.font = "600 10px Arial, sans-serif"; ctx.fillText(k ? "NEW" : "IN GAME NOW", x + 12 + k * PIC_W, y + 18);
    }
    ctx.fillStyle = "#f0eee6"; ctx.font = "700 13px Arial, sans-serif"; ctx.fillText(row.name, x + 12, y + 128, CELL_W - 24);
    ctx.fillStyle = "#a3a397"; ctx.font = "500 11px Arial, sans-serif"; ctx.fillText(row.note, x + 12, y + 143, CELL_W - 24);
  });
  ctx.fillStyle = "#73776d"; ctx.font = "500 11px Arial, sans-serif";
  ctx.fillText("Project art and project-generated candidates only; no original game pixels. Candidates are not approved game art.", 24, canvas.height - 12);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
}
