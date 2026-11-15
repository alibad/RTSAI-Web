/**
 * Per-faction narrative for the faction pages and the Studio's Faction viewer: "Identity" (what the faction fights for,
 * in its own in-game voice) and "Rivals' view" (the same faction through its rivals' eyes). Data-driven from the shared
 * catalog (RTSAI-Mod/catalog/factions.json -> npm run sync:content); each section stays hidden until its data exists.
 *
 * Catalog fields (written by the narrative work, validated by RTSAI-Mod companion/scripts/content_catalog.py):
 *   catalog.narrative.framing                          in-world disclaimer, shown with the rival views
 *   faction.identity  { motto, story, keywords[] }     the faction's own voice
 *   faction.rivalViews[] { rival, kind: "propaganda" | "grievance", text }
 *   faction.flavour { loading[], voiceIdeas[] }        loading-screen lines and audio ideas: never shown here
 */
import { catalog, factionById, type Faction } from "./game-content";

export type FactionIdentity = { motto: string | null; story: string[]; keywords: string[] };
export type RivalView = { rival: { id: string; name: string; accent: string }; kind: "propaganda" | "grievance" | null; text: string[] };
export type FactionNarrative = { identity: FactionIdentity | null; rivalViews: RivalView[]; framing: string | null };

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const paragraphs = (value: unknown) => (str(value)?.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean) ?? []);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function identityOf(raw: unknown): FactionIdentity | null {
  const obj = record(raw);
  if (!obj) return null;
  const identity = {
    motto: str(obj.motto),
    story: paragraphs(obj.story),
    keywords: Array.isArray(obj.keywords) ? obj.keywords.map(str).filter((k): k is string => Boolean(k)) : [],
  };
  return identity.motto || identity.story.length ? identity : null;
}

function rivalViewsOf(raw: unknown, self: string): RivalView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    const obj = record(item);
    const rival = obj && typeof obj.rival === "string" && obj.rival !== self ? factionById(obj.rival) : undefined;
    const text = paragraphs(obj?.text);
    if (!rival || !text.length) return [];
    const kind = obj!.kind === "propaganda" || obj!.kind === "grievance" ? obj!.kind : null;
    return [{ rival: { id: rival.id, name: rival.name, accent: rival.accent }, kind, text }];
  });
}

/** The faction's narrative, or null while the catalog has none. */
export function factionNarrative(faction: Faction | undefined): FactionNarrative | null {
  if (!faction) return null;
  const raw = faction as unknown as Record<string, unknown>;
  const identity = identityOf(raw.identity);
  const rivalViews = rivalViewsOf(raw.rivalViews, faction.id);
  if (!identity && !rivalViews.length) return null;
  return { identity, rivalViews, framing: str(record((catalog as unknown as Record<string, unknown>).narrative)?.framing) };
}
