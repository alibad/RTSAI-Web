/**
 * three.js voxel stage (client only; imported dynamically so no other route pays for three.js).
 * In-game mode reproduces OpenRA's battlefield projection pixel for pixel at 1x; orbit and exploded modes
 * show the same transforms from any angle, with the parts pulled apart, labelled and their pivots marked.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Hva } from "../../../lib/art-lab/hva";
import type { Palette } from "../../../lib/art-lab/pal";
import type { Vxl, VxlLimb } from "../../../lib/art-lab/vxl";
import type { Vec3 } from "../../../lib/art-lab/types";
import { quantizedNormal } from "../../../lib/art-lab/raster";
import { groundProjection, localToWorld, multiply, partMatrices, rotateYaw, transformVector, type Mat4 } from "../../../lib/art-lab/voxel-math";

export type StageMode = "ingame" | "orbit" | "exploded";

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
  mode: StageMode;
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
const FACES: { dir: Vec3; corners: Vec3[] }[] = [
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]] },
];

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
  g.computeBoundingSphere();
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
uniform vec3 uHighlight;
varying float vColor;
varying vec3 vNormalVx;
void main() {
  vec4 c = texture2D(uPalette, vec2((floor(vColor + 0.5) + 0.5) / 256.0, 0.5));
  if (c.a < 0.01) discard;
  float d = max(dot(vNormalVx, uLight) + 1.0, 0.0);
  vec3 rgb = clamp((uAmbient + uDiffuse * d) * c.rgb, 0.0, 1.0);
  gl_FragColor = vec4(rgb * uTint + uHighlight, 1.0);
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
  private readonly root = new THREE.Group();
  private readonly helpers = new THREE.Group();
  /** Ground grid, drawn in its own pass before the model so the model always covers it. */
  private readonly groundScene = new THREE.Scene();
  private readonly ground = new THREE.Group();
  private readonly ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, -10000, 10000);
  private controls: OrbitControls | null = null;
  private readonly paletteTexture: THREE.DataTexture;
  private readonly limbs: { part: StagePart; limbIndex: number; mesh: THREE.Mesh; shadow: THREE.Mesh; material: THREE.ShaderMaterial }[] = [];
  private state: StageState;
  private labels: StageLabel[] = [];
  private onLabels: ((labels: StageLabel[]) => void) | null = null;
  private disposed = false;
  private frameRequest = 0;
  /** 1x size and anchor of the last in-game render. */
  inGameBox = { width: 0, height: 0, anchorX: 0, anchorY: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly spec: StageSpec, private readonly parts: StagePart[], initial: StageState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, stencil: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.state = initial;
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
            uTint: { value: new THREE.Vector3(1, 1, 1) }, uHighlight: { value: new THREE.Vector3(0, 0, 0) },
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
    this.setState(initial);
  }

  setLabelListener(listener: ((labels: StageLabel[]) => void) | null) { this.onLabels = listener; }

  setState(next: Partial<StageState>) {
    const previousMode = this.state.mode;
    this.state = { ...this.state, ...next };
    if (next.palette) { (this.paletteTexture.image.data as Uint8Array).set(next.palette); this.paletteTexture.needsUpdate = true; }
    if (this.state.mode !== previousMode || !this.controls !== (this.state.mode === "ingame")) this.configureMode();
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
    const explodeStep = mode === "exploded" ? 18 : 0;
    const order = this.parts.map(p => p.id);
    this.helpers.clear();
    const labels: { id: string; text: string; world: Vec3; kind: "part" | "pivot" }[] = [];
    let camera: Mat4 | null = null;
    for (const limb of this.limbs) {
      const pose = poses.get(limb.part.id)!;
      const rows = limb.part.hva.rows;
      const row = rows[Math.min(frame, rows.length - 1)]?.[limb.limbIndex] ?? rows[0][limb.limbIndex];
      const m = partMatrices({
        scale: this.spec.scale, cameraPitch: this.spec.cameraPitch, lightPitch: this.spec.lightPitch, lightYaw: this.spec.lightYaw,
        pose: { yaw: pose.yaw, worldOffset: pose.worldOffset }, limb: this.parts.find(p => p.id === limb.part.id)!.vxl.limbs[limb.limbIndex], hvaRow: row,
      });
      camera = m.camera;
      (limb.material.uniforms.uLight.value as THREE.Vector3).set(...m.light);
      const on = visible[limb.part.id] !== false;
      limb.mesh.visible = on;
      limb.shadow.visible = on && this.state.shadow && mode === "ingame" && limb.part.showShadow;
      const raise = explodeStep * order.indexOf(limb.part.id);
      const explode: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, raise, 1];
      if (mode === "ingame") {
        setMatrix(limb.mesh, multiply(FLIP_Y, multiply(lift, multiply(m.camera, m.modelToWorld))));
        setMatrix(limb.shadow, multiply(FLIP_Y, multiply(m.camera, multiply(groundProjection(m.lightWorld, 0), m.modelToWorld))));
      } else {
        setMatrix(limb.mesh, multiply(explode, m.modelToWorld));
      }
      if (mode === "exploded" && on && limb.limbIndex === 0) {
        const pivot: Vec3 = [m.pivot[0], m.pivot[1], m.pivot[2] + raise];
        this.addPivot(pivot, limb.part.turretOffset ? 0xf1d28b : 0xef5b3f);
        const box = new THREE.Box3().setFromBufferAttribute(limb.mesh.geometry.getAttribute("position") as THREE.BufferAttribute);
        const top = new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z).applyMatrix4(limb.mesh.matrix);
        labels.push({ id: `${limb.part.id}:part`, text: limb.part.label, world: [top.x, top.y, top.z + 6], kind: "part" });
        labels.push({ id: `${limb.part.id}:pivot`, text: limb.part.turretOffset ? "turret pivot" : "body pivot", world: pivot, kind: "pivot" });
      }
    }
    if (camera) setMatrix(this.root, mode === "ingame" ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : multiply(FLIP_Y, camera));
    if (camera && mode !== "ingame") {
      setMatrix(this.helpers, multiply(FLIP_Y, camera));
      // Ground grid (16 x 10 px squares) on the ground plane.
      this.ground.clear();
      setMatrix(this.ground, multiply(FLIP_Y, camera));
      const grid = new THREE.GridHelper(160, 16, 0x6f7d58, 0x3c4238);
      grid.rotation.x = Math.PI / 2;
      grid.updateMatrix();
      this.ground.add(grid);
      const facingArrow = new THREE.ArrowHelper(new THREE.Vector3(...this.forward()), new THREE.Vector3(0, 0, 0.5), 70, 0xf1d28b, 10, 6);
      this.helpers.add(facingArrow);
      if (this.controls) this.controls.object.up.copy(new THREE.Vector3(...transformVector(multiply(FLIP_Y, camera), [0, 0, 1, 0]).slice(0, 3) as Vec3).normalize());
    }
    this.pendingLabels = labels;
    if (mode === "ingame") this.fitInGame();
  }

  private pendingLabels: { id: string; text: string; world: Vec3; kind: "part" | "pivot" }[] = [];

  private forward(): Vec3 {
    // Model-world direction of the body's front (voxel +x) at the current facing.
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
      if (!limb.mesh.visible) continue;
      for (const mesh of [limb.mesh, limb.shadow]) {
        if (!mesh.visible) continue;
        const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute("position") as THREE.BufferAttribute);
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

  private configureMode() {
    if (this.state.mode === "ingame") {
      this.controls?.dispose();
      this.controls = null;
      return;
    }
    const parent = this.canvas.parentElement;
    const w = Math.max(240, parent?.clientWidth ?? 480);
    const h = Math.max(240, Math.min(520, Math.round(w * 0.66)));
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.style.imageRendering = "auto";
    const half = 90;
    Object.assign(this.ortho, { left: -half * (w / h), right: half * (w / h), top: half, bottom: -half });
    this.ortho.position.set(0, 0, 600);
    this.ortho.up.set(0, 1, 0);
    this.ortho.lookAt(0, 0, 0);
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
    if (!this.controls) {
      this.controls = new OrbitControls(this.ortho, this.canvas);
      this.controls.enableDamping = false;
      this.controls.addEventListener("change", () => this.render());
    }
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  resize() { if (this.state.mode !== "ingame") { this.configureMode(); this.layout(); this.render(); } }

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
    this.controls?.dispose();
    for (const limb of this.limbs) { limb.mesh.geometry.dispose(); limb.material.dispose(); }
    this.paletteTexture.dispose();
    this.renderer.dispose();
  }
}
