/**
 * three.js voxel stage (client only; imported dynamically so no other route pays for three.js).
 * In-game mode reproduces OpenRA's battlefield projection pixel for pixel at 1x. 3D orbit and exploded modes
 * show the same transforms from any angle (ground horizontal, model up = screen up), auto-framed to fill the
 * canvas, with the parts pulled apart, labelled and their pivots marked in exploded mode.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Hva } from "../../../lib/art-lab/hva";
import type { Palette } from "../../../lib/art-lab/pal";
import type { Vxl, VxlLimb } from "../../../lib/art-lab/vxl";
import type { Vec3 } from "../../../lib/art-lab/types";
import { quantizedNormal } from "../../../lib/art-lab/raster";
import { cameraMatrix, groundProjection, localToWorld, multiply, partMatrices, rotateYaw, transformVector, type Mat4 } from "../../../lib/art-lab/voxel-math";
import type { CameraLink, ViewMode } from "./viewSettings";

export type StagePart = {
  id: string;
  label: string;
  vxl: Vxl;
  hva: Hva;
  offset: Vec3;
  turretOffset: Vec3 | null;
  showShadow: boolean;
};

export type StageSpec = {
  scale: number; cameraPitch: number; lightPitch: number; lightYaw: number; ambient: Vec3; diffuse: Vec3;
  useClassicPerspectiveFudge: boolean; normals: readonly number[]; altitude: number | null;
};

export type StageState = {
  mode: ViewMode;
  facing: number;
  turretFacing: number;
  frame: number;
  zoom: 1 | 2 | 4;
  visible: Record<string, boolean>;
  shadow: boolean;
  airborne: boolean;
  background: [number, number, number];
  tint: [number, number, number];
  palette: Palette;
};

export type StageLabel = { id: string; text: string; x: number; y: number; kind: "part" | "pivot" };

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
      for (const c of face.corners) { positions.push(x + c[0], y + c[1], z + c[2]); colors.push(limb.colors[i]); nrm.push(n[0], n[1], n[2]); }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 1));
  g.setAttribute("aNormalVx", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(index);
  g.computeBoundingBox();
  return g;
}

const vertexShader = `
attribute float aColor;
attribute vec3 aNormalVx;
varying float vColor;
varying vec3 vNormalVx;
void main() {
  vColor = aColor;
  vNormalVx = aNormalVx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// OpenRA glsl/model.frag: intensity = ambient + diffuse * max(dot(normal4, light4), 0) with w = 1 on both.
const fragmentShader = `
uniform sampler2D uPalette;
uniform vec3 uLight;
uniform vec3 uAmbient;
uniform vec3 uDiffuse;
uniform vec3 uTint;
varying float vColor;
varying vec3 vNormalVx;
void main() {
  vec4 c = texture2D(uPalette, vec2((floor(vColor + 0.5) + 0.5) / 256.0, 0.5));
  if (c.a < 0.01) discard;
  float d = max(dot(vNormalVx, uLight) + 1.0, 0.0);
  vec3 rgb = clamp((uAmbient + uDiffuse * d) * c.rgb, 0.0, 1.0);
  gl_FragColor = vec4(rgb * uTint, 1.0);
}`;

const setMatrix = (object: THREE.Object3D, m: Mat4) => {
  object.matrixAutoUpdate = false;
  object.matrix.fromArray(m);
  object.matrixWorldNeedsUpdate = true;
};

export class VoxelStage {
  readonly renderer: THREE.WebGLRenderer;
  private readonly modelScene = new THREE.Scene();
  private readonly shadowScene = new THREE.Scene();
  private readonly groundScene = new THREE.Scene();
  private readonly root = new THREE.Group();
  private readonly helpers = new THREE.Group();
  private readonly ground = new THREE.Group();
  private readonly ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, -10000, 10000);
  private controls: OrbitControls | null = null;
  private readonly paletteTexture: THREE.DataTexture;
  private readonly limbs: { part: StagePart; limbIndex: number; mesh: THREE.Mesh; shadow: THREE.Mesh; material: THREE.ShaderMaterial }[] = [];
  private state: StageState;
  private labels: StageLabel[] = [];
  private onLabels: ((labels: StageLabel[]) => void) | null = null;
  private pendingLabels: { id: string; text: string; world: Vec3; kind: "part" | "pivot" }[] = [];
  private disposed = false;
  private frameRequest = 0;
  private configuredMode: ViewMode | null = null;
  private applyingLink = false;
  private unsubscribe: (() => void) | null = null;
  private readonly orbitRoot: Mat4;
  private readonly elevation: number;
  private target = new THREE.Vector3();
  private radius = 60;
  private frameWidth = 60;
  private size = { width: 0, height: 0 };
  /** 1x size and anchor of the last in-game render. */
  inGameBox = { width: 0, height: 0, anchorX: 0, anchorY: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly spec: StageSpec, private readonly parts: StagePart[], initial: StageState,
    private readonly options: { height?: number; link?: CameraLink | null } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, stencil: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.state = initial;
    // Orbit frame: tilt the battlefield camera space so model up is screen up (three's Y), keeping the
    // in-game handedness; the default orbit camera then sits at the battlefield elevation.
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
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 140 / 255, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    });
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
        const shadow = new THREE.Mesh(geometry, shadowMaterial);
        mesh.frustumCulled = false;
        shadow.frustumCulled = false;
        this.root.add(mesh);
        this.shadowScene.add(shadow);
        this.limbs.push({ part, limbIndex, mesh, shadow, material });
      });
    }
    if (options.link) this.unsubscribe = options.link.subscribe((direction, source) => { if (source !== this) this.applyDirection(direction); });
    this.setState(initial);
  }

  setLabelListener(listener: ((labels: StageLabel[]) => void) | null) { this.onLabels = listener; }

  setState(next: Partial<StageState>) {
    this.state = { ...this.state, ...next };
    if (next.palette) { (this.paletteTexture.image.data as Uint8Array).set(next.palette); this.paletteTexture.needsUpdate = true; }
    if (this.state.mode !== this.configuredMode) this.configureMode();
    this.layout();
    this.render();
  }

  private poses() {
    const { facing, turretFacing } = this.state;
    return this.parts.map(part => {
      if (part.turretOffset) {
        const world = localToWorld(rotateYaw(part.turretOffset, facing), this.spec.useClassicPerspectiveFudge, this.spec.cameraPitch);
        return { part, yaw: (facing + turretFacing) & 1023, worldOffset: world };
      }
      return { part, yaw: facing & 1023, worldOffset: part.offset };
    });
  }

  /** Recomputes every limb's matrix and light for the current pose. */
  private layout() {
    const { mode, frame, visible } = this.state;
    const poses = new Map(this.poses().map(p => [p.part.id, p]));
    const altitudePx = this.state.airborne && this.spec.altitude ? (30 * this.spec.altitude) / 1448 : 0;
    const lift: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -altitudePx, 0, 1];
    const shown = this.parts.filter(p => visible[p.id] !== false).map(p => p.id);
    this.helpers.clear();
    const labels: typeof this.pendingLabels = [];
    let zmin = Infinity, zmax = -Infinity, rxy = 0;
    for (const limb of this.limbs) {
      const pose = poses.get(limb.part.id)!;
      const rows = limb.part.hva.rows;
      const row = rows[Math.min(frame, rows.length - 1)]?.[limb.limbIndex] ?? rows[0][limb.limbIndex];
      const m = partMatrices({
        scale: this.spec.scale, cameraPitch: this.spec.cameraPitch, lightPitch: this.spec.lightPitch, lightYaw: this.spec.lightYaw,
        pose: { yaw: pose.yaw, worldOffset: pose.worldOffset }, limb: limb.part.vxl.limbs[limb.limbIndex], hvaRow: row,
      });
      (limb.material.uniforms.uLight.value as THREE.Vector3).set(...m.light);
      const on = visible[limb.part.id] !== false;
      limb.mesh.visible = on;
      limb.shadow.visible = on && this.state.shadow && mode === "ingame" && limb.part.showShadow;
      const raise = mode === "exploded" ? EXPLODE_STEP * Math.max(0, shown.indexOf(limb.part.id)) : 0;
      const explode: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, raise, 1];
      if (mode === "ingame") {
        setMatrix(limb.mesh, multiply(FLIP_Y, multiply(lift, multiply(m.camera, m.modelToWorld))));
        setMatrix(limb.shadow, multiply(FLIP_Y, multiply(m.camera, multiply(groundProjection(m.lightWorld, 0), m.modelToWorld))));
        continue;
      }
      const world = multiply(explode, m.modelToWorld);
      setMatrix(limb.mesh, world);
      if (on) {
        const box = limb.mesh.geometry.boundingBox!;
        for (const corner of [[box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z], [box.min.x, box.max.y, box.min.z], [box.max.x, box.min.y, box.max.z], [box.min.x, box.min.y, box.max.z], [box.max.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z], [box.max.x, box.min.y, box.min.z]]) {
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
    this.pendingLabels = labels;
    if (mode === "ingame") { this.fitInGame(); return; }
    setMatrix(this.helpers, this.orbitRoot);
    setMatrix(this.ground, this.orbitRoot);
    if (!Number.isFinite(zmin)) { zmin = 0; zmax = 20; rxy = 30; }
    // Frame the cylinder the unit sweeps when it turns (so spinning never re-zooms), as seen from the
    // battlefield elevation: half-width = its radius, half-height = radius * sin(e) + half its height * cos(e).
    const centre = transformVector(this.orbitRoot, [0, 0, (zmin + zmax) / 2, 1]);
    const halfHeight = rxy * Math.sin(this.elevation) + ((zmax - zmin) / 2) * Math.cos(this.elevation);
    this.frameWidth = rxy;
    const radius = halfHeight;
    if (Math.abs(radius - this.radius) > 0.5 || this.target.distanceTo(new THREE.Vector3(centre[0], centre[1], centre[2])) > 0.5) {
      const offset = this.ortho.position.clone().sub(this.target);
      this.target.set(centre[0], centre[1], centre[2]);
      this.radius = radius;
      this.ortho.position.copy(this.target).add(offset);
      this.controls?.target.copy(this.target);
      this.updateFrustum();
    }
    this.ground.clear();
    const extent = Math.max(80, Math.ceil(rxy / 10) * 20 + 20);
    const grid = new THREE.GridHelper(extent, extent / 10, 0x6f7d58, 0x3c4238);
    grid.rotation.x = Math.PI / 2;
    grid.updateMatrix();
    this.ground.add(grid);
    const forward = this.forward();
    this.ground.add(new THREE.ArrowHelper(new THREE.Vector3(...forward), new THREE.Vector3(0, 0, 0.5), rxy + 8, 0xf1d28b, 8, 5));
  }

  private forward(): Vec3 {
    const m = partMatrices({
      scale: 1, cameraPitch: this.spec.cameraPitch, lightPitch: this.spec.lightPitch, lightYaw: this.spec.lightYaw,
      pose: { yaw: this.state.facing, worldOffset: [0, 0, 0] }, limb: { scale: 1, bounds: [0, 0, 0, 1, 1, 1], size: [1, 1, 1] }, hvaRow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
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

  /** Sizes the canvas to the unit's 1x screen bounds with the actor centre on an integer pixel. */
  private fitInGame() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const limb of this.limbs) {
      for (const mesh of [limb.mesh, limb.shadow]) {
        if (!mesh.visible) continue;
        const box = mesh.geometry.boundingBox!;
        for (const c of [[box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z], [box.min.x, box.max.y, box.min.z], [box.max.x, box.min.y, box.max.z], [box.min.x, box.min.y, box.max.z], [box.max.x, box.max.y, box.min.z], [box.min.x, box.max.y, box.max.z], [box.max.x, box.min.y, box.min.z]]) {
          const v = new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(mesh.matrix);
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, -v.y); y1 = Math.max(y1, -v.y);
        }
      }
    }
    if (!Number.isFinite(x0)) { x0 = -10; x1 = 10; y0 = -10; y1 = 10; }
    const width = Math.ceil(x1) - Math.floor(x0) + 4;
    const height = Math.ceil(y1) - Math.floor(y0) + 4;
    const anchorX = 2 - Math.floor(x0);
    const anchorY = 2 - Math.floor(y0);
    this.inGameBox = { width, height, anchorX, anchorY };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    const z = this.state.zoom;
    this.canvas.style.width = `${width * z}px`;
    this.canvas.style.height = `${height * z}px`;
    this.canvas.style.imageRendering = "pixelated";
    Object.assign(this.ortho, { left: -anchorX, right: width - anchorX, top: anchorY, bottom: anchorY - height });
    this.ortho.position.set(0, 0, 0);
    this.ortho.up.set(0, 1, 0);
    this.ortho.lookAt(0, 0, -1);
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
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
      const direction = this.options.link?.linked && this.options.link.last ? this.options.link.last : [0, Math.sin(this.elevation), Math.cos(this.elevation)];
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
    const [r, g, b] = this.state.background;
    const tint = this.state.mode === "ingame" ? this.state.tint : [1, 1, 1];
    this.renderer.setClearColor(new THREE.Color().setRGB((r / 255) * tint[0], (g / 255) * tint[1], (b / 255) * tint[2], THREE.SRGBColorSpace), 1);
    for (const limb of this.limbs) (limb.material.uniforms.uTint.value as THREE.Vector3).set(tint[0], tint[1], tint[2]);
    this.renderer.clear(true, true, true);
    this.ortho.updateMatrixWorld();
    if (this.state.mode === "ingame") this.renderer.render(this.shadowScene, this.ortho);
    else { this.renderer.render(this.groundScene, this.ortho); this.renderer.clearDepth(); }
    this.renderer.render(this.modelScene, this.ortho);
    if (this.onLabels) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.helpers.updateMatrixWorld();
      const labels = this.pendingLabels.map(l => {
        const v = new THREE.Vector3(...l.world).applyMatrix4(this.helpers.matrixWorld).project(this.ortho);
        return { id: l.id, text: l.text, kind: l.kind, x: Math.round(((v.x + 1) / 2) * w), y: Math.round(((1 - v.y) / 2) * h) };
      });
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
    for (const limb of this.limbs) { limb.mesh.geometry.dispose(); limb.material.dispose(); }
    this.paletteTexture.dispose();
    this.renderer.dispose();
  }
}
