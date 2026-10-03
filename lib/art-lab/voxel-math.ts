/**
 * The model transform chain of OpenRA's voxel renderer (OpenRA.Mods.Cnc ModelRenderer / Voxel / WRot),
 * reproduced so the browser draws a voxel unit with the same projection, part placement and lighting as
 * the game. Matrices are OpenRA's: column-major float[16], index 4*column + row.
 */
import type { VxlLimb } from "./vxl";
import { hvaColumnMajor } from "./hva";
import type { Vec3 } from "./types";

export type Mat4 = number[];

/** WAngle sine/cosine: OpenRA uses a 1024-step table scaled by 1024. */
export const wcos = (angle: number) => Math.round(Math.cos((angle * Math.PI) / 512) * 1024);
export const wsin = (angle: number) => wcos(angle - 256);

/** WRot(roll, pitch, yaw) -> integer quaternion, as WRot's constructor computes it. */
export function wrotQuaternion(roll: number, pitch: number, yaw: number) {
  const half = (a: number) => Math.trunc(-a / 2);
  const cr = wcos(half(roll)), sr = wsin(half(roll));
  const cp = wcos(half(pitch)), sp = wsin(half(pitch));
  const cy = wcos(half(yaw)), sy = wsin(half(yaw));
  const d = 1048576;
  return {
    x: Math.trunc((sr * cp * cy - cr * sp * sy) / d),
    y: Math.trunc((cr * sp * cy + sr * cp * sy) / d),
    z: Math.trunc((cr * cp * sy - sr * sp * cy) / d),
    w: Math.trunc((cr * cp * cy + sr * sp * sy) / d),
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
  const offset = transformVector(invCamera, screenVector(opts.pose.worldOffset));
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
    /** The part's pivot in model world: where its rotation is centred (turret ring, body centre). */
    pivot: [offset[0], offset[1], offset[2]] as Vec3,
    camera,
    light,
    /** Direction light travels in model-world space (shadow-space z). */
    lightWorld: extractRotationVector(invert(shadow)),
  };
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
