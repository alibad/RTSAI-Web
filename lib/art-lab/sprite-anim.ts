/**
 * Which sequences the game plays for each sprite animation, taken from the rules traits recorded per
 * sequence (`usedBy`): infantry stand / move / attack / idle / die (and prone when the unit has prone art);
 * defences idle / build-up, with the turret and idle overlays on top.
 */
import type { SpriteArt, SpriteSequence } from "./types";

export type SpriteAnimation = { id: string; label: string; body: SpriteSequence | null; note: string | null };

export const animationLabels: Record<string, string> = {
  stand: "Stand", move: "Walk", attack: "Fire", idle: "Idle", die: "Die", prone: "Prone", body: "Idle", make: "Build-up",
};

// A build-menu icon is never an actor body, even when the body file is unresolved.
const own = (s: SpriteSequence) => s.name !== "icon" && !s.usedBy.some(u => u.startsWith("Buildable icon")) && Boolean(s.file) && !s.inherited && !(s.file ?? "").endsWith(".png");

export function spriteAnimations(sprite: SpriteArt | null): SpriteAnimation[] {
  if (!sprite) return [];
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
    const prone = seqs.find(s => s.name.startsWith("prone-")) ?? null;
    out.push({ id: "prone", label: "Prone", body: prone ?? stand, note: prone ? null : "No prone art: while prone the game shows the normal sequences." });
    out.push({ id: "die", label: "Die", body: by("WithDeathAnimation"), note: null });
  } else {
    out.push({ id: "body", label: "Idle", body: by("WithFacingSpriteBody") ?? by("WithSpriteBody") ?? seqs.find(s => !s.usedBy.some(u => u.startsWith("WithSpriteTurret"))) ?? null, note: null });
    const make = by("WithMakeAnimation");
    if (make) out.push({ id: "make", label: "Build-up", body: make, note: "Build-up: the turret and overlays appear once construction completes." });
  }
  const used = new Set(out.map(a => a.body?.name));
  for (const s of seqs) {
    if (used.has(s.name) || s.name === "icon" || s.name === sprite.turret?.sequence || s.usedBy.some(u => u.startsWith("WithIdleOverlay"))) continue;
    const layer = sprite.overlays?.find(o => s.name === o.sequence || s.name === `damaged-${o.sequence}`);
    if (layer && layer.mode !== "loop") {
      const damaged = s.name.startsWith("damaged-");
      const body = damaged ? seqs.find(q => q.name === `damaged-${out[0]?.body?.name}`) ?? out[0]?.body : out[0]?.body;
      out.push({ id: s.name, label: `${damaged ? "Damaged · " : ""}${layer.mode === "door" ? "Production door" : s.name.replace(/-/g, " ")}`, body: body ?? null, note: "Layered sequence preview; production timing is controlled by the game." });
    } else if (s.usedBy.some(u => u.startsWith("WithInfantryBody")) || /idle|stand|run|walk|damaged|deploy|shoot|attack|die|prone|make|build|land|takeoff|liedown|standup|parachute/.test(s.name)) {
      const label=s.usedBy.some(u=>u.startsWith("WithInfantryBody idle"))?`Idle ${seqs.filter(q=>q.usedBy.some(u=>u.startsWith("WithInfantryBody idle"))).indexOf(s)+1}`:s.name.replace(/-/g," ");
      out.push({ id: s.name, label, body: s, note: "Sequence art preview; activity timing is controlled by the game." });
    }
  }
  return out.filter(a => a.body);
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
  return sprite.sequences.find(s => s.name === sprite.turret!.sequence && own(s)) ?? null;
}

export function overlaySequence(sprite: SpriteArt | null) {
  return sprite?.sequences.find(s => own(s) && s.usedBy.some(u => u.startsWith("WithIdleOverlay"))) ?? null;
}

/** Legacy manifests have no layer metadata; resolve all of their decorative sequences as well. */
export function spriteOverlays(sprite: SpriteArt | null) {
  if (!sprite) return [];
  const declarations = sprite.overlays ?? sprite.sequences.filter(s => own(s) && s.usedBy.some(u => u.startsWith("WithIdleOverlay")) && !s.name.startsWith("damaged-")).map(s => ({ sequence: s.name, trait: "WithIdleOverlay", offset: [0, 0, 0] as [number, number, number], requiresCondition: null, mode: "loop" as const }));
  return declarations.flatMap(o => {
    const seq = sprite.sequences.find(s => s.name === o.sequence && own(s));
    return seq ? [{ ...o, seq }] : [];
  });
}
