import { rosterActors, rosterFactionById, rosterFactions, type GameMode } from './game-content';
import { actorFor, generateScene, makePiece, maxHealth, parseScene, placementIssue, type Scene, type World } from './workshop';

export const campaignStorage = 'rtsai-campaign-v1';
export const campaignPreviewStorage = 'rtsai-campaign-preview-v1';
export const campaignResultStorage = 'rtsai-campaign-result-v1';
export const campaignProgressStorage = 'rtsai-campaign-progress-v1';
export const shotLooks = ['district', 'clinic', 'crossing', 'coast', 'relay'] as const;
export type ShotLook = typeof shotLooks[number];
export type Character = { id: string; name: string; role: string; bio: string };
export type Shot = { id: string; look: ShotLook; seconds: number; caption: string; speaker: string; dialogue: string };
export type Objective = { id: string; title: string; kind: 'reach' | 'repair' | 'protect' | 'survive'; actorId: number; x: number; y: number; seconds: number; health: number };
export type Choice = { id: string; label: string; outcome: 'success' | 'setback'; next: string | null; consequence: string; trust: number; supplies: number };
export type Mission = { id: string; title: string; location: string; summary: string; seed: number; terrain: 'plains' | 'river' | 'coast' | 'islands'; actorKey: string; limit: number; objectives: Objective[]; shots: Shot[]; choices: Choice[]; scene?: Scene };
export type Campaign = { version: 1; id: string; title: string; synopsis: string; setting: string; mode: GameMode; faction: string; tone: 'dusk' | 'dawn' | 'night'; start: string; characters: Character[]; missions: Mission[] };
export type StoryProgress = { campaignId: string; current: string | null; trust: number; supplies: number; history: { mission: string; choice: string; outcome: Choice['outcome']; consequence: string }[] };
export type MissionResult = { status: 'pending' | 'success' | 'setback'; checks: { id: string; title: string; pass: boolean; detail: string }[] };

const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object.'); return v as Record<string, unknown>; };
const text = (v: unknown, max: number, empty = false) => { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim()) || [...v].some(char => char.charCodeAt(0) < 9)) throw new Error('Invalid or oversized text.'); return v; };
const id = (v: unknown) => { const s = text(v, 49); if (!/^[a-z][a-z0-9-]*$/.test(s)) throw new Error('Use short lowercase identifiers.'); return s; };
const number = (v: unknown, min: number, max: number) => { if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < min || v > max) throw new Error(`Expected a whole number from ${min} to ${max}.`); return v; };
const list = (v: unknown, max: number, min = 1): unknown[] => { if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`Expected ${min}–${max} entries.`); return v; };
function option<T extends string>(v: unknown, options: readonly T[]): T { if (!options.includes(v as T)) throw new Error('Unknown option.'); return v as T; }
function unique(entries: { id: string }[]) { if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Identifiers must be unique.'); }

/** Whitelisted JSON only: no executable scripts, remote media or local file paths. */
export function parseCampaign(source: string): Campaign {
  if (source.length > 2_000_000) throw new Error('Campaign file is too large.');
  const c = object(JSON.parse(source));
  if (c.version !== 1) throw new Error('Unsupported campaign version.');
  const mode = option(c.mode, ['ra2', 'ra']);
  const faction = text(c.faction, 40);
  if (!rosterFactionById(faction, mode)) throw new Error('Faction is unavailable in this mode.');
  const characters = list(c.characters, 12, 0).map(v => { const a = object(v); return { id: id(a.id), name: text(a.name, 60), role: text(a.role, 80), bio: text(a.bio, 800, true) }; });
  unique(characters);
  const missions = list(c.missions, 24).map(v => {
    const m = object(v);
    const actorKey = text(m.actorKey, 90);
    const actor = actorFor(actorKey);
    if (actor.mode !== mode || !['infantry', 'vehicle'].includes(actor.category) || !rosterFactionById(faction, mode)!.actors.includes(actorKey)) throw new Error('Choose a ground unit from this faction and mode.');
    const shots = list(m.shots, 8).map(v => { const s = object(v); const speaker = text(s.speaker, 49, true); if (speaker && !characters.some(c => c.id === speaker)) throw new Error('A shot references a missing character.'); return { id: id(s.id), look: option(s.look, shotLooks), seconds: number(s.seconds, 3, 12), caption: text(s.caption, 220), speaker, dialogue: text(s.dialogue, 400, true) }; });
    const scene = m.scene === undefined ? undefined : parseScene(JSON.stringify(m.scene));
    if (scene && scene.mode !== mode) throw new Error('The attached battlefield belongs to another game mode.');
    const objectives = list(m.objectives, 6).map(v => { const o = object(v); return { id: id(o.id), title: text(o.title, 140), kind: option(o.kind, ['reach', 'repair', 'protect', 'survive']), actorId: number(o.actorId, 1, 1_000_000), x: number(o.x, 4, scene ? scene.size - 5 : 58), y: number(o.y, 4, scene ? scene.size - 5 : 58), seconds: number(o.seconds, 5, 180), health: number(o.health, 10, 100) }; });
    if (objectives.some(o => scene ? !scene.pieces.some(p => p.id === o.actorId) : o.actorId > 3)) throw new Error('An objective references a missing map actor.');
    const choices = list(m.choices, 4).map(v => { const a = object(v); return { id: id(a.id), label: text(a.label, 100), outcome: option(a.outcome, ['success', 'setback']), next: a.next === null ? null : id(a.next), consequence: text(a.consequence, 400), trust: number(a.trust, -30, 30), supplies: number(a.supplies, -30, 30) }; });
    unique(shots); unique(objectives); unique(choices);
    const limit = number(m.limit, 15, 300);
    if (objectives.some(o => o.seconds > limit)) throw new Error('Objective duration exceeds the mission time limit.');
    return { id: id(m.id), title: text(m.title, 80), location: text(m.location, 90), summary: text(m.summary, 1200), seed: number(m.seed, 0, 1_000_000), terrain: option(m.terrain, ['plains', 'river', 'coast', 'islands']), actorKey, limit, objectives, shots, choices, ...(scene ? { scene } : {}) };
  });
  unique(missions);
  const start = id(c.start);
  if (!missions.some(m => m.id === start)) throw new Error('The opening mission is missing.');
  for (const m of missions) for (const ch of m.choices) if (ch.next && !missions.some(n => n.id === ch.next)) throw new Error('A branch points to a missing mission.');
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(key: string) { if (visiting.has(key)) throw new Error('Campaign branches must not loop.'); if (visited.has(key)) return; visiting.add(key); for (const ch of missions.find(m => m.id === key)!.choices) if (ch.next) visit(ch.next); visiting.delete(key); visited.add(key); }
  for (const m of missions) visit(m.id);
  return { version: 1, id: id(c.id), title: text(c.title, 80), synopsis: text(c.synopsis, 1600), setting: text(c.setting, 120), mode, faction, tone: option(c.tone, ['dusk', 'dawn', 'night']), start, characters, missions };
}

export function newProgress(c: Campaign): StoryProgress { return { campaignId: c.id, current: c.start, trust: 50, supplies: 65, history: [] }; }
export function resolveStory(c: Campaign, p: StoryProgress, choiceId: string): StoryProgress {
  if (p.campaignId !== c.id || !p.current || p.history.length >= 24) throw new Error('Start a new story playthrough.');
  const mission = c.missions.find(m => m.id === p.current), ch = mission?.choices.find(a => a.id === choiceId);
  if (!mission || !ch) throw new Error('This choice is unavailable.');
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return { ...p, current: ch.next, trust: clamp(p.trust + ch.trust), supplies: clamp(p.supplies + ch.supplies), history: [...p.history, { mission: mission.id, choice: ch.id, outcome: ch.outcome, consequence: ch.consequence }] };
}
export function parseProgress(source: string, c: Campaign): StoryProgress {
  if (source.length > 30_000) throw new Error('Story history is too large.');
  const value = object(JSON.parse(source)); if (value.campaignId !== c.id) throw new Error('Story history belongs to another campaign.');
  const history = list(value.history, 24, 0).map(v => { const h = object(v); return { mission: id(h.mission), choice: id(h.choice) }; });
  const initial = history[0]?.mission ?? id(value.current);
  if (!c.missions.some(m => m.id === initial)) throw new Error('The story chapter no longer exists.');
  let p = { ...newProgress(c), current: initial } as StoryProgress;
  for (const h of history) { if (p.current !== h.mission) throw new Error('Story history no longer follows these branches.'); p = resolveStory(c, p, h.choice); }
  if (p.current !== value.current || p.trust !== value.trust || p.supplies !== value.supplies) throw new Error('The story branches changed. Restart the playthrough.');
  return p;
}
export function campaignIssues(c: Campaign) {
  try { parseCampaign(JSON.stringify(c)); } catch (e) { return [(e as Error).message]; }
  const reachable = new Set<string>();
  function visit(key: string) { if (reachable.has(key)) return; reachable.add(key); for (const ch of c.missions.find(m => m.id === key)!.choices) if (ch.next) visit(ch.next); }
  visit(c.start);
  return c.missions.filter(m => !reachable.has(m.id)).map(m => `${m.title} is not reachable from the opening.`);
}
export function removeMission(c: Campaign, key: string): Campaign {
  if (c.missions.length === 1) throw new Error('Keep at least one mission.');
  const removed = c.missions.find(m => m.id === key); if (!removed) return c;
  const next = removed.choices.find(ch => ch.next !== null)?.next ?? null;
  const missions = c.missions.filter(m => m.id !== key).map(m => ({ ...m, choices: m.choices.map(ch => ch.next === key ? { ...ch, next } : ch) }));
  return { ...c, start: c.start === key ? next ?? missions[0].id : c.start, missions };
}
export function duration(m: Mission) { return m.shots.reduce((t, s) => t + s.seconds, 0); }
export function shotAt(m: Mission, time: number) { let start = 0; for (let i = 0; i < m.shots.length; i++) { const shot = m.shots[i]; if (time < start + shot.seconds || i === m.shots.length - 1) return { shot, index: i, elapsed: Math.max(0, Math.min(shot.seconds, time - start)), start }; start += shot.seconds; } throw new Error('Add a storyboard shot.'); }

function reliefActor(mode: GameMode, faction = mode === 'ra2' ? 'america' : 'england') {
  const actors = rosterActors(rosterFactionById(faction, mode)!);
  return actors.find(a => a.category === 'infantry' && !a.behavior.weapons.length) ?? actors.find(a => a.category === 'infantry')!;
}
export function changeCampaignMode(c: Campaign, mode: GameMode, faction = c.faction): Campaign {
  if (mode !== c.mode && c.missions.some(m => m.scene)) throw new Error('Keep the attached maps in this mode, or use generated maps before changing mode.');
  const country = rosterFactionById(faction, mode) ?? rosterFactions(mode)[0];
  const actors = rosterActors(country), fallback = reliefActor(mode, country.id);
  return { ...c, mode, faction: country.id, missions: c.missions.map(m => ({ ...m, actorKey: actors.find(a => a.id === actorFor(m.actorKey).id)?.key ?? fallback.key })) };
}

/** Stand-in actors on procedural terrain. Objectives execute only in the browser prototype. */
export function missionScene(c: Campaign, m: Mission): Scene {
  if (m.scene) { const scene = parseScene(JSON.stringify(m.scene)); scene.title = m.title; return scene; }
  const scene = generateScene(c.mode, m.seed, 64, m.terrain); scene.title = m.title;
  // A clear, walkable fictional district, independent of any real geography.
  for (let y = 19; y <= 46; y++) for (let x = 8; x <= 55; x++) scene.cells[y][x] = y === 32 ? 2 : 0;
  for (const o of m.objectives) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) scene.cells[o.y + dy][o.x + dx] = 0;
  const faction = rosterFactionById(c.faction, c.mode)!;
  const structures = rosterActors(faction).filter(a => a.category === 'structure' && !a.behavior.weapons.length && !/wall|silo|cloning|superweapon/.test(a.id));
  const clinic = structures.find(a => /service|workshop|repair/i.test(a.name)) ?? structures[0];
  const plant = structures.find(a => /power|reactor/i.test(a.name)) ?? structures[1] ?? clinic;
  const specs = [{ key: m.actorKey, x: 14, y: 32, team: 'blue' as const }, { key: clinic.key, x: 28, y: 25, team: 'neutral' as const }, { key: plant.key, x: 38, y: 35, team: 'neutral' as const }];
  for (const spec of specs) { const piece = makePiece(scene, spec.key, faction.id, spec.team, spec); if (piece.id !== 1) piece.health = Math.max(1, Math.floor(maxHealth(actorFor(spec.key)) * .35)); const issue = placementIssue(scene, piece); if (issue) throw new Error(issue); scene.pieces.push(piece); }
  return scene;
}
export function checkMission(m: Mission, world: World): MissionResult {
  let lost = false;
  const checks = m.objectives.map(o => {
    const actor = world.pieces.find(p => p.id === o.actorId), alive = !!actor && actor.health > 0;
    if (!alive) lost = true;
    const pass = alive && (o.kind === 'reach' ? Math.hypot(actor.x - o.x, actor.y - o.y) <= 2 : o.kind === 'repair' ? actor.health / maxHealth(actorFor(actor.actorKey)) * 100 >= o.health : world.time >= o.seconds);
    const detail = !alive ? 'Required actor lost' : o.kind === 'reach' ? `Cell ${o.x}, ${o.y}` : o.kind === 'repair' ? `${Math.round(actor.health / maxHealth(actorFor(actor.actorKey)) * 100)}% / ${o.health}% health` : `${Math.floor(world.time)} / ${o.seconds}s`;
    return { id: o.id, title: o.title, pass, detail };
  });
  return { checks, status: lost ? 'setback' : checks.every(o => o.pass) ? 'success' : world.time >= m.limit ? 'setback' : 'pending' };
}
export function previewEnvelope(c: Campaign, m: Mission) { const valid = parseCampaign(JSON.stringify(c)); return JSON.stringify({ version: 1, campaign: valid, missionId: m.id }); }
export function parsePreview(source: string) { if (source.length > 2_010_000) throw new Error('Preview is too large.'); const v = object(JSON.parse(source)); if (v.version !== 1) throw new Error('Unsupported preview.'); const campaign = parseCampaign(JSON.stringify(v.campaign)); const mission = campaign.missions.find(m => m.id === v.missionId); if (!mission) throw new Error('Preview mission is missing.'); return { campaign, mission, scene: missionScene(campaign, mission) }; }

export function applyPreviewResult(source: string, c: Campaign) {
  if (source.length > 4_100_000) throw new Error('Playtest result is too large.');
  const v = object(JSON.parse(source)), valid = parseCampaign(JSON.stringify(c));
  if (v.version !== 1 || v.campaignId !== valid.id || v.source !== JSON.stringify(valid) || v.evidence !== 'browser-prototype') throw new Error('This playtest belongs to a different draft. The current campaign was preserved.');
  const missionId = id(v.missionId);
  if (!c.missions.some(m => m.id === missionId)) throw new Error('Playtest mission no longer exists.');
  const status = option(v.status, ['pending', 'success', 'setback']);
  if (typeof v.seconds !== 'number' || !Number.isFinite(v.seconds) || v.seconds < 0 || v.seconds > 100_000) throw new Error('Invalid playtest time.');
  let campaign = valid;
  if (v.scene !== undefined) { const scene = parseScene(JSON.stringify(v.scene)); if (scene.mode !== valid.mode) throw new Error('The attached map belongs to another mode.'); campaign = parseCampaign(JSON.stringify({ ...valid, missions: valid.missions.map(m => m.id === missionId ? { ...m, scene } : m) })); }
  return { campaign, result: { missionId, status, seconds: v.seconds }, attached: v.scene !== undefined };
}

export function starterCampaign(mode: GameMode = 'ra2'): Campaign {
  const actorKey = reliefActor(mode).key;
  const make = (key: string, title: string, location: string, summary: string, look: ShotLook, dialogue: string, next: string | null, i: number): Mission => ({ id: key, title, location, summary, seed: 310 + i, terrain: i === 3 ? 'coast' : 'plains', actorKey, limit: 120,
    objectives: [{ id: 'arrival', title: 'Bring the relief worker to the meeting point', kind: 'reach', actorId: 1, x: 25, y: 32, seconds: 15, health: 80 }, { id: 'repair', title: 'Restore the service building to 80% health', kind: 'repair', actorId: 2, x: 28, y: 25, seconds: 15, health: 80 }, { id: 'shelter', title: 'Keep the service building intact for 20 seconds', kind: 'protect', actorId: 2, x: 28, y: 25, seconds: 20, health: 80 }],
    shots: [{ id: 'establish', look, seconds: 5, caption: location, speaker: '', dialogue: 'Fictional campaign · civilian accounts' }, { id: 'voice', look, seconds: 6, caption: title, speaker: i === 1 ? 'rana' : i === 4 ? 'nabil' : 'mira', dialogue }, { id: 'task', look: 'crossing', seconds: 5, caption: 'The next step', speaker: '', dialogue: i === 2 ? 'Restore the line. Leave a clear record of who still needs help.' : 'Reach the meeting point. Repair the service building. Keep it intact.' }, { id: 'question', look: 'relay', seconds: 4, caption: 'What will you carry forward?', speaker: '', dialogue: 'Supplies can run out. Trust can be lost. Every decision changes the next chapter.' }],
    choices: [{ id: 'care', label: 'Share the supplies openly', outcome: 'success', next, consequence: 'People see where the supplies went. Trust grows, but the next district starts with less.', trust: 10, supplies: -12 }, { id: 'delay', label: 'Withdraw and return with help', outcome: 'setback', next, consequence: 'The team survives the delay. Those waiting are not sure another convoy will come.', trust: -8, supplies: 6 }] });
  const missions = [
    make('last-light', 'The Last Light', 'A hillside district · dusk', 'An outage closes the clinic. Mira, a civilian engineer, gathers a relief crew while residents disagree about who can be trusted to keep the road open.', 'district', 'I can fix the wiring. I cannot promise who will let us pass. People are waiting; that is the part I know.', 'clinic', 0),
    make('clinic', 'Names, Not Numbers', 'The improvised clinic · night', 'Rana is treating neighbors on both sides of a divided street. The mission follows the people waiting for medicine, rather than the armed groups claiming responsibility for them.', 'clinic', 'There are no columns for allegiance on this list. There are names, temperatures, and how long they can wait.', 'grid', 1),
    make('grid', 'A Line to Home', 'The damaged power district', 'Repairs restore a small communication link. Conflicting accounts reach the team: residents describe protection, coercion, fear and loss. No single account is treated as the whole truth.', 'relay', 'A working light will not settle the argument. It will let a mother tell her family she is still here.', 'harbor', 2),
    make('harbor', 'The Open Door', 'A fictional coastal neighborhood', 'Families wait for a safe place to stay. The relief team must choose how to distribute limited supplies, explain its decision and keep access open.', 'coast', 'We wrote the destination on the door so no one would have to guess. We should have done that earlier.', 'voices', 3),
    make('voices', 'What Remains', 'The public radio room · dawn', 'Nabil records residents whose experiences contradict one another. His own memories of Hezbollah’s influence include loyalty, doubt and pressure. The ending asks what can be repaired and what must be acknowledged.', 'relay', 'I once believed every story our neighbors repeated. Now I want to hear the people we left out. A flag cannot answer for them.', null, 4),
  ];
  missions[0].choices.push({ id: 'line-first', label: 'Restore communications first', outcome: 'success', next: 'grid', consequence: 'The radio reaches more districts, but the clinic has to wait. The later chapters remember that choice.', trust: -4, supplies: 10 });
  return { version: 1, id: 'between-the-lines', title: 'Between the Lines', synopsis: 'A fictional Lebanese civilian campaign about care, contested memories and the cost of choosing. Multiple voices describe life in a district influenced by Hezbollah; none represents an entire community or supplies a verified historical account.', setting: 'Fictional Lebanese districts · multiple civilian perspectives', mode, faction: mode === 'ra2' ? 'america' : 'england', tone: 'dusk', start: 'last-light', characters: [{ id: 'mira', name: 'Mira', role: 'Civilian engineer', bio: 'Keeps a notebook of repairs and unresolved requests. Her priority is keeping people connected.' }, { id: 'rana', name: 'Rana', role: 'Paramedic', bio: 'Treats neighbors regardless of allegiance and resists pressure to turn her patient list into a political statement.' }, { id: 'nabil', name: 'Nabil', role: 'Local volunteer', bio: 'Grew up in a neighborhood influenced by Hezbollah. He voices conflicted loyalty, doubt and a wish to hear accounts his community overlooked. He speaks for himself.' }], missions };
}
