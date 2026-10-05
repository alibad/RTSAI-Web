/**
 * three.js voxel rendering (client only; imported dynamically so no other route pays for three.js).
 *
 * - VoxelModel: one unit's meshes and the OpenRA transform chain for a pose. In-game mode reproduces OpenRA's
 *   battlefield projection pixel for pixel at 1x; orbit and exploded modes show the same transforms from any
 *   angle (ground horizontal, model up = screen up), with parts pulled apart and pivots marked when exploded.
 * - VoxelStage: one model on its own canvas (the shared unit viewer on the Art Lab and public pages).
 * - VoxelEngine (voxel-engine.ts, Review only): ONE WebGL context for many models.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Hva } from "../../../lib/art-lab/hva";
import type { Palette } from "../../../lib/art-lab/pal";
import type { Vxl, VxlLimb } from "../../../lib/art-lab/vxl";
import type { Vec3 } from "../../../lib/art-lab/types";
import { quantizedNormal } from "../../../lib/art-lab/raster";
import { cameraMatrix, localToWorld, multiply, partMatrices, rotateYaw, shadowSprite, SPRITE_INSET, transformVector, type Mat4, type ShadowPart, type ShadowSprite } from "../../../lib/art-lab/voxel-math";
import type { CameraLink, ViewMode } from "./viewSettings";

export type StagePart = {
  id: string;
  label: string;
  vxl: Vxl;
  hva: Hva;
  offset: Vec3;
  turretOffset: Vec3 | null;
  showShadow: boolean;
  /** A barrel model (WithVoxelBarrel): it slides back by the armament's recoil along the turret's facing. */
  barrel?: boolean;
};

export type StageSpec = {
  scale: number; cameraPitch: number; lightPitch: number; lightYaw: number; ambient: Vec3; diffuse: Vec3;
  useClassicPerspectiveFudge: boolean; normals: readonly number[]; altitude: number | null;
};

/** Where and how a model stands: mode, facings, HVA frame, part visibility. No camera, no colours. */
export type ModelPose = {
  mode: ViewMode;
  facing: number;
  turretFacing: number;
  frame: number;
  partFrames?:Record<string,number>;
  visible: Record<string, boolean>;
  shadow: boolean;
  airborne: boolean;
  /** Current recoil (WDist) of the armament driving the barrel model, if any. */
  recoil?: number;
};

export type StageState = ModelPose & {
  zoom: number;
  /** Clear colour behind the unit; null keeps the canvas transparent. */
  background: [number, number, number] | null;
  tint: [number, number, number];
  palette: Palette;
};

export type StageLabel = { id: string; text: string; x: number; y: number; kind: "part" | "pivot" };
export type InGameBox = { width: number; height: number; anchorX: number; anchorY: number };
export type RasterFrame = InGameBox & { data: Uint8ClampedArray };

const FLIP_Y: Mat4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const FACES: { dir: Vec3; corners: Vec3[] }[] = [
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
];
const EXPLODE_STEP = 18;

function limbGeometry(limb: VxlLimb, normals: readonly number[]) {
  const [sx, sy, sz] = limb.size;
  const filled = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && limb.filled[x + sx * (y + sy * z)] === 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const nrm: number[] = [];
  const index: number[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const i = x + sx * (y + sy * z);
    if (!limb.filled[i]) continue;
    const n = quantizedNormal(normals, limb.normals[i]);
    for (const face of FACES) {
      if (filled(x + face.dir[0], y + face.dir[1], z + face.dir[2])) continue;
      const base = positions.length / 3;
      for (const c of face.corners) { positions.push(x + c[0], y + c[1], z + c[2]); colors.push(limb.colors[i]); nrm.push(n[0], n[1], n[2], n[3]); }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 1));
  g.setAttribute("aNormalVx", new THREE.Float32BufferAttribute(nrm, 4));
  g.setIndex(index);
  g.computeBoundingBox();
  return g;
}

const vertexShader = `
attribute float aColor;
attribute vec4 aNormalVx;
varying float vColor;
varying vec4 vNormalVx;
void main() {
  vColor = aColor;
  vNormalVx = aNormalVx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// OpenRA glsl/model.frag: intensity = ambient + diffuse * max(dot(normal4, light4), 0). The light has w = 1; the
// normal's w is 1 for table entries and -1 for indices past the table (see quantizedNormal).
const fragmentShader = `
uniform sampler2D uPalette;
uniform vec3 uLight;
uniform vec3 uAmbient;
uniform vec3 uDiffuse;
uniform vec3 uTint;
varying float vColor;
varying vec4 vNormalVx;
void main() {
  vec4 c = texture2D(uPalette, vec2((floor(vColor + 0.5) + 0.5) / 256.0, 0.5));
  if (c.a < 0.01) discard;
  float d = max(dot(vNormalVx.xyz, uLight) + vNormalVx.w, 0.0);
  vec3 rgb = clamp((uAmbient + uDiffuse * d) * c.rgb, 0.0, 1.0);
  gl_FragColor = vec4(rgb * uTint, 1.0);
}`;

// The shadow sprite pass (ModelRenderer's shadow render at 2x): coverage only; the shadow palette is clear at index 0.
const spriteVertexShader = `
attribute float aColor;
varying float vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const spriteFragmentShader = `
varying float vColor;
void main() {
  if (floor(vColor + 0.5) < 0.5) discard;
  gl_FragColor = vec4(1.0);
}`;

// The sprite stretched over the ground quad: texture coordinates inset like Sprite's, nearest texel, the shadow
// palette's colour (0, 0, 0, 140).
const quadVertexShader = `
attribute vec2 aCorner;
varying vec2 vCorner;
void main() {
  vCorner = aCorner;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const quadFragmentShader = `
uniform sampler2D uSprite;
uniform vec4 uBox;
varying vec2 vCorner;
void main() {
  vec2 texel = vec2(${SPRITE_INSET}) + vCorner * (uBox.xy - ${2 * SPRITE_INSET});
  if (texture2D(uSprite, (floor(texel) + 0.5) / uBox.zw).a < 0.5) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, ${(140 / 255).toFixed(6)});
}`;

/** Drops z so the light-space sprite fits any orthographic depth range. */
const FLATTEN: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

const setMatrix = (object: THREE.Object3D, m: Mat4) => {
  object.matrixAutoUpdate = false;
  object.matrix.fromArray(m);
  object.matrixWorldNeedsUpdate = true;
};

/** Removes a group's children and frees their GPU buffers (helpers are rebuilt per pose). */
function clearGroup(group: THREE.Object3D) {
  for (const child of [...group.children]) {
    child.traverse(o => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach(m => m.dispose()); else material?.dispose();
    });
  }
  group.clear();
}

const BOX_CORNERS = (box: THREE.Box3) => [
  [box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z], [box.min.x, box.max.y, box.min.z], [box.max.x, box.min.y, box.max.z],
  [box.min.x, box.min.y, box.max.z], [box.max.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z], [box.max.x, box.min.y, box.min.z],
];

type LimbEntry = { part: StagePart; limbIndex: number; mesh: THREE.Mesh; shadow: THREE.Mesh; material: THREE.ShaderMaterial };

/** One unit's meshes and poses. Rendering is done by VoxelStage or VoxelEngine. */
export class VoxelModel {
  readonly modelScene = new THREE.Scene();
  /** The ground quad that shows the shadow sprite (drawn before the model). */
  readonly shadowScene = new THREE.Scene();
  /** The model seen from the light, in shadow-sprite pixels: render with `shadowSpriteCamera` (see renderShadowSprite). */
  readonly shadowSpriteScene = new THREE.Scene();
  readonly shadowSpriteCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  /** After an in-game pose: the shadow sprite, or null when nothing casts one. */
  sprite: ShadowSprite | null = null;
  readonly groundScene = new THREE.Scene();
  readonly helpers = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly ground = new THREE.Group();
  private readonly paletteTexture: THREE.DataTexture;
  private readonly spriteMaterial: THREE.ShaderMaterial;
  private readonly shadowQuad: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly limbs: LimbEntry[] = [];
  private palette: Palette | null = null;
  private tintKey = "";
  private grid: { extent: number; helper: THREE.GridHelper } | null = null;
  private arrow: THREE.ArrowHelper | null = null;
  /** Orbit frame: the battlefield camera space tilted so model up is screen up (three's Y). */
  readonly orbitRoot: Mat4;
  readonly elevation: number;
  /** After an in-game pose: the 1x frame size and the actor centre inside it. */
  inGameBox: InGameBox = { width: 0, height: 0, anchorX: 0, anchorY: 0 };
  /** After an orbit or exploded pose: what to frame (the cylinder the unit sweeps when it turns). */
  framing = { centre: [0, 0, 0] as Vec3, halfHeight: 30, halfWidth: 30 };
  /** After an exploded pose: part and pivot labels in helper space. */
  labels: { id: string; text: string; world: Vec3; kind: "part" | "pivot" }[] = [];

  constructor(readonly spec: StageSpec, readonly parts: StagePart[]) {
    const flipCamera = multiply(FLIP_Y, cameraMatrix(spec.cameraPitch));
    const up = transformVector(flipCamera, [0, 0, 1, 0]);
    this.elevation = Math.atan2(up[2], up[1]);
    const c = Math.cos(-this.elevation), s = Math.sin(-this.elevation);
    // Rx(-elevation), column-major: maps the in-game up vector onto +Y.
    const tilt: Mat4 = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
    this.orbitRoot = multiply(tilt, flipCamera);
    this.paletteTexture = new THREE.DataTexture(new Uint8Array(1024), 256, 1, THREE.RGBAFormat);
    this.paletteTexture.magFilter = THREE.NearestFilter;
    this.paletteTexture.minFilter = THREE.NearestFilter;
    this.paletteTexture.colorSpace = THREE.NoColorSpace;
    this.modelScene.add(this.root);
    this.modelScene.add(this.helpers);
    this.groundScene.add(this.ground);
    this.spriteMaterial = new THREE.ShaderMaterial({
      vertexShader: spriteVertexShader, fragmentShader: spriteFragmentShader, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    quad.setAttribute("aCorner", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    quad.setIndex([0, 1, 2, 2, 3, 0]);
    this.shadowQuad = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      vertexShader: quadVertexShader, fragmentShader: quadFragmentShader, side: THREE.DoubleSide,
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uSprite: { value: null }, uBox: { value: new THREE.Vector4(1, 1, 1, 1) } },
    }));
    this.shadowQuad.frustumCulled = false;
    this.shadowQuad.visible = false;
    this.shadowScene.add(this.shadowQuad);
    for (const part of parts) {
      part.vxl.limbs.forEach((limb, limbIndex) => {
        const geometry = limbGeometry(limb, spec.normals);
        const material = new THREE.ShaderMaterial({
          vertexShader, fragmentShader, side: THREE.DoubleSide,
          uniforms: {
            uPalette: { value: this.paletteTexture }, uLight: { value: new THREE.Vector3() },
            uAmbient: { value: new THREE.Vector3(...spec.ambient) }, uDiffuse: { value: new THREE.Vector3(...spec.diffuse) },
            uTint: { value: new THREE.Vector3(1, 1, 1) },
          },
        });
        const mesh = new THREE.Mesh(geometry, material);
        const shadow = new THREE.Mesh(geometry, this.spriteMaterial);
        mesh.frustumCulled = false;
        shadow.frustumCulled = false;
        this.root.add(mesh);
        this.shadowSpriteScene.add(shadow);
        this.limbs.push({ part, limbIndex, mesh, shadow, material });
      });
    }
  }

  setPalette(palette: Palette) {
    if (palette === this.palette) return;
    this.palette = palette;
    (this.paletteTexture.image.data as Uint8Array).set(palette);
    this.paletteTexture.needsUpdate = true;
  }

  setTint(tint: readonly number[]) {
    const key = tint.join(",");
    if (key === this.tintKey) return;
    this.tintKey = key;
    for (const limb of this.limbs) (limb.material.uniforms.uTint.value as THREE.Vector3).set(tint[0], tint[1], tint[2]);
  }

  private poses(pose: ModelPose) {
    const { facing, turretFacing } = pose;
    return this.parts.map(part => {
      if (part.turretOffset) {
        const yaw = (facing + turretFacing) & 1023;
        let world = localToWorld(rotateYaw(part.turretOffset, facing), this.spec.useClassicPerspectiveFudge, this.spec.cameraPitch);
        if (part.barrel && pose.recoil) {
          const back = localToWorld(rotateYaw([-pose.recoil, 0, 0], yaw), this.spec.useClassicPerspectiveFudge, this.spec.cameraPitch);
          world = [world[0] + back[0], world[1] + back[1], world[2] + back[2]];
        }
        return { part, yaw, worldOffset: world };
      }
      return { part, yaw: facing & 1023, worldOffset: part.offset };
    });
  }

  /** Recomputes every limb's matrix and light for a pose, then the in-game box or the orbit framing. */
  pose(pose: ModelPose) {
    const { mode, frame, visible } = pose;
    const poses = new Map(this.poses(pose).map(p => [p.part.id, p]));
    const altitudePx = pose.airborne && this.spec.altitude ? (30 * this.spec.altitude) / 1448 : 0;
    const lift: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -altitudePx, 0, 1];
    const shown = this.parts.filter(p => visible[p.id] !== false).map(p => p.id);
    clearGroup(this.helpers);
    const labels: typeof this.labels = [];
    let zmin = Infinity, zmax = -Infinity, rxy = 0;
    // In game: every shown part bounds the shadow sprite; the casting limbs are drawn into it afterwards.
    const shadowParts = new Map<string, ShadowPart>();
    const casting: { limb: LimbEntry; modelToWorld: Mat4 }[] = [];
    let camera: Mat4 | null = null, light: Mat4 | null = null;
    for (const limb of this.limbs) {
      const p = poses.get(limb.part.id)!;
      const rows = limb.part.hva.rows;
      const limbFrame=pose.partFrames?.[limb.part.id]??frame;
      const row = rows[Math.min(limbFrame, rows.length - 1)]?.[limb.limbIndex] ?? rows[0][limb.limbIndex];
      const m = partMatrices({
        scale: this.spec.scale, cameraPitch: this.spec.cameraPitch, lightPitch: this.spec.lightPitch, lightYaw: this.spec.lightYaw,
        pose: { yaw: p.yaw, worldOffset: p.worldOffset }, limb: limb.part.vxl.limbs[limb.limbIndex], hvaRow: row,
      });
      (limb.material.uniforms.uLight.value as THREE.Vector3).set(...m.light);
      const on = visible[limb.part.id] !== false;
      limb.mesh.visible = on;
      limb.shadow.visible = on && pose.shadow && mode === "ingame" && limb.part.showShadow;
      const raise = mode === "exploded" ? EXPLODE_STEP * Math.max(0, shown.indexOf(limb.part.id)) : 0;
      const explode: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, raise, 1];
      if (mode === "ingame") {
        setMatrix(limb.mesh, multiply(FLIP_Y, multiply(lift, multiply(m.camera, m.modelToWorld))));
        if (on) {
          const [x0, y0, z0, x1, y1, z1] = limb.part.vxl.limbs[limb.limbIndex].bounds;
          const bounds = shadowParts.get(limb.part.id) ?? { world: m.world, limbs: [] };
          bounds.limbs.push({ t: m.t, extent: [x1 - x0, y1 - y0, z1 - z0] });
          shadowParts.set(limb.part.id, bounds);
          camera = m.camera; light = m.shadow;
        }
        if (limb.shadow.visible) casting.push({ limb, modelToWorld: m.modelToWorld });
        continue;
      }
      const world = multiply(explode, m.modelToWorld);
      setMatrix(limb.mesh, world);
      if (on) {
        for (const corner of BOX_CORNERS(limb.mesh.geometry.boundingBox!)) {
          const v = transformVector(world, [corner[0], corner[1], corner[2], 1]);
          zmin = Math.min(zmin, v[2]); zmax = Math.max(zmax, v[2]); rxy = Math.max(rxy, Math.hypot(v[0], v[1]));
        }
      }
      if (mode === "exploded" && on && limb.limbIndex === 0) {
        const pivot: Vec3 = [m.pivot[0], m.pivot[1], m.pivot[2] + raise];
        this.addPivot(pivot, limb.part.turretOffset ? 0xf1d28b : 0xef5b3f);
        const box = limb.mesh.geometry.boundingBox!;
        const top = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z).applyMatrix4(limb.mesh.matrix);
        labels.push({ id: `${limb.part.id}:part`, text: limb.part.label, world: [top.x, top.y, top.z + 6], kind: "part" });
        labels.push({ id: `${limb.part.id}:pivot`, text: limb.part.turretOffset ? "turret pivot" : "body pivot", world: pivot, kind: "pivot" });
      }
    }
    setMatrix(this.root, mode === "ingame" ? IDENTITY : this.orbitRoot);
    this.labels = labels;
    this.sprite = mode === "ingame" && casting.length && camera && light ? shadowSprite([...shadowParts.values()], camera, light, altitudePx) : null;
    this.layoutShadow(casting);
    if (mode === "ingame") { this.measureInGame(); return; }
    setMatrix(this.helpers, this.orbitRoot);
    setMatrix(this.ground, this.orbitRoot);
    if (!Number.isFinite(zmin)) { zmin = 0; zmax = 20; rxy = 30; }
    // Frame the cylinder the unit sweeps when it turns (so spinning never re-zooms), as seen from the
    // battlefield elevation: half-width = its radius, half-height = radius * sin(e) + half its height * cos(e).
    const centre = transformVector(this.orbitRoot, [0, 0, (zmin + zmax) / 2, 1]);
    this.framing = {
      centre: [centre[0], centre[1], centre[2]],
      halfHeight: rxy * Math.sin(this.elevation) + ((zmax - zmin) / 2) * Math.cos(this.elevation),
      halfWidth: rxy,
    };
    this.layoutGround(rxy, pose.facing);
  }

  /** Positions the casting limbs in sprite pixels and the ground quad on screen (y up, like the in-game scene). */
  private layoutShadow(casting: { limb: LimbEntry; modelToWorld: Mat4 }[]) {
    const sprite = this.sprite;
    this.shadowQuad.visible = !!sprite;
    if (!sprite) return;
    for (const { limb, modelToWorld } of casting) setMatrix(limb.shadow, multiply(FLATTEN, multiply(sprite.toSprite, modelToWorld)));
    Object.assign(this.shadowSpriteCamera, { left: 0, right: sprite.width, top: sprite.height, bottom: 0 });
    this.shadowSpriteCamera.updateProjectionMatrix();
    const position = this.shadowQuad.geometry.getAttribute("position") as THREE.BufferAttribute;
    sprite.quad.forEach(([x, y], i) => position.setXYZ(i, x, -y, 0));
    position.needsUpdate = true;
    const box = this.shadowQuad.material.uniforms.uBox.value as THREE.Vector4;
    box.x = sprite.width; box.y = sprite.height;
  }

  /** Points the ground quad at the rendered sprite (a texture of texWidth x texHeight, the sprite in its corner). */
  useShadowSprite(texture: THREE.Texture, texWidth: number, texHeight: number) {
    const uniforms = this.shadowQuad.material.uniforms;
    uniforms.uSprite.value = texture;
    const box = uniforms.uBox.value as THREE.Vector4;
    box.z = texWidth; box.w = texHeight;
  }

  /** Ground grid (rebuilt only when the unit's size changes) and the facing arrow (moved, never rebuilt). */
  private layoutGround(rxy: number, facing: number) {
    const extent = Math.max(80, Math.ceil(rxy / 10) * 20 + 20);
    if (this.grid?.extent !== extent) {
      if (this.grid) { this.ground.remove(this.grid.helper); this.grid.helper.geometry.dispose(); (this.grid.helper.material as THREE.Material).dispose(); }
      const helper = new THREE.GridHelper(extent, extent / 10, 0x6f7d58, 0x3c4238);
      helper.rotation.x = Math.PI / 2;
      helper.updateMatrix();
      this.ground.add(helper);
      this.grid = { extent, helper };
    }
    const forward = this.forward(facing);
    if (!this.arrow) {
      this.arrow = new THREE.ArrowHelper(new THREE.Vector3(...forward), new THREE.Vector3(0, 0, 0.5), rxy + 8, 0xf1d28b, 8, 5);
      this.ground.add(this.arrow);
    } else {
      this.arrow.setDirection(new THREE.Vector3(...forward));
      this.arrow.setLength(rxy + 8, 8, 5);
    }
  }

  private forward(facing: number): Vec3 {
    const m = partMatrices({
      scale: 1, cameraPitch: this.spec.cameraPitch, lightPitch: this.spec.lightPitch, lightYaw: this.spec.lightYaw,
      pose: { yaw: facing, worldOffset: [0, 0, 0] }, limb: { scale: 1, bounds: [0, 0, 0, 1, 1, 1], size: [1, 1, 1] }, hvaRow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    });
    const f = transformVector(m.modelToWorld, [1, 0, 0, 0]);
    const len = Math.hypot(f[0], f[1]) || 1;
    return [f[0] / len, f[1] / len, 0];
  }

  private addPivot(p: Vec3, color: number) {
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(2.4), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    marker.position.set(...p);
    marker.renderOrder = 10;
    this.helpers.add(marker);
    const axis = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p[0], p[1], p[2] - 14), new THREE.Vector3(p[0], p[1], p[2] + 30)]);
    const line = new THREE.Line(axis, new THREE.LineDashedMaterial({ color, dashSize: 3, gapSize: 2, depthTest: false }));
    line.computeLineDistances();
    line.renderOrder = 10;
    this.helpers.add(line);
  }

  /** The unit's 1x screen bounds with the actor centre on an integer pixel. */
  private measureInGame() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const limb of this.limbs) {
      if (!limb.mesh.visible) continue;
      for (const c of BOX_CORNERS(limb.mesh.geometry.boundingBox!)) {
        v.set(c[0], c[1], c[2]).applyMatrix4(limb.mesh.matrix);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, -v.y); y1 = Math.max(y1, -v.y);
      }
    }
    for (const [x, y] of this.sprite?.quad ?? []) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (!Number.isFinite(x0)) { x0 = -10; x1 = 10; y0 = -10; y1 = 10; }
    this.inGameBox = { width: Math.ceil(x1) - Math.floor(x0) + 4, height: Math.ceil(y1) - Math.floor(y0) + 4, anchorX: 2 - Math.floor(x0), anchorY: 2 - Math.floor(y0) };
  }

  dispose() {
    clearGroup(this.helpers);
    clearGroup(this.ground);
    this.grid = null;
    this.arrow = null;
    for (const limb of this.limbs) { limb.mesh.geometry.dispose(); limb.material.dispose(); }
    this.spriteMaterial.dispose();
    this.shadowQuad.geometry.dispose();
    this.shadowQuad.material.dispose();
    this.paletteTexture.dispose();
  }
}

/** A target for shadow sprites: nearest sampling, no depth, grown (never shrunk) by renderShadowSprite. */
export const shadowSpriteTarget = () => new THREE.WebGLRenderTarget(64, 64, {
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false,
});

/**
 * Renders a posed model's shadow sprite into `target` (its top-left corner) and points the model's ground quad at
 * it. Call before drawing the in-game scenes; it leaves `target` bound, so set the next target afterwards.
 */
export function renderShadowSprite(renderer: THREE.WebGLRenderer, model: VoxelModel, target: THREE.WebGLRenderTarget) {
  const sprite = model.sprite;
  if (!sprite) return;
  if (sprite.width > target.width || sprite.height > target.height) target.setSize(Math.max(target.width, sprite.width), Math.max(target.height, sprite.height));
  target.viewport.set(0, 0, sprite.width, sprite.height);
  const color = renderer.getClearColor(new THREE.Color());
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.render(model.shadowSpriteScene, model.shadowSpriteCamera);
  renderer.setClearColor(color, alpha);
  model.useShadowSprite(target.texture, target.width, target.height);
}

/** Points an orthographic camera at a 1x in-game box: one canvas or target pixel per game pixel. */
export function aimInGame(camera: THREE.OrthographicCamera, box: InGameBox) {
  Object.assign(camera, { left: -box.anchorX, right: box.width - box.anchorX, top: box.anchorY, bottom: box.anchorY - box.height });
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, -1);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function projectLabels(model: VoxelModel, camera: THREE.Camera, width: number, height: number): StageLabel[] {
  model.helpers.updateMatrixWorld();
  return model.labels.map(l => {
    const v = new THREE.Vector3(...l.world).applyMatrix4(model.helpers.matrixWorld).project(camera);
    return { id: l.id, text: l.text, kind: l.kind, x: Math.round(((v.x + 1) / 2) * width), y: Math.round(((1 - v.y) / 2) * height) };
  });
}

/** One model on its own canvas: the shared viewer used by the unit pages. */
export class VoxelStage {
  readonly renderer: THREE.WebGLRenderer;
  private readonly model: VoxelModel;
  private readonly ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, -10000, 10000);
  private controls: OrbitControls | null = null;
  private state: StageState;
  private labels: StageLabel[] = [];
  private onLabels: ((labels: StageLabel[]) => void) | null = null;
  private disposed = false;
  private frameRequest = 0;
  private configuredMode: ViewMode | null = null;
  private applyingLink = false;
  private unsubscribe: (() => void) | null = null;
  private target = new THREE.Vector3();
  private radius = 60;
  private frameWidth = 60;
  private size = { width: 0, height: 0 };
  private readonly shadowTarget = shadowSpriteTarget();
  /** 1x size and anchor of the last in-game render. */
  inGameBox: InGameBox = { width: 0, height: 0, anchorX: 0, anchorY: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, spec: StageSpec, parts: StagePart[], initial: StageState,
    private readonly options: { height?: number; link?: CameraLink | null } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, stencil: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.state = initial;
    this.model = new VoxelModel(spec, parts);
    if (options.link) this.unsubscribe = options.link.subscribe((direction, source) => { if (source !== this) this.applyDirection(direction); });
    this.setState(initial);
  }

  setLabelListener(listener: ((labels: StageLabel[]) => void) | null) { this.onLabels = listener; }

  setState(next: Partial<StageState>) {
    this.state = { ...this.state, ...next };
    this.model.setPalette(this.state.palette);
    if (this.state.mode !== this.configuredMode) this.configureMode();
    this.layout();
    this.render();
  }

  private layout() {
    this.model.pose(this.state);
    if (this.state.mode === "ingame") { this.fitInGame(); return; }
    const { centre, halfHeight, halfWidth } = this.model.framing;
    this.frameWidth = halfWidth;
    if (Math.abs(halfHeight - this.radius) > 0.5 || this.target.distanceTo(new THREE.Vector3(...centre)) > 0.5) {
      const offset = this.ortho.position.clone().sub(this.target);
      this.target.set(...centre);
      this.radius = halfHeight;
      this.ortho.position.copy(this.target).add(offset);
      this.controls?.target.copy(this.target);
      this.updateFrustum();
    }
  }

  /** Sizes the canvas to the unit's 1x screen bounds with the actor centre on an integer pixel. */
  private fitInGame() {
    const box = this.model.inGameBox;
    this.inGameBox = box;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(box.width, box.height, false);
    const z = this.state.zoom;
    this.canvas.style.width = `${box.width * z}px`;
    this.canvas.style.height = `${box.height * z}px`;
    this.canvas.style.imageRendering = "pixelated";
    aimInGame(this.ortho, box);
  }

  private updateFrustum() {
    const aspect = this.size.width / Math.max(1, this.size.height);
    const h = Math.max(this.radius, this.frameWidth / aspect) * 1.12 + 2;
    const w = h * aspect;
    Object.assign(this.ortho, { left: -w, right: w, top: h, bottom: -h });
    this.ortho.updateProjectionMatrix();
  }

  private configureMode() {
    const previous = this.configuredMode;
    this.configuredMode = this.state.mode;
    if (this.state.mode === "ingame") {
      this.controls?.dispose();
      this.controls = null;
      return;
    }
    this.measure();
    this.canvas.style.imageRendering = "auto";
    if (!this.controls || previous === "ingame" || previous === null) {
      // Start at the battlefield angle (or the linked direction), looking at the model's centre.
      const e = this.model.elevation;
      const direction = this.options.link?.linked && this.options.link.last ? this.options.link.last : [0, Math.sin(e), Math.cos(e)];
      this.ortho.up.set(0, 1, 0);
      this.ortho.position.copy(this.target).add(new THREE.Vector3(...direction).multiplyScalar(800));
      this.ortho.zoom = 1;
      this.ortho.lookAt(this.target);
    }
    if (!this.controls) {
      this.controls = new OrbitControls(this.ortho, this.canvas);
      this.controls.enableDamping = false;
      this.controls.addEventListener("change", () => {
        this.render();
        if (!this.applyingLink && this.options.link) {
          const d = this.ortho.position.clone().sub(this.target).normalize();
          this.options.link.publish([d.x, d.y, d.z], this);
        }
      });
    }
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  private applyDirection(direction: [number, number, number]) {
    if (this.state.mode === "ingame" || !this.controls) return;
    this.applyingLink = true;
    const distance = this.ortho.position.distanceTo(this.target) || 800;
    this.ortho.position.copy(this.target).add(new THREE.Vector3(...direction).multiplyScalar(distance));
    this.ortho.lookAt(this.target);
    this.controls.update();
    this.applyingLink = false;
    this.render();
  }

  private measure() {
    const parent = this.canvas.parentElement;
    const width = Math.max(220, Math.floor(parent?.clientWidth ?? 480) - 2);
    const height = this.options.height ?? Math.max(260, Math.min(560, Math.round(width * 0.62)));
    this.size = { width, height };
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.updateFrustum();
  }

  resize() {
    if (this.state.mode === "ingame") return;
    this.measure();
    this.render();
  }

  render() {
    if (this.disposed) return;
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = requestAnimationFrame(() => this.draw());
  }

  /** Renders synchronously (for read-back). */
  draw() {
    if (this.disposed) return;
    const ingame = this.state.mode === "ingame";
    const tint = ingame ? this.state.tint : [1, 1, 1];
    if (ingame) { renderShadowSprite(this.renderer, this.model, this.shadowTarget); this.renderer.setRenderTarget(null); }
    const bg = this.state.background;
    if (bg) this.renderer.setClearColor(new THREE.Color().setRGB((bg[0] / 255) * tint[0], (bg[1] / 255) * tint[1], (bg[2] / 255) * tint[2], THREE.SRGBColorSpace), 1);
    else this.renderer.setClearColor(0x000000, 0);
    this.model.setTint(tint);
    this.renderer.clear(true, true, true);
    this.ortho.updateMatrixWorld();
    if (ingame) this.renderer.render(this.model.shadowScene, this.ortho);
    else { this.renderer.render(this.model.groundScene, this.ortho); this.renderer.clearDepth(); }
    this.renderer.render(this.model.modelScene, this.ortho);
    if (this.onLabels) {
      const labels = projectLabels(this.model, this.ortho, this.canvas.clientWidth, this.canvas.clientHeight);
      // Only notify on change: the listener sets React state.
      if (JSON.stringify(labels) !== JSON.stringify(this.labels)) { this.labels = labels; this.onLabels(labels); }
    }
  }

  /** The in-game render as RGBA (after draw), for comparison with the CPU reference. */
  readInGame(): Uint8ClampedArray | null {
    if (this.state.mode !== "ingame") return null;
    this.draw();
    const gl = this.renderer.getContext();
    const { width, height } = this.inGameBox;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) out.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    return out;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.unsubscribe?.();
    this.controls?.dispose();
    this.model.dispose();
    this.shadowTarget.dispose();
    this.renderer.dispose();
  }
}
