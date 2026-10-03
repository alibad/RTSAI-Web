/**
 * VoxelEngine: ONE WebGL context for every voxel on the Review page (client only, loaded on demand; production
 * builds never include it). `renderInGameAsync` draws a model's battlefield picture at 1x into an offscreen
 * target and reads it back without blocking (pixel-pack buffer + fence) so callers can cache it; `attach` +
 * `show` put the same context's canvas on screen as a 3D orbit or exploded view, redrawn only when the camera
 * or the pose changes. Nothing renders on a loop.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Palette } from "../../../lib/art-lab/pal";
import { aimInGame, projectLabels, renderShadowSprite, shadowSpriteTarget, type InGameBox, type ModelPose, type RasterFrame, type StageLabel, type VoxelModel } from "./voxel-three";

export type EngineView = {
  model: VoxelModel;
  pose: ModelPose;
  palette: Palette;
  onLabels?: (labels: StageLabel[]) => void;
};

export class VoxelEngine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: true });
  private readonly shadowTarget = shadowSpriteTarget();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
  private readonly orbit = new THREE.OrthographicCamera(-50, 50, 50, -50, -10000, 10000);
  private readonly orbitTarget = new THREE.Vector3();
  private controls: OrbitControls | null = null;
  private view: EngineView | null = null;
  private aimed = false;
  private framing = { halfHeight: 30, halfWidth: 30 };
  private size = { width: 1, height: 1 };
  private drawing = false;
  private disposed = false;
  private lastLabels = "";

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "lab-gl";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: true, stencil: true, preserveDrawingBuffer: true });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1, 1, false);
  }

  /** Draws the battlefield picture at 1x into the shared offscreen target (top-left w x h region). */
  private drawInGame(model: VoxelModel, pose: Omit<ModelPose, "mode">, palette: Palette, tint: readonly number[]) {
    model.setPalette(palette);
    model.setTint(tint);
    model.pose({ ...pose, mode: "ingame" });
    const box = { ...model.inGameBox };
    aimInGame(this.camera, box);
    // One grow-only target; each frame uses its top-left region, so nothing is reallocated per frame.
    if (box.width > this.target.width || box.height > this.target.height) {
      this.target.setSize(Math.max(this.target.width, 256, box.width), Math.max(this.target.height, 256, box.height));
    }
    this.target.viewport.set(0, 0, box.width, box.height);
    const r = this.renderer;
    renderShadowSprite(r, model, this.shadowTarget);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(model.shadowScene, this.camera);
    r.render(model.modelScene, this.camera);
    return box;
  }

  private static flip(buffer: Uint8Array, box: InGameBox): RasterFrame {
    const { width, height } = box;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) data.set(buffer.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    return { ...box, data };
  }

  /** The battlefield picture at 1x as RGBA rows (top first). Blocks until the GPU finishes: tests and tools only. */
  renderInGame(model: VoxelModel, pose: Omit<ModelPose, "mode">, palette: Palette, tint: readonly number[]): RasterFrame {
    const box = this.drawInGame(model, pose, palette, tint);
    const buffer = new Uint8Array(box.width * box.height * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, box.width, box.height, buffer);
    this.renderer.setRenderTarget(null);
    return VoxelEngine.flip(buffer, box);
  }

  /**
   * The same picture read back asynchronously (pixel-pack buffer + fence): the draw is queued at once and the
   * main thread never waits for the GPU. The model may be re-posed as soon as this returns.
   */
  renderInGameAsync(model: VoxelModel, pose: Omit<ModelPose, "mode">, palette: Palette, tint: readonly number[]): Promise<RasterFrame> {
    const box = this.drawInGame(model, pose, palette, tint);
    const buffer = new Uint8Array(box.width * box.height * 4);
    const read = this.renderer.readRenderTargetPixelsAsync(this.target, 0, 0, box.width, box.height, buffer);
    this.renderer.setRenderTarget(null);
    return read.then(() => VoxelEngine.flip(buffer, box));
  }

  /** Puts the canvas into `host` (filling it) for the 3D view. */
  attach(host: HTMLElement) {
    if (this.canvas.parentElement !== host) host.appendChild(this.canvas);
    if (!this.controls) {
      this.controls = new OrbitControls(this.orbit, this.canvas);
      this.controls.enableDamping = false;
      this.controls.addEventListener("change", () => this.draw());
    }
    this.resize();
  }

  detach() {
    this.controls?.dispose();
    this.controls = null;
    this.view = null;
    this.aimed = false;
    this.canvas.remove();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1, 1, false);
  }

  /** Shows a model in the 3D view (orbit or exploded); the camera direction survives model and pose changes. */
  show(view: EngineView) {
    this.view = view;
    this.draw();
  }

  resize() {
    const host = this.canvas.parentElement;
    if (!host) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    this.size = { width, height };
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.updateFrustum();
    this.draw();
  }

  private updateFrustum() {
    const aspect = this.size.width / Math.max(1, this.size.height);
    const h = Math.max(this.framing.halfHeight, this.framing.halfWidth / aspect) * 1.12 + 2;
    const w = h * aspect;
    Object.assign(this.orbit, { left: -w, right: w, top: h, bottom: -h });
    this.orbit.updateProjectionMatrix();
  }

  /** Draws the 3D view now (on input or state change only). */
  draw() {
    const view = this.view;
    if (!view || this.disposed || this.drawing || !this.canvas.parentElement) return;
    this.drawing = true;
    try {
      const { model } = view;
      model.setPalette(view.palette);
      model.setTint([1, 1, 1]);
      model.pose(view.pose);
      const { centre, halfHeight, halfWidth } = model.framing;
      const centreVec = new THREE.Vector3(...centre);
      if (!this.aimed) {
        // Start at the battlefield angle, looking at the model's centre.
        const e = model.elevation;
        this.orbitTarget.copy(centreVec);
        this.orbit.up.set(0, 1, 0);
        this.orbit.position.copy(centreVec).add(new THREE.Vector3(0, Math.sin(e), Math.cos(e)).multiplyScalar(800));
        this.orbit.zoom = 1;
        this.orbit.lookAt(centreVec);
        this.aimed = true;
      } else if (this.orbitTarget.distanceTo(centreVec) > 0.5) {
        const offset = this.orbit.position.clone().sub(this.orbitTarget);
        this.orbitTarget.copy(centreVec);
        this.orbit.position.copy(centreVec).add(offset);
      }
      if (Math.abs(this.framing.halfHeight - halfHeight) > 0.5 || Math.abs(this.framing.halfWidth - halfWidth) > 0.5) {
        this.framing = { halfHeight, halfWidth };
        this.updateFrustum();
      }
      if (this.controls) { this.controls.target.copy(this.orbitTarget); this.controls.update(); }
      const r = this.renderer;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, true);
      this.orbit.updateMatrixWorld();
      r.render(model.groundScene, this.orbit);
      r.clearDepth();
      r.render(model.modelScene, this.orbit);
      if (view.onLabels) {
        const labels = projectLabels(model, this.orbit, this.size.width, this.size.height);
        const key = JSON.stringify(labels);
        if (key !== this.lastLabels) { this.lastLabels = key; view.onLabels(labels); }
      }
    } finally {
      this.drawing = false;
    }
  }

  dispose() {
    this.disposed = true;
    this.controls?.dispose();
    this.controls = null;
    this.target.dispose();
    this.shadowTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
