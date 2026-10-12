/**
 * Which sequences the game plays for each sprite animation, taken from the rules traits recorded per
 * sequence (`usedBy`): infantry stand / move / attack / idle / die (and prone when the unit has prone art);
 * defences idle / build-up, with the turret and idle overlays on top.
 */
import type { SpriteArt, SpriteSequence } from "./types";
import { distinctLabels, sequenceLabel, spinKind, spinLabel } from "./action-labels";

export type SpriteAnimation = { id: string; label: string; body: SpriteSequence | null; note: string | null; /** Replaces the turret sequence while it plays (WithTurretAttackAnimation). */ turret?: SpriteSequence | null };

export const animationLabels: Record<string, string> = {
  stand: "Stand", move: "Walk", attack: "Fire", idle: "Idle", die: "Die", prone: "Prone", body: "Idle", make: "Build-up",
};

const isIcon = (s: SpriteSequence) => s.name === "icon" || s.usedBy.some(u => u.startsWith("Buildable icon"));
/**
 * The actor's own drawn sequences. A build-menu icon is never an actor body, even when the body file is unresolved and
 * falls back to the icon's file; other PNG files are sprite sheets (OpenRA's PngSheet, e.g. OpenHV), wherever served from.
 */
function ownIn(sprite: SpriteArt) {
  const icons = new Set(sprite.sequences.filter(isIcon).map(s => s.file).filter(Boolean));
  return (s: SpriteSequence) => !isIcon(s) && Boolean(s.file) && !s.inherited && !icons.has(s.file);
}

export function spriteAnimations(sprite: SpriteArt | null): SpriteAnimation[] {
  if (!sprite) return [];
  const own = ownIn(sprite);
  const seqs = sprite.sequences.filter(own);
  const by = (prefix: string) => seqs.find(s => s.usedBy.some(u => u.startsWith(prefix))) ?? null;
  const infantry = seqs.some(s => s.usedBy.some(u => u.startsWith("WithInfantryBody")));
  const out: SpriteAnimation[] = [];
  if (infantry) {
    const stand = by("WithInfantryBody stand");
    out.push({ id: "stand", label: "Stand", body: stand, note: null });
    out.push({ id: "move", label: "Walk", body: by("WithInfantryBody move"), note: null });
    out.push({ id: "attack", label: "Fire", body: by("WithInfantryBody attack"), note: null });
    out.push({ id: "idle", label: "Idle", body: by("WithInfantryBody idle"), note: null });
    // Prone is lying still (prone-stand); crawling (prone-run) is its own action.
    const prone = seqs.find(s => s.name === "prone-stand") ?? seqs.find(s => s.name.startsWith("prone-")) ?? null;
    out.push({ id: "prone", label: "Prone", body: prone ?? stand, note: prone ? null : "No prone art: while prone the game shows the normal sequences." });
    out.push({ id: "die", label: "Die", body: by("WithDeathAnimation"), note: null });
  } else {
    // A sprite vehicle's idle is named by what spins on it: a rotor, propeller or radar overlay, or a body or turret
    // that loops its frames (prerendered spins, named by the candidate or the model it replaces).
    const body = by("WithFacingSpriteBody") ?? by("WithSpriteBody") ?? seqs.find(s => !s.usedBy.some(u => u.startsWith("WithSpriteTurret") || u.startsWith("WithSpriteBarrel"))) ?? null;
    const spins = spriteSpins(sprite, body);
    out.push({ id: "body", label: spins.length ? spinLabel(spins.map(spinKind)) : "Idle", body, note: null });
    const make = by("WithMakeAnimation");
    if (make) out.push({ id: "make", label: "Build-up", body: make, note: "Build-up: the turret and overlays appear once construction completes." });
    // A defence fires by swapping its turret sequence (WithTurretAttackAnimation); the body stays as it is.
    const fire = seqs.find(s => s.usedBy.some(u => u === "WithTurretAttackAnimation"));
    if (fire && out[0]?.body) out.push({ id: fire.name, label: "Fire", body: out[0].body, turret: fire, note: "Turret fire: the game plays it each time the defence attacks." });
    // A turretless defence fires by swapping its body (WithAttackAnimation), e.g. a bunker's firing slit.
    const attack = seqs.find(s => s.usedBy.some(u => u.split("@")[0] === "WithAttackAnimation"));
    if (attack && !fire) out.push({ id: attack.name, label: "Fire", body: attack, note: "Attack: the game plays it each time the defence fires." });
    // Conditional turrets (a deploy-gated radar's still dish) are alternatives to the main turret.
    for (const name of sprite.turretVariants ?? []) {
      const seq = seqs.find(s => s.name === name);
      if (seq && out[0]?.body) out.push({ id: seq.name, label: sequenceLabel(seq.name), body: out[0].body, turret: seq, note: "Shown while its condition holds in game (e.g. before a radar deploys)." });
    }
  }
  const used = new Set([...out.map(a => a.body?.name), ...out.map(a => a.turret?.name)]);
  for (const s of seqs) {
    if (used.has(s.name) || s.name === "icon" || s.name === sprite.turret?.sequence || s.usedBy.some(u => u.startsWith("WithIdleOverlay") || u.startsWith("WithTurretAttackAnimation") || u.startsWith("WithSpriteTurret") || u.startsWith("WithSpriteBarrel"))) continue;
    const layer = sprite.overlays?.find(o => s.name === o.sequence || s.name === `damaged-${o.sequence}`);
    if (layer && layer.mode !== "loop") {
      const damaged = s.name.startsWith("damaged-");
      const body = damaged ? seqs.find(q => q.name === `damaged-${out[0]?.body?.name}`) ?? out[0]?.body : out[0]?.body;
      out.push({ id: s.name, label: layer.mode === "door" ? `${damaged ? "Damaged · " : ""}Production door` : sequenceLabel(s.name), body: body ?? null, note: "Layered sequence preview; production timing is controlled by the game." });
    } else if (s.usedBy.some(u => u.startsWith("WithInfantryBody")) || /idle|stand|run|walk|damaged|deploy|shoot|attack|die|prone|make|build|land|takeoff|liedown|standup|parachute/.test(s.name)) {
      const label=s.usedBy.some(u=>u.startsWith("WithInfantryBody idle"))?`Idle ${seqs.filter(q=>q.usedBy.some(u=>u.startsWith("WithInfantryBody idle"))).indexOf(s)+1}`:sequenceLabel(s.name);
      out.push({ id: s.name, label, body: s, note: "Sequence art preview; activity timing is controlled by the game." });
    }
  }
  return distinctLabels(out.filter(a => a.body));
}

/** The animation to show for a requested id, falling back to the first (stand / idle). */
export function pickAnimation(sprite: SpriteArt | null, id: string) {
  const list = spriteAnimations(sprite);
  const aliases: Record<string, string[]> = { stand: ["stand", "body"], body: ["body", "stand"], move: ["move", "body"], attack: ["attack", "body"], idle: ["idle", "body"], die: ["die", "body"], prone: ["prone", "body"], make: ["make", "stand"] };
  for (const candidate of aliases[id] ?? [id]) {
    const hit = list.find(a => a.id === candidate);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

export function turretSequence(sprite: SpriteArt | null) {
  if (!sprite?.turret) return null;
  return sprite.sequences.find(s => s.name === sprite.turret!.sequence && ownIn(sprite!)(s)) ?? null;
}

/**
 * What turns on a sprite vehicle, by name: looping idle overlays (rotors), sprites riding the turret (a dish),
 * and a body or turret sequence that loops its frames (a prerendered spin; named by `sprite.spin` when known).
 */
export function spriteSpins(sprite: SpriteArt | null, body: SpriteSequence | null = null): string[] {
  if (!sprite) return [];
  const main = body ?? sprite.sequences.filter(ownIn(sprite)).find(s => s.usedBy.some(u => u.startsWith("WithFacingSpriteBody") || u.startsWith("WithSpriteBody"))) ?? null;
  const loops = [main, turretSequence(sprite)].some(s => s && typeof s.length === "number" && s.length > 1);
  return [...spriteOverlays(sprite).filter(o => o.mode === "loop").map(o => o.seq.name), ...turretSprites(sprite).map(s => s.name), ...(loops ? [sprite.spin ?? "moving parts"] : [])];
}

/** Extra sprites riding a turret (WithSpriteTurret@radar: a dish that turns with the turret and loops its frames). */
export function turretSprites(sprite: SpriteArt | null) {
  return (sprite?.turretSprites ?? []).flatMap(name => sprite!.sequences.filter(s => s.name === name && ownIn(sprite!)(s)));
}

/** The barrel sprite (WithSpriteBarrel), drawn at the turret with its LocalOffset turned by the turret's facing. */
export function barrelSequence(sprite: SpriteArt | null) {
  return sprite?.barrel ? sprite.sequences.find(s => s.name === sprite.barrel!.sequence && ownIn(sprite!)(s)) ?? null : null;
}

export function overlaySequence(sprite: SpriteArt | null) {
  return sprite?.sequences.find(s => ownIn(sprite!)(s) && s.usedBy.some(u => u.startsWith("WithIdleOverlay"))) ?? null;
}

/** Legacy manifests have no layer metadata; resolve all of their decorative sequences as well. */
export function spriteOverlays(sprite: SpriteArt | null) {
  if (!sprite) return [];
  const declarations = sprite.overlays ?? sprite.sequences.filter(s => ownIn(sprite!)(s) && s.usedBy.some(u => u.startsWith("WithIdleOverlay")) && !s.name.startsWith("damaged-")).map(s => ({ sequence: s.name, trait: "WithIdleOverlay", offset: [0, 0, 0] as [number, number, number], requiresCondition: null, mode: "loop" as const }));
  return declarations.flatMap(o => {
    const seq = sprite.sequences.find(s => s.name === o.sequence && ownIn(sprite!)(s));
    return seq ? [{ ...o, seq }] : [];
  });
}
