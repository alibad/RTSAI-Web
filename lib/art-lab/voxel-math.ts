/**
 * The model transform chain of OpenRA's voxel renderer (OpenRA.Mods.Cnc ModelRenderer / Voxel / WRot),
 * reproduced so the browser draws a voxel unit with the same projection, part placement and lighting as
 * the game. Matrices are OpenRA's: column-major float[16], index 4*column + row.
 */
import type { VxlLimb } from "./vxl";
import { hvaColumnMajor } from "./hva";
import type { Vec3 } from "./types";

export type Mat4 = number[];

/**
 * WAngle.CosineTable (OpenRA.Game/WAngle.cs): one quadrant, 0..256, scaled by 1024. It is not Math.round(cos):
 * 125 of its 257 entries are one lower (cos 1 is 1023, cos 85 is 887), and the voxel matrices are built from it.
 */
const COSINE_TABLE = [
  1024, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1022, 1022, 1022, 1021, 1021, 1020, 1020, 1019,
  1019, 1018, 1017, 1017, 1016, 1015, 1014, 1013, 1012, 1011, 1010, 1009, 1008, 1007, 1006, 1005,
  1004, 1003, 1001, 1000, 999, 997, 996, 994, 993, 991, 990, 988, 986, 985, 983, 981,
  979, 978, 976, 974, 972, 970, 968, 966, 964, 962, 959, 957, 955, 953, 950, 948,
  946, 943, 941, 938, 936, 933, 930, 928, 925, 922, 920, 917, 914, 911, 908, 906,
  903, 900, 897, 894, 890, 887, 884, 881, 878, 875, 871, 868, 865, 861, 858, 854,
  851, 847, 844, 840, 837, 833, 829, 826, 822, 818, 814, 811, 807, 803, 799, 795,
  791, 787, 783, 779, 775, 771, 767, 762, 758, 754, 750, 745, 741, 737, 732, 728,
  724, 719, 715, 710, 706, 701, 696, 692, 687, 683, 678, 673, 668, 664, 659, 654,
  649, 644, 639, 634, 629, 625, 620, 615, 609, 604, 599, 594, 589, 584, 579, 574,
  568, 563, 558, 553, 547, 542, 537, 531, 526, 521, 515, 510, 504, 499, 493, 488,
  482, 477, 471, 466, 460, 454, 449, 443, 437, 432, 426, 420, 414, 409, 403, 397,
  391, 386, 380, 374, 368, 362, 356, 350, 344, 339, 333, 327, 321, 315, 309, 303,
  297, 291, 285, 279, 273, 267, 260, 254, 248, 242, 236, 230, 224, 218, 212, 205,
  199, 193, 187, 181, 175, 168, 162, 156, 150, 144, 137, 131, 125, 119, 112, 106,
  100, 94, 87, 81, 75, 69, 62, 56, 50, 43, 37, 31, 25, 18, 12, 6,
  0,
];

/** WAngle.Cos(): the angle wraps to 0..1023 and the quadrant table is mirrored and signed, as the engine does. */
export function wcos(angle: number) {
  const a = angle & 1023;
  const index = 256 - Math.abs(256 - (a & 511));
  // 0 - x, not -x: the engine returns an int, never -0.
  return ((a + 256) >> 9) & 1 ? 0 - COSINE_TABLE[index] : COSINE_TABLE[index];
}
export const wsin = (angle: number) => wcos(angle - 256);

/**
 * WRot(roll, pitch, yaw) -> integer quaternion, as WRot's constructor computes it. WAngle wraps an angle to
 * 0..1023 before WRot halves it, so an odd negative angle rounds the other way: CameraPitch 85 gives the pitch
 * -171 = 853, halved to -426 (the rotation of -172), not -85.
 */
export function wrotQuaternion(roll: number, pitch: number, yaw: number) {
  const half = (a: number) => -Math.floor((a & 1023) / 2);
  const cr = wcos(half(roll)), sr = wsin(half(roll));
  const cp = wcos(half(pitch)), sp = wsin(half(pitch));
  const cy = wcos(half(yaw)), sy = wsin(half(yaw));
  // C# long division truncates toward zero; "| 0" does the same here (and never leaves -0).
  const d = 1048576;
  return {
    x: ((sr * cp * cy - cr * sp * sy) / d) | 0,
    y: ((cr * sp * cy + sr * cp * sy) / d) | 0,
    z: ((cr * cp * sy - sr * sp * cy) / d) | 0,
    w: ((cr * cp * cy + sr * sp * sy) / d) | 0,
  };
}

/** WRot.AsMatrix() through Util.MakeFloatMatrix. */
export function wrotMatrix(roll: number, pitch: number, yaw: number): Mat4 {
  const { x, y, z, w } = wrotQuaternion(roll, pitch, yaw);
  const lsq = x * x + y * y + z * z + w * w;
  const m = [
    lsq - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), lsq - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), lsq - 2 * (x * x + y * y), 0,
    0, 0, 0, lsq,
  ];
  return m.map(v => v / lsq);
}

export const identity = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const scaleMatrix = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export const translationMatrix = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export function multiply(lhs: Mat4, rhs: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += lhs[4 * k + j] * rhs[4 * i + k];
    out[4 * i + j] = s;
  }
  return out;
}

export function transformVector(m: Mat4, v: number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[j] += m[4 * k + j] * v[k];
  return out;
}

export function invert(m: Mat4): Mat4 {
  const inv = new Array<number>(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (det === 0) throw new Error("Matrix is not invertible");
  return inv.map(v => v / det);
}

/** Voxel.TransformationMatrix: HVA transform with the limb's position fix, then centre, flip and scale. */
export function limbTransform(limb: Pick<VxlLimb, "scale" | "bounds" | "size">, hvaRow: number[]): Mat4 {
  let t = hvaColumnMajor(hvaRow);
  const [x0, y0, z0, x1, y1, z1] = limb.bounds;
  t[12] *= (limb.scale * (x1 - x0)) / limb.size[0];
  t[13] *= (limb.scale * (y1 - y0)) / limb.size[1];
  t[14] *= (limb.scale * (z1 - z0)) / limb.size[2];
  t = multiply(t, translationMatrix(x0, y0, z0));
  return multiply(scaleMatrix(limb.scale, -limb.scale, limb.scale), t);
}

/** RenderVoxels camera: WRot(0, CameraPitch - 256, 256). */
export const cameraMatrix = (cameraPitch: number) => wrotMatrix(0, cameraPitch - 256, 256);

/** ModelRenderer's shadow transform for flat ground: lightPitch * lightYaw (ground orientation = identity). */
export function shadowTransform(lightPitch: number, lightYaw: number) {
  // RenderVoxels: lightSource = WRot(0, 256 - LightPitch, LightYaw); ModelRenderer negates both.
  const sourcePitch = 256 - lightPitch;
  const yawM = wrotMatrix(0, 0, -lightYaw);
  const pitchM = wrotMatrix(0, -sourcePitch, 0);
  return multiply(pitchM, yawM);
}

/** ModelRenderer.ExtractRotationVector: the matrix applied to the unit z vector, as a direction. */
export function extractRotationVector(m: Mat4): Vec3 {
  const v = transformVector(m, [0, 0, 1, 1]);
  const o = transformVector(m, [0, 0, 0, 1]);
  const x = v[0] - (o[0] * v[3]) / o[3];
  const y = v[1] - (o[1] * v[3]) / o[3];
  const z = v[2] - (o[2] * v[3]) / o[3];
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/** WorldRenderer.ScreenVector for RA2's 60x30 tiles at TileScale 1448. */
export function screenVector(v: Vec3, tile: [number, number] = [60, 30], tileScale = 1448): number[] {
  return [(tile[0] * v[0]) / tileScale, (tile[1] * (v[1] - v[2])) / tileScale, (tile[1] * v[2]) / tileScale, 1];
}

/**
 * ModelRenderer.OffsetScreenVector (rtsai/engine 55ecbb07e2): a model part's world offset in camera space. Screen x/y
 * are ScreenVector's; the depth is the camera's. ScreenVector's own depth (30 * Z / 1448) ignores Y, so a bow or stern
 * turret was depth-tested at the hull origin. The ground part (X, Y) gets the depth that keeps it in the model ground
 * plane, the height part (Z) the depth that keeps it on the model up axis: (52.88 * Y + 17.02 * Z) / 1448 at pitch 85.
 */
export function offsetScreenVector(v: Vec3, camera: Mat4): number[] {
  const s = screenVector(v), g = screenVector([v[0], v[1], 0]), h = screenVector([0, 0, v[2]]);
  const up = transformVector(camera, [0, 0, 1, 0]);
  const onScreen = up[0] * up[0] + up[1] * up[1];
  const groundDepth = Math.abs(up[2]) > 1e-6 ? -(up[0] * g[0] + up[1] * g[1]) / up[2] : g[2];
  const heightDepth = onScreen > 1e-6 ? (h[1] * up[1] * up[2]) / onScreen : h[2];
  return [s[0], s[1], groundDepth + heightDepth, 1];
}

/** WVec.Rotate(WRot.FromYaw(yaw)). */
export function rotateYaw(v: Vec3, yaw: number): Vec3 {
  const m = wrotMatrix(0, 0, yaw);
  const r = transformVector(m, [v[0], v[1], v[2], 0]);
  return [Math.trunc(r[0]), Math.trunc(r[1]), Math.trunc(r[2])];
}

/** BodyOrientationInfo.LocalToWorld. */
export function localToWorld(v: Vec3, useClassicPerspectiveFudge: boolean, cameraPitch: number): Vec3 {
  if (!useClassicPerspectiveFudge) return [v[1], -v[0], v[2]];
  return [v[1], Math.trunc((-wsin(cameraPitch) * v[0]) / 1024), v[2]];
}

export type PartPose = {
  /** Model rotation (WRot yaw) for the part. */
  yaw: number;
  /** World offset (WVec) from the actor's centre, before projection. */
  worldOffset: Vec3;
};

/**
 * The full per-limb matrix chain for one part, in OpenRA's camera space (x right, y down, z depth), in
 * screen pixels relative to the actor's centre. Also returns the limb-space light direction.
 */
export function partMatrices(opts: {
  scale: number; cameraPitch: number; lightPitch: number; lightYaw: number; pose: PartPose;
  limb: Pick<VxlLimb, "scale" | "bounds" | "size">; hvaRow: number[];
}) {
  const camera = cameraMatrix(opts.cameraPitch);
  const invCamera = invert(camera);
  const offset = transformVector(invCamera, offsetScreenVector(opts.pose.worldOffset, camera));
  const rotation = wrotMatrix(0, 0, opts.pose.yaw);
  let world = multiply(scaleMatrix(opts.scale, opts.scale, opts.scale), rotation);
  world = multiply(translationMatrix(offset[0], offset[1], offset[2]), world);
  const t = limbTransform(opts.limb, opts.hvaRow);
  const shadow = shadowTransform(opts.lightPitch, opts.lightYaw);
  const lightTransform = multiply(invert(rotation), invert(shadow));
  const light = extractRotationVector(multiply(invert(t), lightTransform));
  return {
    /** model (voxel grid) -> model world (pixels, before the camera) */
    modelToWorld: multiply(world, t),
    /** The part's world transform and the limb's transform, kept apart for the shadow bounds. */
    world,
    t,
    shadow,
    /** The part's pivot in model world: where its rotation is centred (turret ring, body centre). */
    pivot: [offset[0], offset[1], offset[2]] as Vec3,
    camera,
    light,
    /** Direction light travels in model-world space (shadow-space z). */
    lightWorld: extractRotationVector(invert(shadow)),
  };
}

/** Util.MatrixAABBMultiply: the axis-aligned box of a transformed box [x0, y0, z0, x1, y1, z1]. */
export function aabbTransform(m: Mat4, b: number[]): number[] {
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const v = transformVector(m, [b[i & 4 ? 3 : 0], b[i & 2 ? 4 : 1], b[i & 1 ? 5 : 2], 1]);
    for (let k = 0; k < 3; k++) {
      out[k] = Math.min(out[k], v[k] / v[3]);
      out[k + 3] = Math.max(out[k + 3], v[k] / v[3]);
    }
  }
  return out;
}

export type ShadowPart = {
  /** The part's world transform (offset * scale * rotation). */
  world: Mat4;
  /** Each limb's transform and its bounds extent (Voxel.Bounds boxes the extent, not the grid size). */
  limbs: { t: Mat4; extent: Vec3 }[];
};

export type ShadowSprite = {
  /** The sprite size: twice the light-space bounds, rounded to even (CalculateSpriteGeometry). */
  width: number;
  height: number;
  /** Model world -> sprite pixels (x right, y down), z kept for depth. */
  toSprite: Mat4;
  /** Screen corners (relative to the actor's ground point) of the sprite's top-left, top-right, bottom-right and bottom-left. */
  quad: [number, number][];
};

/**
 * The voxel shadow as ModelRenderer.RenderAsync draws it: the model rendered from the light at twice the
 * resolution into a sprite, which is then stretched over the ground quad of the light-space bounds. The sprite's
 * size and offset are rounded (and the bounds come from boxed boxes), so the quad and the sprite never quite agree;
 * that is how the game looks, so the lab copies it.
 */
export function shadowSprite(parts: ShadowPart[], camera: Mat4, shadow: Mat4, altitudePx = 0): ShadowSprite | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const part of parts) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const limb of part.limbs) {
      const bb = aabbTransform(limb.t, [0, 0, 0, ...limb.extent]);
      for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], bb[k]); b[k + 3] = Math.max(b[k + 3], bb[k + 3]); }
    }
    const s = aabbTransform(shadow, aabbTransform(part.world, b));
    x0 = Math.min(x0, s[0]); y0 = Math.min(y0, s[1]); x1 = Math.max(x1, s[3]); y1 = Math.max(y1, s[4]);
  }
  if (!Number.isFinite(x0)) return null;
  x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
  const invShadow = invert(shadow);
  const toScreen = multiply(camera, invShadow);
  const gn = transformVector(shadow, [0, 0, 1, 1]);
  const light = transformVector(camera, transformVector(invShadow, [0, 0, 1, 1]));
  // ModelRenderable: the quad sits at the ground point, moved along the light by the altitude.
  const shiftX = altitudePx * (-light[2] / light[1]);
  const corner = (x: number, y: number): [number, number] => {
    const v = transformVector(toScreen, [x, y, -((y * gn[1]) / gn[2] + (x * gn[0]) / gn[2]), 1]);
    return [v[0] + shiftX, v[1]];
  };
  let width = Math.trunc(2 * (x1 - x0));
  let height = Math.trunc(2 * (y1 - y0));
  if (width & 1) width++;
  if (height & 1) height++;
  const offsetX = Math.trunc(x1 + x0), offsetY = Math.trunc(y1 + y0);
  const toSprite = multiply([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, width / 2 - offsetX, height / 2 - offsetY, 0, 1], shadow);
  return { width, height, toSprite, quad: [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)] };
}

/** Sprite.Inset: texture coordinates are pulled 1/128 texel inside the sprite's edges. */
export const SPRITE_INSET = 1 / 128;

/**
 * Where a screen point (relative to the actor's ground point) samples the shadow sprite, as the GPU interpolates
 * the quad's texture coordinates: the texel, or null outside the quad.
 */
export function shadowTexel(sprite: ShadowSprite, x: number, y: number): [number, number] | null {
  const [a, b, , d] = sprite.quad;
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = d[0] - a[0], vy = d[1] - a[1];
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-12) return null;
  const px = x - a[0], py = y - a[1];
  const s = (px * vy - py * vx) / det;
  const t = (ux * py - uy * px) / det;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  return [Math.floor(SPRITE_INSET + s * (sprite.width - 2 * SPRITE_INSET)), Math.floor(SPRITE_INSET + t * (sprite.height - 2 * SPRITE_INSET))];
}

/** Planar projection onto z = groundZ along direction d (model-world). */
export function groundProjection(d: Vec3, groundZ = 0): Mat4 {
  // p' = p - ((p.z - groundZ) / d.z) * d
  const [dx, dy, dz] = d;
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    -dx / dz, -dy / dz, 0, 0,
    (dx / dz) * groundZ, (dy / dz) * groundZ, groundZ, 1,
  ];
}

/** OpenRA facing labels: facing 0 is north and angles increase counter-clockwise (256 = west). */
export function facingLabel(facing: number) {
  const names = ["N", "NW", "W", "SW", "S", "SE", "E", "NE"];
  return names[Math.round((((facing % 1024) + 1024) % 1024) / 128) % 8];
}
