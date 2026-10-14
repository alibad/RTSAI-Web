/**
 * The Sound desk's slots, resolved from the mod's rules the way the standalone game plays them (pure; the dev API
 * passes in the merged rules and a locator for files). Every slot names the files it plays today; a bare name
 * ("igiat1a.wav") is a project stand-in under mods/rtsai/standalone (the standalone build mounts no RA2 content),
 * never an original Westwood file.
 */
import { child, childValue, traits, type Yaml } from "../art-lab/miniyaml";
import type { ModData } from "../art-lab/resolve";
import { factionSpeech, soundFile, voiceSetFiles, weaponSounds, type AudioData, type SoundFile } from "../art-lab/sounds";
import type { DeathSize, SlotKind } from "./model";

export type DeskClip = {
  /** As the rules name it: a mod path ("mods/rtsai/...") or a bare stand-in name ("igiat1a.wav"). */
  ref: string;
  /** The project file the game plays (mod path), or null when nothing in the checkout answers the name. */
  path: string | null;
  name: string;
  /** The candidate id that plays it (`project:<path>`), when it exists. */
  id: string | null;
};
export type DeskLine = { text: string | null; english: string | null; language: string | null; role: string | null; speaker: string | null };
export type DeskSlot = {
  id: string;
  kind: SlotKind;
  group: "voice" | "weapon" | "death" | "other" | "announcer";
  label: string;
  /** A shorter label for chips ("Selected 2", "Fire"). */
  short: string;
  faction: string | null;
  actor: string | null;
  weapon: string | null;
  current: DeskClip[];
  /** Other actors that play the same thing (a voice set's clip, a shared weapon). */
  sharedWith: string[];
  line: DeskLine | null;
  /** How a new take can be made: the faction's announcer chain, the line's own voice generator, or not at all. */
  regen: "eva" | "voice" | null;
  /** Announcer clips: the Speech notifications that play it. */
  notifications?: string[];
  /** Notification slots: the clip id it plays now. */
  clip?: string;
};
export type Locate = (file: SoundFile) => string | null;
export type LineLookup = (path: string) => DeskLine | null;

const VOICE_LABELS: Record<string, string> = { Select: "Selected", Move: "Move", Attack: "Attack", Action: "Action", Feedback: "Under fire", Die: "Death", Zapped: "Death · zapped", Burned: "Death · burned", Melted: "Death · melted", PsyCrush: "Death · psychic", Build: "Built", Unload: "Unload", Deploy: "Deploy" };
const ORDER = ["Select", "Move", "Attack", "Action", "Feedback", "Build", "Deploy", "Unload", "Die", "Burned", "Zapped", "Melted", "PsyCrush"];
const DEATHLIKE = /^(Die|Zapped|Burned|Melted|PsyCrush)$/;
/** Trait sounds a unit plays on its own: [trait, key, label, kind]. */
export const TRAIT_SOUNDS: [string, string, string, SlotKind][] = [
  ["GrantConditionOnDeploy", "DeploySounds", "Deploy", "deploy"], ["GrantConditionOnDeploy", "UndeploySounds", "Undeploy", "deploy"],
  ["Transforms", "TransformSounds", "Transform", "deploy"], ["Aircraft", "TakeoffSounds", "Take-off", "movement"],
  ["Aircraft", "LandingSounds", "Landing", "movement"], ["ReloadAmmoPool", "Sound", "Reload", "reload"], ["AmbientSound", "SoundFiles", "Engine loop", "movement"],
  ["SoundOnDamageTransition", "DamagedSounds", "Badly damaged", "death"], ["SoundOnDamageTransition", "DestroyedSounds", "Destroyed", "death"],
];

const list = (value: string | null | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const uniqueRefs = (files: SoundFile[]) => [...new Map(files.map(f => [f.file, f])).values()];
/** R2QilinCoax -> "Qilin Coax". */
export function weaponLabel(name: string) {
  return name.replace(/^R2/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_-]+/g, " ").trim() || name;
}
const clip = (f: SoundFile, locate: Locate): DeskClip => {
  const path = locate(f);
  return { ref: f.file, path, name: (path ?? f.file).split("/").pop()!, id: path ? `project:${path}` : null };
};

/** The voice set an actor plays (its RTSAIVoiced or Voiced trait), the base set rather than a language variant. */
export function actorVoiceSet(actor: Yaml): string | null {
  const voiced = traits(actor, "RTSAIVoiced")[0] ?? traits(actor, "Voiced")[0];
  return voiced ? childValue(voiced[1].value, "VoiceSet") : null;
}
/** The weapons an actor's Armament traits fire, in rules order. */
export function actorWeapons(actor: Yaml): string[] {
  return [...new Set(traits(actor, "Armament").map(([, n]) => childValue(n.value, "Weapon")).filter((w): w is string => Boolean(w)))];
}
/** The weapons that explode when the actor dies (FireWarheadsOnDeath). */
export function deathWeapons(actor: Yaml): string[] {
  return [...new Set(traits(actor, "FireWarheadsOnDeath").flatMap(([, n]) => ["Weapon", "EmptyWeapon"].map(k => childValue(n.value, k))).filter((w): w is string => Boolean(w)))];
}
/**
 * How the actor's death sounds: its own FireWarheadsOnDeath, or (aircraft) the husk it leaves, whose FallsToEarth
 * explodes when it hits the ground. `owner` is the actor whose rules play it.
 */
export function deathChain(data: ModData, actorId: string): { owner: string; trait: "FireWarheadsOnDeath" | "FallsToEarth"; weapons: string[] } | null {
  const actor = data.rules.get(actorId.toLowerCase());
  if (!actor) return null;
  const own = deathWeapons(actor);
  if (own.length) return { owner: actorId.toLowerCase(), trait: "FireWarheadsOnDeath", weapons: own };
  for (const [, n] of traits(actor, "SpawnActorOnDeath")) {
    const husk = childValue(n.value, "Actor")?.toLowerCase();
    const h = husk ? data.rules.get(husk) : undefined;
    if (!h || !husk) continue;
    const falls = traits(h, "FallsToEarth").map(([, f]) => childValue(f.value, "Explosion")).filter((w): w is string => Boolean(w));
    if (falls.length) return { owner: husk, trait: "FallsToEarth", weapons: [...new Set(falls)] };
    const hw = deathWeapons(h);
    if (hw.length) return { owner: husk, trait: "FireWarheadsOnDeath", weapons: hw };
  }
  return null;
}

/**
 * Every sound slot of one unit: its voice lines (one slot per clip; a clip belongs to the voice set, so it is shared by
 * the units that use the set), each weapon's fire and impact, its death explosion and its other trait sounds.
 */
export function unitSlots(data: ModData, audio: AudioData, actorId: string, faction: string | null, locate: Locate, lineOf: LineLookup, usersOf: (slot: string) => string[] = () => []): DeskSlot[] {
  const id = actorId.toLowerCase();
  const actor = data.rules.get(id);
  if (!actor) return [];
  const out: DeskSlot[] = [];
  const base = { faction, actor: id, weapon: null, sharedWith: [] as string[], line: null, regen: null } as const;
  const voiceSet = actorVoiceSet(actor);
  if (voiceSet) {
    const deathCategories = new Set(traits(actor, "DeathSounds").map(([, n]) => childValue(n.value, "Voice") ?? "Die"));
    const rank = (c: string) => { const i = ORDER.indexOf(c); return i < 0 ? ORDER.length : i; };
    // One slot per clip: a line the set plays for several orders (Move, Attack and Action often share one) is one line.
    const clips = new Map<string, { file: SoundFile; categories: string[] }>();
    for (const v of voiceSetFiles(audio, voiceSet, faction).sort((a, b) => rank(a.category) - rank(b.category))) {
      const deathLike = DEATHLIKE.test(v.category) || deathCategories.has(v.category);
      if (deathLike && !deathCategories.has(v.category)) continue; // in the set, never played by this actor
      for (const f of uniqueRefs(v.files)) {
        const e = clips.get(f.file) ?? { file: f, categories: [] };
        if (!e.categories.includes(v.category)) e.categories.push(v.category);
        clips.set(f.file, e);
      }
    }
    const seen = new Map<string, number>();
    for (const { file: f, categories } of clips.values()) {
      const c = clip(f, locate);
      const slot = `clip:${f.file}`;
      const line = c.path ? lineOf(c.path) : null;
      const name = categories.map(k => VOICE_LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2")).join(" · ");
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      out.push({ ...base, id: slot, kind: "voice", group: "voice", label: n > 1 ? `${name} ${n}` : name, short: VOICE_LABELS[categories[0]] ?? categories[0],
        current: [c], sharedWith: usersOf(slot).filter(a => a !== id), line,
        // Only the factions' own lines (modern-factions/audio) have a generator that can say them again.
        regen: c.path?.startsWith("mods/rtsai/modern-factions/audio/") && line?.text ? "voice" : null });
    }
  }
  for (const weapon of actorWeapons(actor)) {
    const s = weaponSounds(data, weapon);
    const label = weaponLabel(weapon);
    const users = usersOf(`fire:*:${weapon}`).filter(a => a !== id);
    out.push({ ...base, id: `fire:${id}:${weapon}`, kind: "fire", group: "weapon", weapon, label: `${label} · fire`, short: "Fire", current: uniqueRefs(s.report).map(f => clip(f, locate)), sharedWith: users });
    out.push({ ...base, id: `impact:${id}:${weapon}`, kind: "impact", group: "weapon", weapon, label: `${label} · impact`, short: "Impact", current: uniqueRefs(s.impact).map(f => clip(f, locate)), sharedWith: users });
  }
  const dying = deathChain(data, id);
  if (dying) {
    const files = uniqueRefs(dying.weapons.flatMap(w => weaponSounds(data, w).impact));
    out.push({ ...base, id: `death:${id}`, kind: "death", group: "death", label: dying.owner === id ? "Destroyed" : "Destroyed · crash", short: "Destroyed", current: files.map(f => clip(f, locate)) });
  }
  for (const [trait, key, label, kind] of TRAIT_SOUNDS) {
    const nodes = traits(actor, trait);
    if (!nodes.length) continue;
    const files = uniqueRefs(nodes.flatMap(([, n]) => list(childValue(n.value, key)).map(s => soundFile(s))));
    if (!files.length) continue;
    out.push({ ...base, id: `trait:${id}:${trait}:${key}`, kind, group: kind === "death" ? "death" : "other", label, short: label, current: files.map(f => clip(f, locate)) });
  }
  return out;
}

/**
 * A faction's announcer: one slot per clip (what it says, the notifications that play it) and one per Speech
 * notification (which clip it plays; the mapping is shared by every faction).
 */
export function announcerSlots(audio: AudioData, faction: string, locate: Locate, lineOf: LineLookup): { clips: DeskSlot[]; notifications: DeskSlot[] } {
  const speech = factionSpeech(audio, faction);
  const byClip = new Map<string, { file: SoundFile; keys: string[] }>();
  const notifications: DeskSlot[] = [];
  for (const n of speech) {
    const f = n.files[0];
    if (!f) continue;
    const clipId = f.clip;
    const entry = byClip.get(clipId) ?? { file: f, keys: [] };
    entry.keys.push(n.notification);
    byClip.set(clipId, entry);
  }
  const clips: DeskSlot[] = [...byClip.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([clipId, { file, keys }]) => {
    const c = clip(file, locate);
    const line = c.path ? lineOf(c.path) : null;
    return { id: `eva:${faction}:${clipId}`, kind: "announcer", group: "announcer", label: line?.text ?? clipId, short: clipId, faction, actor: null, weapon: null,
      current: [c], sharedWith: [], line, regen: c.path?.startsWith("mods/rtsai/modern-factions/audio/eva/") ? "eva" : null, notifications: keys, clip: clipId };
  });
  for (const n of speech) {
    const f = n.files[0];
    if (!f) continue;
    const c = clip(f, locate);
    notifications.push({ id: `notify:${n.notification}`, kind: "notify", group: "announcer", label: n.notification.replace(/([a-z])([A-Z])/g, "$1 $2"), short: f.clip, faction: null, actor: null, weapon: null,
      current: [c], sharedWith: [], line: c.path ? lineOf(c.path) : null, regen: null, clip: f.clip });
  }
  return { clips, notifications };
}

/** Which actors use each voice clip and each weapon (`clip:<file>`, `fire:*:<Weapon>`), across the given actors. */
export function usageIndex(data: ModData, audio: AudioData, actors: { id: string; faction: string }[]) {
  const users = new Map<string, Set<string>>();
  const add = (key: string, actor: string) => { const s = users.get(key) ?? new Set<string>(); s.add(actor); users.set(key, s); };
  for (const { id, faction } of actors) {
    const actor = data.rules.get(id);
    if (!actor) continue;
    const set = actorVoiceSet(actor);
    if (set) for (const v of voiceSetFiles(audio, set, faction)) for (const f of v.files) add(`clip:${f.file}`, id);
    for (const w of actorWeapons(actor)) add(`fire:*:${w}`, id);
  }
  return (key: string) => [...(users.get(key) ?? [])];
}

/** A family of variants: igiat1a, igiat1b, igiat1c -> "igiat1". */
export function soundFamily(ref: string) {
  const stem = ref.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "");
  return /^[a-z]{3,}\d*[a-z]{2,}\d*[a-h]$/i.test(stem) && stem.length >= 6 ? stem.slice(0, -1) : stem;
}
/** "igiat1a, igiat1b, igiat1c" -> "igiat1a–c". */
export function familyLabel(refs: string[]) {
  const stems = [...new Set(refs.map(r => r.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "")))].sort();
  if (stems.length > 1) {
    const fam = soundFamily(stems[0]);
    if (stems.every(s => soundFamily(s) === fam && s.length === fam.length + 1)) return `${stems[0]}–${stems[stems.length - 1].slice(-1)}`;
  }
  return stems.join(", ");
}

/**
 * A first guess at a unit's size for its death explosion: the size its death effect already names (R2FXDeathSmall,
 * …ShipDeathLarge), else the building's footprint, else health and armor within its class (heavy armor reads large).
 */
export function guessDeathSize(actor: Yaml, category: string, deathWeaponNames: string[] = []): DeathSize {
  const named = deathWeaponNames.map(w => /(Small|Medium|Large)$/.exec(w)?.[1]?.toLowerCase()).find(Boolean) as DeathSize | undefined;
  const hp = Number(childValue(child(actor, "Health")?.value, "HP") ?? "0") || 0;
  const heavy = /Heavy|Concrete|Steel/i.test(childValue(child(actor, "Armor")?.value, "Type") ?? "");
  if (category === "structure" || category === "defense") {
    const dims = (childValue(child(actor, "Building")?.value, "Dimensions") ?? "1,1").split(",").map(n => Number(n.trim()) || 1);
    const area = (dims[0] ?? 1) * (dims[1] ?? 1);
    return area >= 9 ? "large" : area >= 4 ? "medium" : "small";
  }
  if (category === "vehicle" && heavy && hp >= 350) return "large";
  if (named) return named;
  const [small, large] = category === "ship" ? [300, 700] : category === "aircraft" ? [150, 240] : [200, 400];
  return hp >= large ? "large" : hp >= small ? "medium" : "small";
}
