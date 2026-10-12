/**
 * Resolves what the game actually draws for each modern-faction actor, from the mod's own manifest,
 * rules, sequences, model sequences and Fluent messages, using OpenRA's MiniYaml merge semantics.
 * Pure: all file access goes through a ModReader, so tests can run it on fixtures.
 */
import { decodeHva } from "./hva";
import { child, childValue, mergeMiniYaml, parseMiniYaml, traits, type Yaml, type YamlNode } from "./miniyaml";
import { parseFluent } from "./fluent";
import { checkVxl, decodeVxl } from "./vxl";
import { decodeShp } from "./shp";
import type {
  ActorArt, ArmamentRef, ArtCategory, ExternalRef, FactionArt, PaletteRef, SpriteArt, SpriteSequence, Vec3,
  VoxelArt, VoxelModelRef, VoxelPart,
} from "./types";

export type ModReader = {
  /** Paths are relative to the mod repository root, with forward slashes. */
  text(path: string): string;
  bytes(path: string): Uint8Array;
  exists(path: string): boolean;
};

/**
 * Optional access to original RA2 files (dev-only Review, never the public sync): `record` returns a key for a
 * bare RA2 filename such as `gi.shp` when the file is available locally, else null; `bytes` reads it.
 */
export type Ra2Hook = { record(name: string): string | null; bytes(name: string): Uint8Array };

export const MODERN_FACTIONS = ["china", "iran", "turkey", "saudi", "yemen", "israel", "hezbollah"] as const;
export const MOD_DIR = "mods/rtsai";
/** The optional add-on that plays the original countries with the player's own RA2 files (`classic|` package). */
export const CLASSIC_DIR = "mods/rtsai-classic";
export const ART_DIR = `${MOD_DIR}/modern-factions`;

/** `ra2|modern-factions/voxels/r2qilin` -> mod path, or null when the file lives in a package the mod does not own. */
export function packagePath(ref: string): { path: string | null; reason: string | null } {
  const bar = ref.indexOf("|");
  if (bar < 0) return { path: null, reason: "RA2 game data (mounted from the player's installed RA2 content)" };
  const pkg = ref.slice(0, bar);
  const rest = ref.slice(bar + 1);
  if (pkg === "ra2") return { path: `${MOD_DIR}/${rest}`, reason: null };
  if (pkg === "classic") return { path: `${CLASSIC_DIR}/${rest}`, reason: null };
  if (pkg === "ra") return { path: `mods/ra/${rest}`, reason: null };
  if (pkg === "common") return { path: `engine/mods/common/${rest}`, reason: null };
  return { path: null, reason: `package ${pkg}| (RA2 game data or engine content)` };
}

/** Provenance keys are relative to modern-factions; anything else is not modern-faction art. */
export function provenanceKey(modPath: string) {
  const prefix = `${ART_DIR}/`;
  return modPath.startsWith(prefix) ? modPath.slice(prefix.length) : null;
}

const num = (value: string | null | undefined, fallback: number) => {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const v = Number(value.trim());
  return Number.isFinite(v) ? v : fallback;
};
const bool = (value: string | null | undefined, fallback: boolean) => (value === null || value === undefined ? fallback : /^true$/i.test(value.trim()));
const list = (value: string | null | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
export function parseWDist(value: string | null | undefined, fallback = 0) {
  if (!value) return fallback;
  const m = /^(-?)(\d+)c(\d+)$/.exec(value.trim());
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 1024 + Number(m[3]));
  return num(value, fallback);
}
export function parseVec3(value: string | null | undefined, fallback: Vec3 = [0, 0, 0]): Vec3 {
  const parts = list(value).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : fallback;
}
function parseVec3List(value: string | null | undefined): Vec3[] {
  const parts = list(value).map(Number);
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < parts.length; i += 3) out.push([parts[i], parts[i + 1], parts[i + 2]]);
  return out;
}
const floats3 = (value: string | null | undefined, fallback: Vec3): Vec3 => {
  const parts = list(value).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? [parts[0], parts[1], parts[2]] : fallback;
};

export type ModData = {
  manifest: Yaml;
  rules: Map<string, Yaml>;
  ruleKeys: Map<string, string>;
  sequences: Map<string, Yaml>;
  rawSequenceKeys: Map<string, Set<string>>;
  modelSequences: Map<string, Yaml>;
  messages: Map<string, string>;
  ruleSources: Map<string, string>;
  weapons?: Map<string, Yaml>;
};

function manifestList(manifest: Yaml, key: string) {
  return (child(manifest, key)?.value.nodes ?? []).map(n => n.key);
}

export function loadModData(reader: ModReader, options: { manifestPath?: string; resolvePackage?: typeof packagePath; extra?: Partial<Record<"Rules" | "Sequences" | "Weapons", string[]>> } = {}): ModData {
  const manifestNodes = parseMiniYaml(reader.text(options.manifestPath ?? `${MOD_DIR}/mod.yaml`), "mod.yaml");
  const manifest: Yaml = { value: null, nodes: manifestNodes };
  const resolvePackage = options.resolvePackage ?? packagePath;
  const load = (refs: string[]) => [...new Set(refs)].map(ref => {
    const { path } = resolvePackage(ref);
    if (!path || !reader.exists(path)) throw new Error(`mod.yaml lists ${ref}, which is not in the mod checkout`);
    return { ref, path, nodes: parseMiniYaml(reader.text(path), ref) };
  });
  const toMap = (nodes: YamlNode[], lower: boolean) => new Map(nodes.map(n => [lower ? n.key.toLowerCase() : n.key, n.value]));

  const ruleFiles = load([...manifestList(manifest, "Rules"), ...(options.extra?.Rules ?? [])]);
  const mergedRules = mergeMiniYaml(ruleFiles.map(f => f.nodes));
  const rules = toMap(mergedRules, true);
  const ruleKeys = new Map(mergedRules.map(n => [n.key.toLowerCase(), n.key]));
  const ruleSources = new Map<string, string>();
  for (const file of ruleFiles) for (const n of file.nodes) if (!ruleSources.has(n.key.toLowerCase())) ruleSources.set(n.key.toLowerCase(), file.path);

  const sequenceFiles = load([...manifestList(manifest, "Sequences"), ...(options.extra?.Sequences ?? [])]);
  const sequences = toMap(mergeMiniYaml(sequenceFiles.map(f => f.nodes)), false);
  const rawSequenceKeys = new Map<string, Set<string>>();
  for (const file of sequenceFiles) for (const image of file.nodes) {
    const keys = rawSequenceKeys.get(image.key) ?? new Set<string>();
    for (const s of image.value.nodes) if (!s.key.startsWith("Inherits")) keys.add(s.key);
    rawSequenceKeys.set(image.key, keys);
  }
  const modelSequences = toMap(mergeMiniYaml(load(manifestList(manifest, "ModelSequences")).map(f => f.nodes)), true);
  const weapons = toMap(mergeMiniYaml(load([...manifestList(manifest, "Weapons"), ...(options.extra?.Weapons ?? [])]).map(f => f.nodes)), true);

  const messages = new Map<string, string>();
  for (const ref of manifestList(manifest, "FluentMessages")) {
    const { path } = resolvePackage(ref);
    if (path && reader.exists(path)) parseFluent(reader.text(path), messages);
  }
  return { manifest, rules, ruleKeys, sequences, rawSequenceKeys, modelSequences, messages, ruleSources, weapons };
}

type FileUse = { modPath: string; key: string };

export type Resolution = {
  factions: FactionArt[];
  actors: Record<string, Omit<ActorArt, "generator" | "catalogUnitId">>;
  palettes: Record<string, PaletteRef>;
  /** Every file under modern-factions the resolved art reads. */
  files: Map<string, FileUse>;
  presetColors: string[];
  shadowColor: [number, number, number, number];
};

const FACTION_ACCENTS: Record<string, string> = { china: "#cb4c3b", iran: "#3f9a5b", turkey: "#d9473f", saudi: "#2e8b57", yemen: "#b8873b", israel: "#80b8ff", hezbollah: "#b3b881" };

export function resolveArtLab(reader: ModReader, data: ModData): Resolution {
  const files = new Map<string, FileUse>();
  const recordFile = (modPath: string) => {
    const key = provenanceKey(modPath);
    if (!key) throw new Error(`Internal: ${modPath} is outside modern-factions`);
    files.set(key, { modPath, key });
    return key;
  };
  const world = data.rules.get("world");
  if (!world) throw new Error("No World actor in the merged rules");

  // Palettes defined on the World actor.
  const palettes: Record<string, PaletteRef> = {};
  for (const [instance, node] of traits(world, "PaletteFromFile")) {
    const name = childValue(node.value, "Name") ?? instance;
    const filename = childValue(node.value, "Filename");
    if (!filename || childValue(node.value, "Tileset")) continue;
    const { path } = packagePath(filename);
    const key = path ? provenanceKey(path) : null;
    if (!key) continue;
    palettes[name] = {
      name, file: key, remap: [], basePalette: null,
      transparent: child(node.value, "TransparentIndex") ? list(childValue(node.value, "TransparentIndex")).map(Number) : [0],
      shadow: list(childValue(node.value, "ShadowIndex")).map(Number),
      definedBy: `World PaletteFromFile@${instance}`,
    };
  }
  for (const [instance, node] of traits(world, "PlayerColorPalette")) {
    const base = childValue(node.value, "BasePalette");
    const name = childValue(node.value, "BaseName") ?? "player";
    if (!base || !palettes[base]) continue;
    palettes[name] = { ...palettes[base], name, basePalette: base, remap: list(childValue(node.value, "RemapIndex")).map(Number), definedBy: `World PlayerColorPalette${instance ? "@" + instance : ""}` };
  }
  const shadowRgba = traits(world, "PaletteFromRGBA").map(([, n]) => n).find(n => childValue(n.value, "Name") === "shadow");
  const shadowColor: [number, number, number, number] = shadowRgba
    ? [num(childValue(shadowRgba.value, "R"), 0), num(childValue(shadowRgba.value, "G"), 0), num(childValue(shadowRgba.value, "B"), 0), num(childValue(shadowRgba.value, "A"), 255)]
    : [0, 0, 0, 140];
  const normalsTypes = new Map(traits(world, "VoxelNormalsPalette").map(([, n]) => [childValue(n.value, "Name") ?? "normals", (childValue(n.value, "Type") ?? "TiberianSun") as "RedAlert2" | "TiberianSun"]));
  const presetColors = list(childValue(child(world, "ColorPickerManager")?.value, "PresetColors"));

  const factions: FactionArt[] = MODERN_FACTIONS.map(id => {
    const trait = traits(world, "Faction").map(([, n]) => n).find(n => childValue(n.value, "InternalName") === id);
    if (!trait) throw new Error(`World has no Faction with InternalName ${id}`);
    return {
      id, catalogId: null, name: data.messages.get(childValue(trait.value, "Name") ?? "") ?? id,
      side: childValue(trait.value, "Side") ?? "", accent: FACTION_ACCENTS[id], actors: [],
    };
  });

  const actors: Resolution["actors"] = {};
  for (const [name, actor] of data.rules) {
    if (name.startsWith("^")) continue;
    const buildable = child(actor, "Buildable")?.value;
    if (!buildable) continue;
    const prereqs = list(childValue(buildable, "Prerequisites"));
    const faction = factions.find(f => prereqs.includes(`~faction.${f.id}`));
    if (!faction) continue;
    const art = resolveActor(reader, data, name, actor, faction.id, { palettes, normalsTypes, recordFile });
    actors[name] = art;
    faction.actors.push(name);
  }
  for (const faction of factions) {
    const order: ArtCategory[] = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];
    faction.actors.sort((a, b) => order.indexOf(actors[a].category) - order.indexOf(actors[b].category) || actors[a].buildPaletteOrder - actors[b].buildPaletteOrder || a.localeCompare(b));
  }
  for (const p of Object.values(palettes)) if (p.file) recordFile(`${ART_DIR}/${p.file}`);
  return { factions, actors, palettes: Object.fromEntries(Object.entries(palettes).filter(([, p]) => p.file)), files, presetColors, shadowColor };
}

type ResolvedActor = Omit<ActorArt, "generator" | "catalogUnitId">;

/** How one actor is drawn: palettes in scope, where its files are recorded, and (Review only) RA2 file access. */
export type ActorContext = {
  palettes: Record<string, PaletteRef>;
  normalsTypes: Map<string, "RedAlert2" | "TiberianSun">;
  recordFile: (modPath: string) => string;
  ra2?: Ra2Hook;
};

/** Resolves one buildable actor's art (cameo, voxel parts or sprite sequences) the way the game draws it. */
export function resolveActor(reader: ModReader, data: ModData, name: string, actor: Yaml, factionId: string | null, ctx: ActorContext): ResolvedActor {
  const { palettes, normalsTypes, recordFile, ra2 } = ctx;
  const buildable = child(actor, "Buildable")?.value;

  const message = (key: string | null) => (key ? data.messages.get(key) ?? key : "");
  const tooltip = child(actor, "Tooltip")?.value;
  const queue = list(childValue(buildable, "Queue"));
  const category = categorize(actor, queue);
  const strategic = child(actor, "StrategicRole")?.value;
  const renderSprites = child(actor, "RenderSprites")?.value;
  const factionImages = child(renderSprites, "FactionImages")?.value;
  const spriteImage = ((factionId ? childValue(factionImages, factionId) : null) ?? childValue(renderSprites, "Image") ?? name).toLowerCase();

  // Cameo: Buildable.Icon sequence of the sprite image.
  const iconSequence = childValue(buildable, "Icon") ?? "icon";
  const cameoRef = sequenceFile(data, spriteImage, iconSequence);
  const cameo = { sequence: iconSequence, file: null as string | null, external: null as ExternalRef | null };
  const ra2Cameo = ra2 && cameoRef.ref ? ra2.record(cameoRef.ref.toLowerCase()) : null;
  if (cameoRef.path && provenanceKey(cameoRef.path)) cameo.file = recordFile(cameoRef.path);
  else if (ra2Cameo) cameo.file = ra2Cameo;
  else cameo.external = { ref: cameoRef.ref ?? `${spriteImage}.${iconSequence}`, reason: cameoRef.reason ?? "not modern-faction art" };

  const renderVoxels = child(actor, "RenderVoxels")?.value;
  const voxel = renderVoxels ? resolveVoxel(reader, data, actor, renderVoxels, name, palettes, normalsTypes, recordFile, ra2) : null;
  const sprite = !renderVoxels ? resolveSprite(reader, data, actor, spriteImage, renderSprites, recordFile, ra2) : null;

  const art: ResolvedActor = {
    id: name, factionId: factionId ?? "",
    name: message(childValue(tooltip, "Name")),
    description: message(childValue(buildable, "Description")),
    category, domain: childValue(strategic, "Domain"), roles: list(childValue(strategic, "Roles")),
    queue, buildPaletteOrder: num(childValue(buildable, "BuildPaletteOrder"), 9999),
    cost: child(actor, "Valued") ? num(childValue(child(actor, "Valued")!.value, "Cost"), 0) : null,
    cameo, render: voxel ? "voxel" : "sprite", voxel, sprite,
    files: [], definedIn: data.ruleSources.get(name) ?? "",
  };
  const used = new Set<string>();
  if (cameo.file) used.add(cameo.file);
  voxel?.parts.forEach(p => { if (p.model.vxl) used.add(p.model.vxl); if (p.model.hva) used.add(p.model.hva); });
  voxel?.unusedSequences.forEach(s => { if (s.vxl) { used.add(s.vxl); used.add(s.vxl.replace(/\.vxl$/, ".hva")); } });
  if (voxel) { const p = palettes[voxel.palette]; if (p?.file) used.add(p.file); }
  sprite?.sequences.forEach(s => { if (s.file) used.add(s.file); });
  if (sprite) { const p = palettes[sprite.palette]; if (p?.file) used.add(p.file); }
  art.files = [...used].sort();
  return art;
}

/** Palettes, normals and the shadow colour defined on the World actor (modern-faction files only). */
export function worldNormals(data: ModData) {
  const world = data.rules.get("world");
  return new Map(traits(world!, "VoxelNormalsPalette").map(([, n]) => [childValue(n.value, "Name") ?? "normals", (childValue(n.value, "Type") ?? "TiberianSun") as "RedAlert2" | "TiberianSun"]));
}

export function categorize(actor: Yaml, queue: string[]): ArtCategory {
  if (child(actor, "Building")) return queue.some(q => /support|defen/i.test(q)) ? "defense" : "structure";
  if (child(actor, "Aircraft")) return "aircraft";
  if (queue.includes("Ship") || /naval|submarine/.test(childValue(child(actor, "Mobile")?.value, "Locomotor") ?? "")) return "ship";
  if (queue.includes("Infantry") || child(actor, "WithInfantryBody")) return "infantry";
  return "vehicle";
}

function sequenceFile(data: ModData, image: string, sequence: string): { path: string | null; ref: string | null; reason: string | null } {
  const img = data.sequences.get(image);
  const seq = child(img, sequence)?.value;
  if (!img || !seq) return { path: null, ref: null, reason: `sequence ${image}.${sequence} is not defined` };
  const defaults = child(img, "Defaults")?.value;
  const filename = childValue(seq, "Filename") ?? childValue(defaults, "Filename");
  if (!filename) return { path: null, ref: `${image}.${sequence}`, reason: "no Filename: loaded from RA2 game data by image name" };
  const { path, reason } = packagePath(filename);
  return { path, ref: filename, reason: path && !provenanceKey(path) ? "mod or engine file outside modern-factions (not faction art)" : reason };
}

function describeModel(ref: VoxelModelRef, vxlBytes: Uint8Array, hvaBytes: Uint8Array) {
  const model = decodeVxl(vxlBytes);
  const anim = decodeHva(hvaBytes);
  ref.problems = checkVxl(model);
  if (model.limbCount !== anim.sectionCount) ref.problems.push(`VXL has ${model.limbCount} sections but HVA has ${anim.sectionCount} (OpenRA refuses to load this)`);
  ref.frames = anim.frameCount;
  ref.sections = model.limbs.map(l => {
    let remap = 0;
    for (let i = 0; i < l.colors.length; i++) if (l.filled[i] && l.colors[i] >= 16 && l.colors[i] <= 31) remap++;
    return { name: l.name, scale: l.scale, size: l.size, bounds: l.bounds, normalsMode: l.normalsMode, voxels: l.voxelCount, remapVoxels: remap };
  });
  return ref;
}

function resolveModel(reader: ModReader, data: ModData, image: string, sequence: string, recordFile: (p: string) => string, ra2?: Ra2Hook): VoxelModelRef {
  const ref: VoxelModelRef = { sequence, vxl: null, hva: null, external: null, sections: [], frames: 0, problems: [] };
  const definition = data.modelSequences.get(image);
  const node = child(definition, sequence);
  if (!node) { ref.external = { ref: `${image}.${sequence}`, reason: "model sequence is not defined" }; return ref; }
  const fields = (node.value.value ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const vxlRef = fields[0] ?? image;
  const hvaRef = fields[1] ?? vxlRef;
  const vxl = packagePath(vxlRef);
  const hva = packagePath(hvaRef);
  const vxlKey = vxl.path ? provenanceKey(`${vxl.path}.vxl`) : null;
  const hvaKey = hva.path ? provenanceKey(`${hva.path}.hva`) : null;
  if (!vxlKey || !hvaKey) {
    if (ra2 && !vxlRef.includes("|") && !hvaRef.includes("|")) {
      const vName = `${vxlRef}.vxl`.toLowerCase(), hName = `${hvaRef}.hva`.toLowerCase();
      const vk = ra2.record(vName), hk = ra2.record(hName);
      if (vk && hk) {
        ref.vxl = vk;
        ref.hva = hk;
        return describeModel(ref, ra2.bytes(vName), ra2.bytes(hName));
      }
    }
    ref.external = { ref: `${vxlRef}.vxl`, reason: vxl.reason ?? hva.reason ?? "outside modern-factions" };
    return ref;
  }
  ref.vxl = recordFile(`${vxl.path}.vxl`);
  ref.hva = recordFile(`${hva.path}.hva`);
  return describeModel(ref, reader.bytes(`${vxl.path}.vxl`), reader.bytes(`${hva.path}.hva`));
}

function resolveVoxel(
  reader: ModReader, data: ModData, actor: Yaml, rv: Yaml, name: string, palettes: Record<string, PaletteRef>,
  normalsTypes: Map<string, "RedAlert2" | "TiberianSun">, recordFile: (p: string) => string, ra2?: Ra2Hook,
): VoxelArt {
  const image = (childValue(rv, "Image") ?? name).toLowerCase();
  const body = child(actor, "BodyOrientation")?.value;
  const turreteds = traits(actor, "Turreted").map(([, n]) => ({
    name: childValue(n.value, "Turret") ?? "primary",
    offset: parseVec3(childValue(n.value, "Offset")),
    initialFacing: num(childValue(n.value, "InitialFacing"), 0),
    turnSpeed: num(childValue(n.value, "TurnSpeed"), 512),
    realignDelay: num(childValue(n.value, "RealignDelay"), 40),
  }));
  const armaments: ArmamentRef[] = traits(actor, "Armament").map(([, n]) => ({
    name: childValue(n.value, "Name") ?? "primary",
    weapon: childValue(n.value, "Weapon"),
    turret: childValue(n.value, "Turret") ?? "primary",
    localOffset: parseVec3List(childValue(n.value, "LocalOffset")),
    recoil: parseWDist(childValue(n.value, "Recoil")),
    recoilRecovery: parseWDist(childValue(n.value, "RecoilRecovery"), 9),
    muzzleSequence: childValue(n.value, "MuzzleSequence"),
  }));
  const parts: VoxelPart[] = [];
  const add = (trait: string, instance: string, node: YamlNode, sequence: string, extra: Partial<VoxelPart>) => {
    const label = trait.replace(/^WithVoxel/, "").replace(/Body$/, " body").trim().toLowerCase() || "body";
    parts.push({
      id: `${trait}${instance ? "@" + instance : ""}`, label: instance ? `${label} (${instance})` : label, trait,
      model: resolveModel(reader, data, image, sequence, recordFile, ra2),
      offset: parseVec3(childValue(node.value, "Offset")),
      showShadow: bool(childValue(node.value, "ShowShadow"), true),
      requiresCondition: childValue(node.value, "RequiresCondition"),
      turret: null, barrel: null, tickRate: null, ...extra,
    });
  };
  for (const [instance, node] of traits(actor, "WithVoxelBody")) add("WithVoxelBody", instance, node, childValue(node.value, "Sequence") ?? "idle", {});
  for (const [instance, node] of traits(actor, "WithVoxelHelicopterBody")) add("WithVoxelHelicopterBody", instance, node, childValue(node.value, "Sequence") ?? "idle", { tickRate: num(childValue(node.value, "TickRate"), 5) });
  for (const [instance, node] of traits(actor, "WithVoxelWalkerBody")) add("WithVoxelWalkerBody", instance, node, childValue(node.value, "Sequence") ?? "idle", { tickRate: num(childValue(node.value, "TickRate"), 5) });
  for (const [instance, node] of traits(actor, "WithVoxelUnloadBody")) {
    add("WithVoxelUnloadBody", instance, node, childValue(node.value, "IdleSequence") ?? "idle", {});
    add("WithVoxelUnloadBody", instance ? `${instance}-unload` : "unload", node, childValue(node.value, "UnloadSequence") ?? "unload", { requiresCondition: "unloading" });
  }
  for (const [instance, node] of traits(actor, "WithVoxelTurret")) {
    const turretName = childValue(node.value, "Turret") ?? "primary";
    const t = turreteds.find(x => x.name === turretName) ?? null;
    add("WithVoxelTurret", instance, node, childValue(node.value, "Sequence") ?? "turret", { turret: t, label: instance ? `turret (${instance})` : "turret" });
  }
  for (const [instance, node] of traits(actor, "WithVoxelBarrel")) {
    const armamentName = childValue(node.value, "Armament") ?? "primary";
    const armament = armaments.find(a => a.name === armamentName);
    const t = turreteds.find(x => x.name === (armament?.turret ?? "primary")) ?? null;
    add("WithVoxelBarrel", instance, node, childValue(node.value, "Sequence") ?? "barrel", {
      label: instance ? `barrel (${instance})` : "barrel", turret: t,
      barrel: {
        armament: armamentName, localOffset: parseVec3(childValue(node.value, "LocalOffset")), localOrientation: parseVec3(childValue(node.value, "LocalOrientation")),
        recoil: armament?.recoil ?? 0, recoilRecovery: armament?.recoilRecovery ?? 9,
      },
    });
  }
  const usedSequences = new Set(parts.map(p => p.model.sequence));
  const definition = data.modelSequences.get(image);
  const unusedSequences = (definition?.nodes ?? []).filter(n => !usedSequences.has(n.key)).map(n => {
    const m = resolveModel(reader, data, image, n.key, recordFile, ra2);
    return { sequence: n.key, vxl: m.vxl, external: m.external };
  });
  const playerPalette = childValue(rv, "PlayerPalette") ?? "player";
  const palette = childValue(rv, "Palette") ?? playerPalette;
  const normalsPalette = childValue(rv, "NormalsPalette") ?? "normals";
  const aircraft = child(actor, "Aircraft")?.value;
  return {
    image,
    scale: num(childValue(rv, "Scale"), 12),
    lightPitch: num(childValue(rv, "LightPitch"), 142),
    lightYaw: num(childValue(rv, "LightYaw"), 682),
    ambient: floats3(childValue(rv, "LightAmbientColor"), [0.6, 0.6, 0.6]),
    diffuse: floats3(childValue(rv, "LightDiffuseColor"), [0.4, 0.4, 0.4]),
    palette: palettes[palette] ? palette : palette,
    normals: { palette: normalsPalette, type: normalsTypes.get(normalsPalette) ?? "TiberianSun" },
    shadowPalette: childValue(rv, "ShadowPalette") ?? "shadow",
    cameraPitch: num(childValue(body, "CameraPitch"), 113),
    quantizedFacings: num(childValue(body, "QuantizedFacings"), -1),
    useClassicPerspectiveFudge: bool(childValue(body, "UseClassicPerspectiveFudge"), true),
    parts, unusedSequences, armaments,
    cruiseAltitude: aircraft ? parseWDist(childValue(aircraft, "CruiseAltitude"), 1280) : null,
  };
}

function resolveSprite(reader: ModReader, data: ModData, actor: Yaml, image: string, renderSprites: Yaml | undefined, recordFile: (p: string) => string, ra2?: Ra2Hook): SpriteArt {
  const img = data.sequences.get(image);
  const defaults = child(img, "Defaults")?.value;
  const raw = data.rawSequenceKeys.get(image) ?? new Set<string>();
  const users = new Map<string, string[]>();
  const addUser = (seq: string | null | undefined, by: string) => { if (!seq) return; users.set(seq, [...(users.get(seq) ?? []), by]); };
  const infantry = child(actor, "WithInfantryBody")?.value;
  if (infantry) {
    list(childValue(infantry, "StandSequences") ?? "stand").forEach(s => addUser(s, "WithInfantryBody stand"));
    addUser(childValue(infantry, "MoveSequence") ?? "run", "WithInfantryBody move");
    addUser(childValue(infantry, "DefaultAttackSequence"), "WithInfantryBody attack");
    for(const node of child(infantry,"AttackSequences")?.value.nodes??[])addUser(node.value.value,"WithInfantryBody attack");
    list(childValue(infantry, "IdleSequences")).forEach(s => addUser(s, "WithInfantryBody idle"));
  }
  const deathPrefixes = traits(actor, "WithDeathAnimation").map(([i, n]) => [i, childValue(n.value, "DeathSequence") ?? "die"] as const);
  // WithFacingSpriteBody (a prerendered vehicle's body) is a WithSpriteBody that turns with the actor.
  for (const bodyTrait of ["WithSpriteBody", "WithFacingSpriteBody"]) {
    for (const [instance, node] of traits(actor, bodyTrait)) {
      const seq = childValue(node.value, "Sequence") ?? "idle";
      addUser(seq, `${bodyTrait}${instance ? "@" + instance : ""}`);
      addUser(`damaged-${seq}`, `${bodyTrait}${instance ? "@" + instance : ""} (damaged)`);
      addUser(childValue(node.value, "StartSequence"), `${bodyTrait} start`);
    }
  }
  let turret: SpriteArt["turret"] = null;
  for (const [instance, node] of traits(actor, "WithSpriteTurret")) {
    const seq = childValue(node.value, "Sequence") ?? "turret";
    addUser(seq, `WithSpriteTurret${instance ? "@" + instance : ""}`);
    addUser(`damaged-${seq}`, `WithSpriteTurret (damaged)`);
    const turretName = childValue(node.value, "Turret") ?? "primary";
    const t = traits(actor, "Turreted").map(([, n]) => n).find(n => (childValue(n.value, "Turret") ?? "primary") === turretName);
    turret = { sequence: seq, name: turretName, offset: parseVec3(childValue(t?.value, "Offset")), initialFacing: num(childValue(t?.value, "InitialFacing"), 0) };
  }
  for (const [, node] of traits(actor, "WithMakeAnimation")) addUser(childValue(node.value, "Sequence") ?? "make", "WithMakeAnimation (build-up)");
  const overlays: NonNullable<SpriteArt["overlays"]> = [];
  for (const [trait, fallback, mode] of [["WithIdleOverlay", "idle-overlay", "loop"], ["WithProductionDoorOverlay", "build-door", "door"], ["WithExitOverlay", "exit-overlay", "activity"], ["WithProductionOverlay", "production", "activity"]] as const) {
    for (const [instance, node] of traits(actor, trait)) {
      // An overlay drawing another image (damage smoke and fire: Image: r2fxsmoke) does not use this image's
      // sequences, even when its sequence name matches one ("idle").
      const otherImage = childValue(node.value, "Image");
      if (otherImage && otherImage.toLowerCase() !== image.toLowerCase()) continue;
      const sequence = childValue(node.value, "Sequence") ?? fallback;
      const label = `${trait}${instance ? "@" + instance : ""}`;
      addUser(sequence, label);
      addUser(`damaged-${sequence}`, `${label} (damaged)`);
      overlays.push({ sequence, trait: label, offset: parseVec3(childValue(node.value, "Offset")), requiresCondition: childValue(node.value, "RequiresCondition"), mode });
    }
  }
  addUser(childValue(child(actor, "Buildable")?.value, "Icon") ?? "icon", "Buildable icon (cameo)");

  const field = (seq: Yaml, key: string) => childValue(seq, key) ?? childValue(defaults, key);
  const sequences: SpriteSequence[] = [];
  let shp: SpriteArt["shp"] = null;
  for (const node of img?.nodes ?? []) {
    if (node.key === "Defaults") continue;
    const seq = node.value;
    // The local Studio uses the temperate tileset, just like its player palette.
    // Construction and wall art frequently have only TilesetFilenames.
    const tilesets=child(seq,"TilesetFilenames")?.value??child(defaults,"TilesetFilenames")?.value;
    const filename = childValue(tilesets,"TEMPERATE")??field(seq, "Filename");
    const length = field(seq, "Length");
    let facings = num(field(seq, "Facings"), 1);
    const reverseFacings = facings < 0;
    facings = Math.abs(facings);
    const start = num(field(seq, "Start"), 0);
    const lengthValue = length === "*" ? "*" : num(length, 1);
    const entry: SpriteSequence = {
      name: node.key, file: null, external: null, start, length: lengthValue,
      stride: num(field(seq, "Stride"), typeof lengthValue === "number" ? lengthValue : 0),
      facings, reverseFacings, useClassicFacings: bool(field(seq, "UseClassicFacings"), false), transpose: bool(field(seq, "Transpose"), false), tick: num(field(seq, "Tick"), 40),
      zOffset: parseWDist(field(seq, "ZOffset")), shadowStart: num(field(seq, "ShadowStart"), -1),
      offset: parseVec3(field(seq, "Offset")), frames: field(seq, "Frames") ? list(field(seq, "Frames")).map(Number) : null,
      reverses: bool(field(seq, "Reverses"), false),
      usedBy: [...(users.get(node.key) ?? []), ...deathPrefixes.filter(([, p]) => node.key.startsWith(p)).map(([i]) => `WithDeathAnimation${i ? "@" + i : ""}`)],
      inherited: !raw.has(node.key),
    };
    if (filename) {
      const { path, reason } = packagePath(filename);
      const key = path ? provenanceKey(path) : null;
      if (key) {
        entry.file = recordFile(path!);
        if (/\.shp$/i.test(path!) && !shp) {
          const decoded = decodeShp(reader.bytes(path!));
          shp = { width: decoded.width, height: decoded.height, frames: decoded.frames.length, compression: [...new Set(decoded.frames.map(f => f.compression))].sort() };
        }
      } else {
        const ra2Key = ra2 ? ra2.record(filename.toLowerCase()) : null;
        if (ra2Key) {
          entry.file = ra2Key;
          if (/\.shp$/i.test(filename) && !shp) {
            const decoded = decodeShp(ra2!.bytes(ra2Key));
            shp = { width: decoded.width, height: decoded.height, frames: decoded.frames.length, compression: [...new Set(decoded.frames.map(f => f.compression))].sort() };
          }
        } else entry.external = { ref: filename, reason: reason ?? "mod or engine file outside modern-factions (not faction art)" };
      }
    } else entry.external = { ref: `${image}.${node.key}`, reason: "no Filename: loaded from RA2 game data by image name" };
    sequences.push(entry);
  }
  const playerPalette = childValue(renderSprites, "PlayerPalette") ?? "player";
  const classicBody = child(actor, "ClassicFacingBodyOrientation")?.value;
  const body = classicBody ?? child(actor, "BodyOrientation")?.value;
  return {
    image, palette: childValue(renderSprites, "Palette") ?? playerPalette, shp, sequences,
    quantizedFacings: body && childValue(body, "QuantizedFacings") ? num(childValue(body, "QuantizedFacings"), 0) : null,
    classicFacingBodyOrientation: Boolean(classicBody),
    turret, overlays,
  };
}
