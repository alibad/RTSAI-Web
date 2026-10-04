/** Local CPU-only audit. EA references can only be written under the ignored Art cache. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { decodeVxl } from "../lib/art-lab/vxl";
import { decodeHva } from "../lib/art-lab/hva";
import { decodeShp } from "../lib/art-lab/shp";
import { decodePal } from "../lib/art-lab/pal";
import { parseHexColor, remapPalette } from "../lib/art-lab/remap";
import { poseParts, rasterizeUnit, type RasterImage } from "../lib/art-lab/raster";
import { RA2_NORMALS, TS_NORMALS } from "../lib/art-lab/normals.generated";
import { composeRig, spriteRig, rigFiles } from "../lib/art-lab/sprite-compose";
import { partVisibleByDefault } from "../lib/art-lab/spec";
import { sequenceFrame, sequenceLength } from "../lib/art-lab/sprite-render";
import type { RosterPayload, StockArt } from "../lib/art-lab/originals";

const out = resolve("../RTSAI-Art/.cache/ra2-theme-audit");
mkdirSync(out, { recursive: true });
const payload: RosterPayload = JSON.parse(readFileSync(join(out, "roster.json"), "utf8"));
const generated = new Map(payload.factions.flatMap(f => f.units.filter(u => u.origin !== "original").map(u => [u.id, u] as const)));
const ids = new Set([...generated.keys(), ...[...generated.values()].map(u => u.reference).filter((i): i is string => Boolean(i))]);
const cache = new Map<string, Promise<Uint8Array>>();
function bytes(url: string) {
  if (!/^\/api\/art-review\/(mod|ra2)\//.test(url)) throw new Error("Only local art routes are allowed");
  if (!cache.has(url)) cache.set(url, fetch(`http://127.0.0.1:3461${url}`).then(async r => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }));
  return cache.get(url)!;
}
async function prepare(art: StockArt, owned: boolean) {
  const s = art.spec;
  if (!s.palette) throw new Error("No resolved palette");
  const palette = remapPalette(decodePal(await bytes(s.palette.url), s.palette.transparent, s.palette.shadow), s.palette.remap, parseHexColor("F21818"));
  if (s.voxel) {
    const v = s.voxel;
    const parts = await Promise.all(v.parts.filter(partVisibleByDefault).map(async p => ({ ...p, turret: p.turretOffset ? { offset: p.turretOffset } : null, vxl: decodeVxl(await bytes(p.vxl)), hva: decodeHva(await bytes(p.hva)) })));
    return (facing: number) => rasterizeUnit({
      parts: poseParts(parts, facing, 0, v.useClassicPerspectiveFudge, v.cameraPitch).map(p => ({ ...p.part, yaw: p.yaw, worldOffset: p.worldOffset, frame: 0 })),
      scale: v.scale, cameraPitch: v.cameraPitch, lightPitch: v.lightPitch, lightYaw: v.lightYaw,
      ambient: v.ambient, diffuse: v.diffuse, palette, normals: v.normals === "TiberianSun" ? TS_NORMALS : RA2_NORMALS,
      shadowColor: [0, 0, 0, 140], altitude: 0,
    });
  }
  const originalRig = spriteRig(art.sprite, "stand");
  const rig = originalRig && owned ? { ...originalRig,
    // Conditional native effects are not part of an owned body audit. They
    // must never be copied into the shareable generated-art contact sheets.
    overlay: originalRig.overlay?.file?.startsWith("/api/art-review/mod/") ? originalRig.overlay : null,
  } : originalRig;
  if (!rig) throw new Error("No resolved stand/idle rig");
  if (owned && rigFiles(rig).some(f => !f.startsWith("/api/art-review/mod/"))) throw new Error("Owned body audit cannot embed native SHP layers");
  const files = new Map(await Promise.all(rigFiles(rig).map(async f => [f, decodeShp(await bytes(f))] as const)));
  const shps = { body: files.get(rig.body.file!)!, turret: rig.turret ? files.get(rig.turret.file!)! : null, overlay: rig.overlay ? files.get(rig.overlay.file!)! : null };
  return (facing: number) => composeRig(rig, shps, palette, { facing, turretFacing: 0, tick: 0, shadow: true });
}
function saveFrame(id: string, facing: number, img: RasterImage) {
  const file = `${id}/f${facing}.rgba`;
  writeFileSync(join(out, file), img.data);
  return { file, facing, width: img.width, height: img.height, anchorX: img.anchorX, anchorY: img.anchorY, sha256: createHash("sha256").update(img.data).digest("hex") };
}
const records = [];
for (const id of ids) {
  const art = payload.stock[id], info = generated.get(id) ?? art?.info;
  if (!art) { records.push({ id, error: "Missing resolved actor" }); continue; }
  const own = generated.has(id);
  mkdirSync(join(out,id), {recursive:true});
  const row: Record<string, unknown> = { id, name: art.spec.name, category: art.spec.category, generated: own,
    factions: payload.factions.filter(f => f.units.some(u => u.id === id)).map(f => f.id), info,
    render: art.spec.render, voxel: art.spec.voxel, sprite: art.sprite, behavior: art.behavior, source: art.behavior.source,
    note: "Measured CPU body projections; ground-level stand/idle. Conditional native effects excluded from owned images. Not a live game or full animation inspection." };
  try {
    const render = await prepare(art, own);
    row.frames = Array.from({length:32},(_,i)=>saveFrame(id,i*32,render(i*32)));
  } catch (e) { row.error = String(e); }
  row.sequenceChecks = await Promise.all((art.sprite?.sequences ?? []).filter(s => s.file?.split("?")[0].endsWith(".shp")).map(async seq => {
    try {
      const shp = decodeShp(await bytes(seq.file!));
      const length = sequenceLength(seq, shp);
      const lookup = seq.length === "*" ? { ...seq, length } : seq;
      const indices = Array.from({ length: seq.facings }, (_, f) => Array.from({ length }, (_, t) => sequenceFrame(lookup, t, f * 1024 / seq.facings))).flat();
      const shadows = seq.shadowStart < 0 ? [] : indices.map(i => i + seq.shadowStart - seq.start);
      const missing = [...indices, ...shadows].filter(i => i === undefined || i < 0 || i >= shp.frames.length);
      return { sequence: seq.name, file: seq.file, availableFrames: shp.frames.length, requiredLastFrame: Math.max(...indices, ...shadows), missingFrames: missing.length, declaredFacings: seq.facings, animationLength: length };
    } catch (e) { return { sequence: seq.name, error: String(e) }; }
  }));
  if (art.spec.cameo) try {
    const icon = `${id}/cameo.png`;
    writeFileSync(join(out,icon), await bytes(art.spec.cameo));
    row.cameo = icon;
  } catch (e) { row.cameoError=String(e); }
  records.push(row);
  console.log(`${own ? "generated" : "local reference"} ${id}: ${row.error ?? "32 projections"}`);
}
writeFileSync(join(out,"renders.json"), JSON.stringify({schemaVersion:1, mode:"ra2", house:"F21818", commits:{mod:execFileSync("git",["rev-parse","HEAD"],{cwd:resolve("../RTSAI-Mod"),encoding:"utf8"}).trim(),web:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()}, records},null,2));
console.log(JSON.stringify({generated:generated.size,references:ids.size-generated.size,errors:records.filter(r=>"error" in r).length}));
