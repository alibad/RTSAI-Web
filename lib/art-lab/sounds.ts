/**
 * What an actor sounds like, resolved from the mod's rules the way the engine plays them (OpenRA SoundInfo):
 * Voiced.VoiceSet -> the Voices files' set (Inherits, Prefixes per faction, DefaultVariant) -> one file per clip;
 * Armament weapons -> Report and their warheads' ImpactSounds; DeathSounds (voice categories), FireWarheadsOnDeath
 * (the death explosion's warheads), SoundOnDamageTransition, deploy, transform, take-off and reload sounds.
 *
 * Files named through the mod's package ("ra2|modern-factions/audio/x") are the project's own, licensed audio.
 * Bare names ("igidia.wav") are original Red Alert 2 sounds from the player's own audio.bag: those are only ever
 * read through the private local originals cache, never published.
 */
import { child, childValue, mergeMiniYaml, parseMiniYaml, traits, type Yaml, type YamlNode } from "./miniyaml";
import { packagePath, type ModData, type ModReader } from "./resolve";

export type SoundOrigin = "project" | "original";
export type SoundFile = {
  /** The clip as the rules name it (without faction prefix or variant). */
  clip: string;
  /** The file the engine loads: a mod path for project audio, a bare name for original audio. */
  file: string;
  origin: SoundOrigin;
};
export type SoundKind = "voice" | "weapon" | "impact" | "death" | "deploy" | "movement" | "damage" | "notification" | "music";
export type SoundGroup = { id: string; label: string; kind: SoundKind; trait: string; files: SoundFile[]; note?: string;
  /** False for a voice-set category this actor's rules never play (a vehicle's inherited infantry death cries). */
  played: boolean };
export type ActorSounds = { actor: string; faction: string | null; voiceSet: string | null; groups: SoundGroup[]; voiceOptions?: { family: string; selected: string; preferences: string[]; review: "human-listening-pending" } };

export type AudioData = { voices: Map<string, Yaml>; notifications: Map<string, Yaml>; music: YamlNode[] };

const list = (value: string | null | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const manifestList = (manifest: Yaml, key: string) => (child(manifest, key)?.value.nodes ?? []).map(n => n.key);

/** The Voices, Notifications and Music files mod.yaml lists, merged like the engine merges them. */
export function loadAudioData(reader: ModReader, data: Pick<ModData, "manifest">): AudioData {
  const load = (key: string) => mergeMiniYaml(manifestList(data.manifest, key).flatMap(ref => {
    const { path } = packagePath(ref);
    return path && reader.exists(path) ? [parseMiniYaml(reader.text(path), ref)] : [];
  }));
  const map = (nodes: YamlNode[]) => new Map(nodes.map(n => [n.key.toLowerCase(), n.value]));
  return { voices: map(load("Voices")), notifications: map(load("Notifications")), music: load("Music") };
}

/** A sound name as a file: the mod's package prefix becomes a mod path; anything else is RA2 game data. */
export function soundFile(name: string): SoundFile {
  const clip = name.trim();
  const { path } = packagePath(clip);
  if (path) return { clip, file: path, origin: "project" };
  return { clip, file: clip.toLowerCase(), origin: "original" };
}

/** Prefix and variant for one category of a SoundInfo node (voice set or Speech/Sounds notifications). */
function soundNaming(info: Yaml, faction: string | null, category: string) {
  const disabled = (key: string) => new Set([...list(childValue(info, key)), ...list(childValue(child(info, "Voices")?.value, key)), ...list(childValue(child(info, "Notifications")?.value, key))]);
  const prefixes = child(info, "Prefixes")?.value, variants = child(info, "Variants")?.value;
  const prefix = faction && !disabled("DisablePrefixes").has(category) ? childValue(prefixes, faction) ?? childValue(info, "DefaultPrefix") ?? "" : childValue(info, "DefaultPrefix") ?? "";
  const variant = faction && !disabled("DisableVariants").has(category) ? childValue(variants, faction) ?? childValue(info, "DefaultVariant") ?? ".aud" : childValue(info, "DefaultVariant") ?? ".aud";
  return { prefix, variant };
}
const CONFIG_KEYS = new Set(["DisablePrefixes", "DisableVariants"]);

/** Every category of a voice set (Select, Move, Attack, Die, ...) as files, for this faction. */
export function voiceSetFiles(audio: AudioData, voiceSet: string, faction: string | null): { category: string; files: SoundFile[] }[] {
  const info = audio.voices.get(voiceSet.toLowerCase());
  if (!info) return [];
  return (child(info, "Voices")?.value.nodes ?? []).filter(n => !CONFIG_KEYS.has(n.key)).map(n => {
    const { prefix, variant } = soundNaming(info, faction, n.key);
    return { category: n.key, files: list(n.value.value).map(clip => ({ ...soundFile(`${prefix}${clip}${variant}`), clip })) };
  });
}

const VOICE_LABELS: Record<string, string> = { Select: "Selected", Move: "Move order", Attack: "Attack order", Action: "Action", Feedback: "Feedback", Die: "Death", Zapped: "Death · electrocuted", Burned: "Death · burned", Melted: "Death · radiation", PsyCrush: "Death · psychic", Build: "Built", Unload: "Unload", Deploy: "Deploy" };

/** A weapon's fire (Report, StartBurstReport, AfterFireSound) and its warheads' impact sounds. */
export function weaponSounds(data: ModData, weapon: string) {
  const w = data.weapons?.get(weapon.toLowerCase());
  if (!w) return { report: [] as SoundFile[], impact: [] as SoundFile[] };
  const report = [...list(childValue(w, "Report")), ...list(childValue(w, "StartBurstReport")), ...list(childValue(w, "AfterFireSound"))].map(n => soundFile(n));
  const impact = w.nodes.filter(n => n.key.split("@")[0] === "Warhead").flatMap(n => list(childValue(n.value, "ImpactSounds")).map(s => soundFile(s)));
  return { report, impact };
}
const unique = (files: SoundFile[]) => [...new Map(files.map(f => [f.file, f])).values()];

/** Every sound an actor plays, grouped by when it plays. `faction` picks faction prefixes (engineer voices). */
export function actorSounds(data: ModData, audio: AudioData, actorId: string, faction: string | null, voiceLanguage?: "faction" | "en"): ActorSounds {
  const actor = data.rules.get(actorId.toLowerCase());
  const out: ActorSounds = { actor: actorId, faction, voiceSet: null, groups: [] };
  if (!actor) return out;
  const customVoiced = traits(actor, "RTSAIVoiced")[0];
  const voiced = customVoiced ?? traits(actor, "Voiced")[0];
  const family = voiced ? childValue(voiced[1].value, "VoiceSet") : null;
  const selected = family && voiceLanguage ? `${family.toLowerCase()}__${voiceLanguage}` : null;
  const voiceSet = selected && audio.voices.has(selected) ? selected : family;
  if (customVoiced && family) out.voiceOptions = { family, selected: voiceSet!, preferences: ["faction", "en"].filter(value => audio.voices.has(`${family.toLowerCase()}__${value}`)), review: "human-listening-pending" };
  out.voiceSet = voiceSet;
  const voices = voiceSet ? voiceSetFiles(audio, voiceSet, faction) : [];
  const deathCategories = new Set<string>();
  for (const [, node] of traits(actor, "DeathSounds")) deathCategories.add(childValue(node.value, "Voice") ?? "Die");
  // Orders and selection play through Voiced; death categories only through a DeathSounds trait that names them.
  const ORDER = ["Select", "Move", "Attack", "Action", "Feedback", "Build", "Deploy", "Unload", "Die", "Burned", "Zapped", "Melted", "PsyCrush"];
  const rank = (c: string) => { const i = ORDER.indexOf(c); return i < 0 ? ORDER.length : i; };
  for (const v of [...voices].sort((a, b) => rank(a.category) - rank(b.category))) {
    if (!v.files.length) continue;
    const deathLike = /^(Die|Zapped|Burned|Melted|PsyCrush)$/.test(v.category) || deathCategories.has(v.category);
    const played = deathLike ? deathCategories.has(v.category) : true;
    out.groups.push({ id: `voice:${v.category}`, label: VOICE_LABELS[v.category] ?? v.category, kind: deathLike ? "death" : "voice", trait: `${customVoiced ? "RTSAIVoiced" : "Voiced"} (${voiceSet}) · ${v.category}`, files: v.files, played,
      ...(played ? {} : { note: "In the voice set, but this actor's rules never play it (no DeathSounds for it)." }) });
  }
  const reports: SoundFile[] = [], impacts: SoundFile[] = [];
  for (const [, node] of traits(actor, "Armament")) {
    const weapon = childValue(node.value, "Weapon");
    if (!weapon) continue;
    const s = weaponSounds(data, weapon);
    reports.push(...s.report); impacts.push(...s.impact);
  }
  if (reports.length) out.groups.push({ id: "weapon:report", label: "Weapon fire", kind: "weapon", trait: "Armament · Report", files: unique(reports), played: true });
  if (impacts.length) out.groups.push({ id: "weapon:impact", label: "Impact", kind: "impact", trait: "Armament · Warhead ImpactSounds", files: unique(impacts), played: true });
  const explosion: SoundFile[] = [];
  for (const [, node] of traits(actor, "FireWarheadsOnDeath")) {
    for (const key of ["Weapon", "EmptyWeapon"]) { const w = childValue(node.value, key); if (w) explosion.push(...weaponSounds(data, w).impact); }
  }
  if (explosion.length) out.groups.push({ id: "death:explosion", label: "Destroyed · explosion", kind: "death", trait: "FireWarheadsOnDeath", files: unique(explosion), played: true });
  for (const [, node] of traits(actor, "SoundOnDamageTransition")) {
    const damaged = list(childValue(node.value, "DamagedSounds")).map(s => soundFile(s));
    const destroyed = list(childValue(node.value, "DestroyedSounds")).map(s => soundFile(s));
    if (damaged.length) out.groups.push({ id: "damage:damaged", label: "Badly damaged", kind: "damage", trait: "SoundOnDamageTransition", files: damaged, played: true });
    if (destroyed.length) out.groups.push({ id: "damage:destroyed", label: "Destroyed", kind: "death", trait: "SoundOnDamageTransition", files: destroyed, played: true });
  }
  const traitSounds: [string, string, string, SoundKind][] = [
    ["GrantConditionOnDeploy", "DeploySounds", "Deploy", "deploy"], ["GrantConditionOnDeploy", "UndeploySounds", "Undeploy", "deploy"],
    ["Transforms", "TransformSounds", "Transform", "deploy"], ["Aircraft", "TakeoffSounds", "Take-off", "movement"],
    ["Aircraft", "LandingSounds", "Landing", "movement"], ["ReloadAmmoPool", "Sound", "Reload", "weapon"], ["AmbientSound", "SoundFiles", "Ambient", "movement"],
  ];
  for (const [trait, key, label, kind] of traitSounds) {
    const files = unique(traits(actor, trait).flatMap(([, node]) => list(childValue(node.value, key)).map(s => soundFile(s))));
    if (files.length) out.groups.push({ id: `${trait}:${key}`, label, kind, trait: `${trait} · ${key}`, files, played: true });
  }
  return out;
}

/** A faction's announcer: every Speech notification as the faction hears it (its prefix, else the default). */
export function factionSpeech(audio: AudioData, faction: string): { notification: string; files: SoundFile[] }[] {
  const speech = audio.notifications.get("speech");
  if (!speech) return [];
  return (child(speech, "Notifications")?.value.nodes ?? []).filter(n => !CONFIG_KEYS.has(n.key)).map(n => {
    const { prefix, variant } = soundNaming(speech, faction, n.key);
    return { notification: n.key, files: list(n.value.value).map(clip => ({ ...soundFile(`${prefix}${clip}${variant}`), clip })) };
  });
}

/** The music the mod lists (title and file). */
export function musicTracks(audio: AudioData): { id: string; title: string; file: SoundFile }[] {
  return audio.music.map(n => {
    const ext = childValue(n.value, "Extension") ?? "aud";
    return { id: n.key, title: n.value.value ?? n.key, file: soundFile(`${childValue(n.value, "Filename") ?? n.key}.${ext}`) };
  });
}
