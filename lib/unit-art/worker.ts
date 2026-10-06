/// <reference lib="webworker" />
/**
 * Unit-art worker: resolves which art each actor uses and rasterizes its frames off the main thread with the Art
 * Lab's own decoders and renderers (vxl/hva/shp/pal decoders, raster.ts for voxels, sprite-compose.ts for SHP rigs,
 * fire.ts for muzzle flashes). Frames come back as RGBA images (transferred, not copied) for the atlas.
 *
 * Art sources (see types.ts ArtSource): on the public site only the committed, provenance-checked public/art-lab files
 * are used. When the dev-only Studio API answers on the same origin (the local app), the local resolver is loaded on
 * demand and serves the preview mod's installed candidates, the main mod, and original units from the private cache.
 */
import { decodeHva, type Hva } from "../art-lab/hva";
import { decodePal, type Palette } from "../art-lab/pal";
import { decodeShp, type Shp } from "../art-lab/shp";
import { decodeVxl, type Vxl } from "../art-lab/vxl";
import { parseHexColor, remapPalette } from "../art-lab/remap";
import { RA2_NORMALS, TS_NORMALS } from "../art-lab/normals.generated";
import { rasterizeUnit, type RasterImage } from "../art-lab/raster";
import { composeRig, rigFiles, rigPoseLayers, rigTickMs, spriteRig, stampLayers, type RigShps } from "../art-lab/sprite-compose";
import { quantizeFacing, sequenceLength } from "../art-lab/sprite-render";
import { pickAnimation, spriteAnimations } from "../art-lab/sprite-anim";
import { voxelAnimationFrames, voxelAnimationParts } from "../art-lab/voxel-animation";
import { combineShps, fireLayers, firePeriod, fireState, firing, voxelMuzzleLayers, type FireRules, type MuzzleArt } from "../art-lab/fire";
import { localToWorld, rotateYaw } from "../art-lab/voxel-math";
import { partVisibleByDefault, type PaletteSpec } from "../art-lab/spec";
import type { SpriteSequence } from "../art-lab/types";
import { publicItem } from "./resolve-public";
import type { ActionMeta, ActorRef, ArtAction, ArtItem, ArtMeta, ArtSource, FrameImage, FrameRequest, FromWorker, ToWorker } from "./types";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

type Muzzle = MuzzleArt & { palette: Palette };
type Art = { item: ArtItem; meta: ArtMeta; muzzles: Record<string, Muzzle> };
type LocalResolver = (actor: ActorRef) => Promise<{ item: ArtItem; source: ArtSource; key: string } | null>;

let mode: "ra" | "ra2" = "ra2";
let ready: Promise<LocalResolver | null> = Promise.resolve(null);
const arts = new Map<string, Art>();
const resolving = new Map<string, Promise<Art | null>>();

// ---- Asset loading (each file fetched and decoded once) ----
const files = new Map<string, Promise<Uint8Array>>();
function bytes(url: string) {
  let p = files.get(url);
  if (!p) {
    p = fetch(url).then(async r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); });
    p.catch(() => files.delete(url));
    files.set(url, p);
  }
  return p;
}
const decoded = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = decoded.get(key) as Promise<T> | undefined;
  if (!p) { p = make(); p.catch(() => decoded.delete(key)); decoded.set(key, p); }
  return p;
}
const vxl = (url: string) => once<Vxl>(`vxl:${url}`, async () => decodeVxl(await bytes(url)));
const hva = (url: string) => once<Hva>(`hva:${url}`, async () => decodeHva(await bytes(url)));
const shp = (url: string) => once<Shp>(`shp:${url}`, async () => decodeShp(await bytes(url)));
const basePalette = (p: PaletteSpec) => once<Palette>(`pal:${p.url}:${p.transparent}:${p.shadow}`, async () => decodePal(await bytes(p.url), p.transparent, p.shadow));
const palette = (p: PaletteSpec, hex: string | null) => once<Palette>(`pal:${p.url}:${p.transparent}:${p.shadow}:${hex}`, async () => {
  const base = await basePalette(p);
  return hex && p.remap.length ? remapPalette(base, p.remap, parseHexColor(hex)) : base;
});
async function rigShps(item: ArtItem, anim: string) {
  const rig = spriteRig(item.sprite, anim);
  if (!rig) return null;
  await Promise.all(rigFiles(rig).map(shp));
  const get = async (s: SpriteSequence | null | undefined) => (s?.file ? shp(s.file) : null);
  const shps: RigShps = {
    body: (await get(rig.body))!, turret: await get(rig.turret), overlay: await get(rig.overlay),
    overlays: await Promise.all(rig.overlays.map(o => get(o.seq))), barrel: await get(rig.barrel?.seq), turretSprites: await Promise.all(rig.turretSprites.map(get)),
  };
  return shps.body ? { rig, shps } : null;
}

/** Muzzle flash art named by the firing rules: original effect art, so only through the local dev API. */
async function muzzles(fire: FireRules | null): Promise<Record<string, Muzzle>> {
  const out: Record<string, Muzzle> = {};
  if (!fire?.muzzleOverlay) return out;
  for (const a of fire.armaments) {
    if (!a.muzzle || out[a.muzzle]) continue;
    try {
      const query = new URLSearchParams({ mode: "ra2", source: fire.source, image: fire.image, sequence: a.muzzle, palette: a.muzzlePalette });
      const r = await fetch(`/api/art-review/visual?${query}`);
      if (!r.ok) continue;
      const art = await r.json() as { sequence: SpriteSequence; palette: PaletteSpec; combine?: { file: string; start: number; length: number | "*"; offset: [number, number] }[] };
      const body = art.combine?.length ? combineShps(await Promise.all(art.combine.map(async p => ({ shp: await shp(p.file), start: p.start, length: p.length, offset: p.offset })))) : await shp(art.sequence.file!);
      out[a.muzzle] = { shp: body, seq: art.sequence, palette: await palette(art.palette, null), placeholder: false };
    } catch { /* No flash for this armament. */ }
  }
  return out;
}

// ---- What each action plays ----
const WDIST_TO_PX = 30 / 1448;
async function describe(art: string, item: ArtItem, source: ArtSource, flashes: Record<string, Muzzle>): Promise<ArtMeta> {
  const { spec, sprite, fire } = item;
  const firePeriodMs = fire && firing(fire) ? firePeriod(fire, flashes) : null;
  if (spec.voxel) {
    const cycle = voxelAnimationParts(spec);
    const stand: ActionMeta = { anim: "stand", frames: cycle.length ? Math.max(...cycle.map(p => p.frames)) : 1, tickMs: cycle.length ? Math.min(...cycle.map(p => p.tickRate! * 40)) : 1000, facings: 32 };
    return { art, source, render: "voxel", facings: 32, turret: spec.voxel.parts.some(p => p.turretOffset), actions: { stand, move: stand }, firePeriodMs, altitudePx: (spec.voxel.altitude ?? 0) * WDIST_TO_PX };
  }
  const list = spriteAnimations(sprite);
  const actionAnim: Record<ArtAction, string | null> = {
    stand: pickAnimation(sprite, "stand")?.id ?? null,
    move: list.some(a => a.id === "move") ? "move" : null,
    attack: list.some(a => a.id === "attack") ? "attack" : list.find(a => a.label === "Fire")?.id ?? null,
    die: list.some(a => a.id === "die") ? "die" : null,
    damaged: list.find(a => a.id.startsWith("damaged-") && !a.turret)?.id ?? null,
  };
  const actions: Partial<Record<ArtAction, ActionMeta>> = {};
  let turret = false, facings = 1;
  for (const action of Object.keys(actionAnim) as ArtAction[]) {
    const anim = actionAnim[action];
    if (!anim) continue;
    const loaded = await rigShps(item, anim);
    if (!loaded) continue;
    const { rig, shps } = loaded;
    actions[action] = { anim, frames: Math.max(1, sequenceLength(rig.body, shps.body)), tickMs: rigTickMs(rig, shps), facings: Math.max(1, rig.body.facings) };
    if (action === "stand") { turret = Boolean(rig.turret); facings = Math.max(1, rig.body.facings); }
  }
  return { art, source, render: "sprite", facings, turret, actions, firePeriodMs, altitudePx: (spec.airAltitude ?? 0) * WDIST_TO_PX };
}

async function resolve(actor: ActorRef): Promise<Art | null> {
  const local = await ready;
  let found: { item: ArtItem; source: ArtSource; key: string } | null = null;
  if (local) { try { found = await local(actor); } catch { found = null; } }
  // Without the local API, only the project's own published art: original units stay placeholders.
  if (!local) { const item = publicItem(actor); found = item ? { item, source: "public", key: `public:${actor.id}` } : null; }
  if (!found) return null;
  const existing = arts.get(found.key);
  if (existing) return existing;
  const flashes = await muzzles(found.item.fire);
  const meta = await describe(found.key, found.item, found.source, flashes);
  const art: Art = { item: found.item, meta, muzzles: flashes };
  arts.set(found.key, art);
  return art;
}

// ---- Frames ----
function tinted(image: RasterImage, tint: number): RasterImage {
  if (tint === 1) return image;
  const d = image.data;
  // Wrecks: darker and desaturated, as the burnt-out husk palettes read.
  for (let i = 0; i < d.length; i += 4) { const grey = (d[i] + d[i + 1] + d[i + 2]) / 3; d[i] = (d[i] * .4 + grey * .6) * tint; d[i + 1] = (d[i + 1] * .4 + grey * .6) * tint; d[i + 2] = (d[i + 2] * .4 + grey * .6) * tint; }
  return image;
}

async function render(req: FrameRequest): Promise<RasterImage> {
  const art = arts.get(req.art);
  if (!art) throw new Error("Unknown art");
  const { spec, sprite } = art.item;
  if (req.action === "gunfire") return muzzleOverlay(art, req);
  if (!spec.palette) throw new Error("No palette");
  const pal = await palette(spec.palette, req.color);
  if (spec.voxel) {
    const v = spec.voxel;
    const turret = req.aim >= 0 ? (req.aim - req.facing) & 1023 : 0;
    const timeMs = req.frame * (art.meta.actions.stand?.tickMs ?? 0);
    const cycle = voxelAnimationFrames(spec, timeMs);
    const parts = await Promise.all(v.parts.filter(partVisibleByDefault).map(async p => {
      let yaw = req.facing & 1023, worldOffset = p.offset;
      if (p.turretOffset) {
        yaw = (req.facing + turret) & 1023;
        worldOffset = localToWorld(rotateYaw(p.turretOffset, req.facing), v.useClassicPerspectiveFudge, v.cameraPitch);
      }
      return { vxl: await vxl(p.vxl), hva: await hva(p.hva), yaw, worldOffset, frame: cycle[p.id] ?? 0, showShadow: req.shadow && p.showShadow };
    }));
    return rasterizeUnit({ parts, scale: v.scale, cameraPitch: v.cameraPitch, lightPitch: v.lightPitch, lightYaw: v.lightYaw, ambient: v.ambient, diffuse: v.diffuse, palette: pal, normals: v.normals === "RedAlert2" ? RA2_NORMALS : TS_NORMALS, shadowColor: [0, 0, 0, 140], altitude: 0 });
  }
  const action = req.action;
  const meta = art.meta.actions[action] ?? art.meta.actions.stand;
  if (!meta || !sprite) throw new Error("No sprite sequence");
  const loaded = await rigShps(art.item, meta.anim);
  if (!loaded) throw new Error("No sprite rig");
  const { rig, shps } = loaded;
  const vehicle = rig.body.facings > 1 && Boolean(rig.turret);
  const turretFacing = req.aim < 0 ? 0 : vehicle ? (req.aim - quantizeFacing(req.facing, rig.quantizedFacings, rig.classicFacingBodyOrientation)) & 1023 : (req.aim - rig.initialFacing) & 1023;
  return composeRig(rig, shps, pal, { facing: req.facing, turretFacing, tick: 0, shadow: req.shadow, timeMs: req.frame * meta.tickMs, loop: action !== "die" });
}

/**
 * The Fire action's muzzle flashes alone, anchored at the actor's centre, `req.frame` 40 ms ticks after a shot: drawn
 * over the unit's standing frame, as the engine draws WithMuzzleOverlay over the body (barrel recoil is not shown).
 */
async function muzzleOverlay(art: Art, req: FrameRequest): Promise<RasterImage> {
  const { spec, sprite, fire } = art.item;
  const empty: RasterImage = { width: 1, height: 1, data: new Uint8ClampedArray(4), anchorX: 0, anchorY: 0 };
  if (!fire) return empty;
  const states = fireState(fire, req.frame * 40, art.muzzles);
  if (spec.voxel) {
    const turret = req.aim >= 0 ? (req.aim - req.facing) & 1023 : 0;
    return stampLayers(empty, voxelMuzzleLayers(fire, states, art.muzzles, req.facing, turret, spec.voxel.useClassicPerspectiveFudge, 0));
  }
  const loaded = sprite ? await rigShps(art.item, art.meta.actions.stand?.anim ?? "stand") : null;
  if (!loaded) return empty;
  const { rig, shps } = loaded;
  const vehicle = rig.body.facings > 1 && Boolean(rig.turret);
  const turretFacing = req.aim < 0 ? 0 : vehicle ? (req.aim - quantizeFacing(req.facing, rig.quantizedFacings, rig.classicFacingBodyOrientation)) & 1023 : (req.aim - rig.initialFacing) & 1023;
  const flashes = new Set(Object.values(art.muzzles).map(m => m.seq));
  const layers = fireLayers(rigPoseLayers(rig, shps, { facing: req.facing, turretFacing, tick: 0, shadow: false }), rig, fire, states, art.muzzles, req.facing, turretFacing)
    .filter((l): l is typeof l & { palette: Palette } => flashes.has(l.seq) && Boolean(l.palette));
  return stampLayers(empty, layers);
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    mode = message.mode;
    ready = (async () => {
      if (!message.probeLocal) return null;
      try {
        // The dev-only Studio API: present in the local app, absent (404) on the public site.
        const r = await fetch(`/api/art-review/stamp?mode=${mode === "ra2" ? "ra2" : "classic"}`, { cache: "no-store" });
        const body = r.ok && (r.headers.get("content-type") ?? "").includes("json") ? await r.json() as { stamp?: unknown } : null;
        if (!body || typeof body.stamp !== "string") return null;
        const { localResolver } = await import("./resolve-local");
        return await localResolver(mode);
      } catch { return null; }
    })();
    void ready.then(local => post({ type: "ready", local: Boolean(local), detail: local ? "local" : "public" }));
    return;
  }
  if (message.type === "register") {
    if (!arts.has(message.art)) void muzzles(message.item.fire).then(m => arts.set(message.art, { item: message.item, meta: message.meta, muzzles: m }));
    return;
  }
  if (message.type === "resolve") {
    void Promise.all(message.actors.map(async actor => {
      let p = resolving.get(actor.key);
      if (!p) { p = resolve(actor).catch(() => null); resolving.set(actor.key, p); }
      const art = await p;
      return { key: actor.key, meta: art?.meta ?? null, item: art?.item ?? null };
    })).then(entries => post({ type: "resolved", entries }));
    return;
  }
  if (message.type === "frame") {
    const { id, request } = message;
    void (async () => {
      // A raster worker that has not registered the art yet waits for it briefly.
      for (let i = 0; i < 50 && !arts.has(request.art); i++) await new Promise(r => setTimeout(r, 20));
      const image = tinted(await render(request), request.tint);
      const out: FrameImage = { width: image.width, height: image.height, anchorX: image.anchorX, anchorY: image.anchorY, data: image.data };
      post({ type: "frame", id, image: out }, [out.data.buffer]);
    })().catch(error => post({ type: "frame", id, image: null, error: error instanceof Error ? error.message : String(error) }));
  }
};
