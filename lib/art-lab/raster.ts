/**
 * A software renderer for the in-game (battlefield) view of a voxel unit, using the same transform chain and
 * lighting formula as OpenRA's ModelRenderer and model shader. Pure and DOM-free: it renders faction overview
 * thumbnails without WebGL and gives tests and the accuracy check a reference image.
 *
 * Shader (glsl/model.frag): intensity = ambient + diffuse * max(dot(normal4, light4), 0), where the normals
 * palette stores alpha 1 (so normal4.w = 1) and the light vector has w = 1: the dot product is n.l + 1.
 */
import type { Hva } from "./hva";
import type { Palette } from "./pal";
import type { Vxl, VxlLimb } from "./vxl";
import type { Vec3 } from "./types";
import { groundProjection, localToWorld, multiply, partMatrices, rotateYaw, transformVector, type Mat4 } from "./voxel-math";

export type RasterPart = {
  vxl: Vxl;
  hva: Hva;
  /** Model yaw (WAngle) and world offset (WVec) for this part. */
  yaw: number;
  worldOffset: Vec3;
  frame: number;
  showShadow: boolean;
};

export type RasterUnit = {
  parts: RasterPart[];
  scale: number;
  cameraPitch: number;
  lightPitch: number;
  lightYaw: number;
  ambient: Vec3;
  diffuse: Vec3;
  palette: Palette;
  /** x, y, z triplets indexed by normal index. */
  normals: readonly number[];
  shadowColor: [number, number, number, number];
  /** Height above ground in WDist (aircraft); the shadow stays on the ground. */
  altitude?: number;
};

export type RasterImage = { width: number; height: number; data: Uint8ClampedArray; anchorX: number; anchorY: number };

const FACES: { dir: Vec3; corners: Vec3[] }[] = [
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
];

/** The normal as the shader sees it: through an 8-bit palette channel, then 2x - 1. */
export function quantizedNormal(normals: readonly number[], index: number): Vec3 {
  const q = (v: number) => (2 * Math.round(((v + 1) / 2) * 255)) / 255 - 1;
  if (3 * index + 2 >= normals.length) return [0, 0, 0];
  return [q(normals[3 * index]), q(normals[3 * index + 1]), q(normals[3 * index + 2])];
}

type Prepared = { limb: VxlLimb; toScreen: Mat4; shadow: Mat4 | null; light: Vec3 };

function prepare(unit: RasterUnit) {
  const altitudePx = unit.altitude ? (30 * unit.altitude) / 1448 : 0;
  const prepared: Prepared[] = [];
  for (const part of unit.parts) {
    const frame = Math.min(part.frame, Math.max(0, part.hva.frameCount - 1));
    part.vxl.limbs.forEach((limb, s) => {
      const row = part.hva.rows[frame]?.[s];
      if (!row) return;
      const m = partMatrices({
        scale: unit.scale, cameraPitch: unit.cameraPitch, lightPitch: unit.lightPitch, lightYaw: unit.lightYaw,
        pose: { yaw: part.yaw, worldOffset: part.worldOffset }, limb, hvaRow: row,
      });
      // The model is drawn at the actor's altitude; screen y moves up by the projected height.
      const lift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -altitudePx, 0, 1];
      const toScreen = multiply(lift, multiply(m.camera, m.modelToWorld));
      const shadow = part.showShadow ? multiply(m.camera, multiply(groundProjection(m.lightWorld, 0), m.modelToWorld)) : null;
      prepared.push({ limb, toScreen, shadow, light: m.light });
    });
  }
  return prepared;
}

function bounds(prepared: Prepared[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of prepared) {
    const [sx, sy, sz] = p.limb.size;
    for (const m of [p.toScreen, p.shadow]) {
      if (!m) continue;
      for (const c of [[0, 0, 0], [sx, 0, 0], [0, sy, 0], [0, 0, sz], [sx, sy, 0], [sx, 0, sz], [0, sy, sz], [sx, sy, sz]]) {
        const v = transformVector(m, [c[0], c[1], c[2], 1]);
        x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]);
        y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]);
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Renders the unit with the actor centre at (anchorX, anchorY) in the output. Pass a fixed size to align
 * several units on one grid; otherwise the image is cropped to the unit with a 2px margin.
 */
export function rasterizeUnit(unit: RasterUnit, frame?: { width: number; height: number; anchorX: number; anchorY: number }): RasterImage {
  const prepared = prepare(unit);
  const b = bounds(prepared);
  const width = frame?.width ?? Math.max(1, Math.ceil(b.x1) - Math.floor(b.x0) + 4);
  const height = frame?.height ?? Math.max(1, Math.ceil(b.y1) - Math.floor(b.y0) + 4);
  const anchorX = frame?.anchorX ?? 2 - Math.floor(b.x0);
  const anchorY = frame?.anchorY ?? 2 - Math.floor(b.y0);
  const n = width * height;
  const color = new Uint8ClampedArray(4 * n);
  const depth = new Float32Array(n).fill(-Infinity);
  const shadowMask = new Uint8Array(n);

  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, write: (i: number, z: number) => void) => {
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
        write(y * width + x, w0 * az + w1 * bz + w2 * cz);
      }
    }
  };

  const project = (m: Mat4, x: number, y: number, z: number) => {
    const v = transformVector(m, [x, y, z, 1]);
    return [v[0] + anchorX, v[1] + anchorY, v[2]];
  };

  for (const p of prepared) {
    const { limb } = p;
    const [sx, sy, sz] = limb.size;
    const filled = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && limb.filled[x + sx * (y + sy * z)] === 1;
    const light = p.light;
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      const index = x + sx * (y + sy * z);
      if (!limb.filled[index]) continue;
      const ci = limb.colors[index];
      const alpha = unit.palette[4 * ci + 3];
      const nrm = quantizedNormal(unit.normals, limb.normals[index]);
      const d = Math.max(nrm[0] * light[0] + nrm[1] * light[1] + nrm[2] * light[2] + 1, 0);
      const rgb = [0, 1, 2].map(c => Math.round(Math.min(1, Math.max(0, (unit.ambient[c] + unit.diffuse[c] * d) * (unit.palette[4 * ci + c] / 255))) * 255));
      for (const face of FACES) {
        if (filled(x + face.dir[0], y + face.dir[1], z + face.dir[2])) continue;
        const q = face.corners.map(c => project(p.toScreen, x + c[0], y + c[1], z + c[2]));
        if (alpha > 2) {
          const write = (i: number, depthValue: number) => {
            if (depthValue <= depth[i]) return;
            depth[i] = depthValue;
            color[4 * i] = rgb[0]; color[4 * i + 1] = rgb[1]; color[4 * i + 2] = rgb[2]; color[4 * i + 3] = 255;
          };
          tri(q[0][0], q[0][1], q[0][2], q[1][0], q[1][1], q[1][2], q[2][0], q[2][1], q[2][2], write);
          tri(q[0][0], q[0][1], q[0][2], q[2][0], q[2][1], q[2][2], q[3][0], q[3][1], q[3][2], write);
        }
        if (p.shadow) {
          const s = face.corners.map(c => project(p.shadow!, x + c[0], y + c[1], z + c[2]));
          const mark = (i: number) => { shadowMask[i] = 1; };
          tri(s[0][0], s[0][1], 0, s[1][0], s[1][1], 0, s[2][0], s[2][1], 0, mark);
          tri(s[0][0], s[0][1], 0, s[2][0], s[2][1], 0, s[3][0], s[3][1], 0, mark);
        }
      }
    }
  }
  const [sr, sg, sb, sa] = unit.shadowColor;
  for (let i = 0; i < n; i++) {
    if (color[4 * i + 3] === 0 && shadowMask[i]) {
      color[4 * i] = sr; color[4 * i + 1] = sg; color[4 * i + 2] = sb; color[4 * i + 3] = sa;
    }
  }
  return { width, height, data: color, anchorX, anchorY };
}

/** Builds the per-part poses OpenRA uses for a body facing and a turret's local facing. */
export function poseParts<T extends { turret: { offset: Vec3 } | null; offset: Vec3; trait: string }>(
  parts: T[], facing: number, turretFacing: number, useClassicPerspectiveFudge: boolean, cameraPitch: number,
) {
  return parts.map(part => {
    if (part.turret) {
      const offset = localToWorld(rotateYaw(part.turret.offset, facing), useClassicPerspectiveFudge, cameraPitch);
      return { part, yaw: (facing + turretFacing) & 1023, worldOffset: offset };
    }
    return { part, yaw: facing & 1023, worldOffset: part.offset };
  });
}
