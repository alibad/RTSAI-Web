/**
 * A Concept Forge draft as the Faction viewer's stage draws any game unit. RTSAI-Art tools/forge/forge_export.py
 * writes every concept in the game's own sprite format (indexed PNG sheets with OpenRA sequence names, one palette per
 * faction, player colour on 16-31) and its weapons as game rules, so the stage, the frame store and the Attack demo
 * need nothing of their own for concepts: this only turns the drafts' file paths into URLs, fits the turret's offset
 * and picks the sounds. Client-safe.
 */
import type { StageItem } from "../art/review/frames";
import type { PaletteSpec, RenderSpec } from "../../../lib/art-lab/spec";
import type { ArtCategory, SpriteArt, SpriteSequence, Vec3 } from "../../../lib/art-lab/types";
import { localToWorld, rotateYaw, screenVector } from "../../../lib/art-lab/voxel-math";
import { demoWeapons, type DemoWeapon, type RulesWeapon } from "../../../lib/weapon-demo";

export const API = "/api/concept-forge";
export const forgeFile = (path: string) => `${API}/file/${path.split("/").map(encodeURIComponent).join("/")}`;

export type ConceptWeapon = RulesWeapon & { label: string; report: string | null; impact: string | null };
/** art.json (forge_export.py). */
export type ConceptArt = {
  id: string; name: string; kind: "infantry" | "vehicle" | "defence"; category: ArtCategory; health: number; armor: string;
  sequences: SpriteSequence[]; turret: { sequence: string; name: string; initialFacing: number } | null;
  /** The turret's pivot over the body, screen px at 1x: one per body facing (32), or one for a defence. */
  pivots: [number, number][] | null; turretLocked: boolean; airAltitude: number | null;
  weapons: ConceptWeapon[]; sounds: Record<string, string>;
};
/** game.json: the faction palettes and the palette layout every concept shares. */
export type ConceptGame = { palettes: Record<string, string>; transparent: number[]; shadow: number[]; remap: number[] };
export type VoiceSet = Record<"action" | "attack" | "move" | "select", string[]>;
export type Voices = Record<string, { inf?: VoiceSet; veh?: VoiceSet }>;

/** Solves the small normal equations of the turret fit (Gaussian elimination with pivoting). */
function solve(a: number[][], b: number[]) {
  const n = b.length, m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    const p = m.reduce((best, row, r) => (r >= c && Math.abs(row[c]) > Math.abs(m[best][c]) ? r : best), c);
    [m[c], m[p]] = [m[p], m[c]];
    if (Math.abs(m[c][c]) < 1e-9) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const k = m[r][c] / m[c][c]; for (let k2 = c; k2 <= n; k2++) m[r][k2] -= k * m[c][k2]; }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-9 ? 0 : row[n] / row[i]));
}

/**
 * Turreted.Offset (world units, body space) whose screen position matches the Forge's turret pivots under the same
 * projection the stage draws turrets with (sprite-compose.ts turretScreenOffset). A least-squares fit over every body
 * facing; a defence has one pivot and no forward axis to fit.
 */
export function fitTurretOffset(pivots: [number, number][] | null, turns: boolean): Vec3 {
  if (!pivots?.length) return [0, 0, 0];
  const S = 1024;
  const axes: Vec3[] = turns ? [[S, 0, 0], [0, S, 0], [0, 0, S]] : [[0, S, 0], [0, 0, S]];
  const rows: number[][] = [], rhs: number[] = [];
  pivots.forEach(([x, y], f) => {
    const facing = turns ? Math.round((f * 1024) / pivots.length) : 0;
    const response = axes.map(v => screenVector(localToWorld(rotateYaw(v, facing), false, 85)));
    rows.push(response.map(r => r[0] / S)); rhs.push(x);
    rows.push(response.map(r => r[1] / S)); rhs.push(y);
  });
  const n = axes.length, a = Array.from({ length: n }, () => Array<number>(n).fill(0)), b = Array<number>(n).fill(0);
  rows.forEach((r, i) => { for (let p = 0; p < n; p++) { b[p] += r[p] * rhs[i]; for (let q = 0; q < n; q++) a[p][q] += r[p] * r[q]; } });
  const x = solve(a, b).map(v => Math.round(v * S) / S);
  return (turns ? x : [0, x[0], x[1]]).map(Math.round) as Vec3;
}

/** The concept in one faction's paint, as a stage item (palette per faction; the player colour is the stage's). */
export function conceptItem(art: ConceptArt, game: ConceptGame, faction: string): StageItem {
  const fac = game.palettes[faction] ? faction : Object.keys(game.palettes)[0];
  const sequences = art.sequences.map(s => ({ ...s, file: s.file ? forgeFile(`concepts/${art.id}/${s.file}`) : null }));
  const pick = (name: string) => sequences.find(s => s.name === name) ?? null;
  const turns = art.kind !== "defence";
  const sprite: SpriteArt = {
    image: art.id, palette: `forge-${fac}`, shp: null, sequences, quantizedFacings: null,
    turret: art.turret ? { ...art.turret, offset: fitTurretOffset(art.pivots, turns) } : null,
  };
  const palette: PaletteSpec = { name: `forge-${fac}`, url: forgeFile(game.palettes[fac]), remap: game.remap, transparent: game.transparent, shadow: game.shadow };
  const spec: RenderSpec = {
    id: `forge-${art.id}`, factionId: fac, name: art.name, category: art.category, render: "sprite",
    airAltitude: art.airAltitude, cameo: null, palette, voxel: null,
    sprite: { stand: pick("stand") ?? pick("idle"), turret: art.turret ? pick(art.turret.sequence) : null, turretInitialFacing: art.turret?.initialFacing ?? null, overlay: null, overlays: [] },
  };
  return { key: `forge:${art.id}:${fac}`, spec, sprite, fire: null };
}

/** The Attack demo's armaments, chosen exactly as for a game unit (weapon-demo.ts), with the concept's own names. */
export function conceptWeapons(art: ConceptArt): DemoWeapon[] {
  const label = new Map(art.weapons.map(w => [w.id.toLowerCase(), w.label]));
  return demoWeapons(art.weapons).map(w => ({ ...w, label: label.get(w.id.toLowerCase()) ?? w.label }));
}

/** Each weapon's report and impact, from the Forge's sound cues. */
export function conceptSounds(art: ConceptArt) {
  return (weaponId: string) => {
    const w = art.weapons.find(x => x.id.toLowerCase() === weaponId.toLowerCase());
    return { report: w?.report ? [forgeFile(`sounds/${w.report}.ogg`)] : [], impact: w?.impact ? [forgeFile(`sounds/${w.impact}.ogg`)] : [] };
  };
}

/** What a stage action sounds like: the faction's voice line for it, else the concept's own cue (build, engine, death). */
export function actionSounds(art: ConceptArt, voices: Voices | undefined, faction: string, action: string): string[] {
  const set = voices?.[faction]?.[art.kind === "infantry" ? "inf" : "veh"];
  const cue = (name: string | undefined) => (name ? [forgeFile(`sounds/${name}.ogg`)] : []);
  if (action === "make") return cue(art.sounds.build);
  if (/^(die|dead|husk)/.test(action)) return cue(art.sounds.die);
  const line = /move|run/.test(action) ? set?.move : /attack|shoot|fire/.test(action) ? set?.attack : set?.select;
  return (line ?? []).map(forgeFile).concat(line?.length ? [] : cue(art.sounds.select));
}
