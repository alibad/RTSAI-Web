import { rosters, type GameMode } from "./game-content";
import { compileMissionCore, type EarthFeature } from "./oramap";

export type WorkshopActor = (typeof rosters.actors)[number];
export type Team = "blue" | "red" | "neutral";
export type Terrain = 0 | 1 | 2 | 3;
export type Point = { x: number; y: number };
export type Preset = "river" | "coast" | "islands" | "plains" | "earth";
export type Order = { type: "idle" | "move" | "attack" | "hold"; point?: Point; targetId?: number };
export type Piece = Point & { id: number; actorKey: string; faction: string; team: Team; health: number; rank: "rookie" | "veteran" | "elite"; deployed: boolean; powered: boolean; flags: string[] };
export type Scene = { version: 1; mode: GameMode; title: string; seed: number; size: 64 | 96 | 128; preset: Preset; cells: Terrain[][]; spawns: Point[]; pieces: Piece[]; source: string; ruleCommit: string };
export type LivePiece = Piece & { order: Order; path: Point[]; facing: number; cooldown: number; pathRetry: number; home: Point; ammo: number | null; phase: "ready" | "exit" | "rearming" | "falling" | "wreck"; phaseTime: number; kills: number };
export type Effect = Point & { kind: "projectile" | "explosion"; to: Point; target?: number; damage: number; from: number; life: number; duration: number; color: string };
export type World = { scene: Scene; pieces: LivePiece[]; effects: Effect[]; time: number; log: string[]; shots: number; damage: number; destroyed: number; auto: boolean };

const actorIndex = new Map(rosters.actors.map(a => [a.key, a]));
export function actorFor(key: string) { const actor = actorIndex.get(key); if (!actor) throw new Error("Unknown game actor"); return actor; }
export const isBuilding = (a: WorkshopActor) => a.category === "structure" || a.category === "defense";
export const maxHealth = (a: WorkshopActor) => Math.max(1, a.behavior.health ?? 1);
export function dimensions(a: WorkshopActor): [number, number] {
  if (!isBuilding(a)) return [1, 1];
  const values = a.behavior.footprint?.split(",").map(Number);
  return values?.length === 2 && values.every(v => v > 0 && v <= 10) ? [values[0], values[1]] : [1, 1];
}
export function ammunition(a: WorkshopActor) {
  const detail = a.behavior.actions.find(action => action.id === "AmmoPool")?.detail;
  const count = detail?.match(/^(\d+) ammunition/);
  return count ? Number(count[1]) : null;
}
export function canDeploy(a: WorkshopActor) { return a.behavior.actions.some(action => action.id.split(":")[0] === "GrantConditionOnDeploy"); }

export function conditionNames(a: WorkshopActor) {
  return [...new Set(a.behavior.weapons.flatMap(w => w.condition?.match(/[a-zA-Z][\w-]*/g) ?? []))].filter(s => !["deployed", "rank-elite", "rank-veteran", "disabled", "powered"].includes(s));
}
// Small boolean grammar: no eval, arbitrary JavaScript or caller-provided code.
export function conditionActive(expression: string | null, piece: Pick<Piece, "rank" | "deployed" | "powered" | "flags">): boolean {
  if (!expression) return true;
  const tokens = expression.match(/[a-zA-Z][\w-]*|&&|\|\||!|\(|\)/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) return false;
  const values: Record<string, boolean> = { deployed: piece.deployed, "rank-elite": piece.rank === "elite", "rank-veteran": piece.rank !== "rookie", powered: piece.powered, disabled: !piece.powered };
  for (const flag of piece.flags) values[flag] = true;
  let i = 0;
  function atom(): boolean {
    const token = tokens[i++];
    if (token === "!") return !atom();
    if (token === "(") { const result = or(); if (tokens[i++] !== ")") throw new Error("Invalid condition"); return result; }
    if (!token || !/^[a-zA-Z][\w-]*$/.test(token)) throw new Error("Invalid condition");
    return values[token] === true;
  }
  function and(): boolean { let result = atom(); while (tokens[i] === "&&") { i++; const next = atom(); result = result && next; } return result; }
  function or(): boolean { let result = and(); while (tokens[i] === "||") { i++; const next = and(); result = result || next; } return result; }
  try { const result = or(); return i === tokens.length && result; } catch { return false; }
}
export function activeWeapons(piece: Piece) { return actorFor(piece.actorKey).behavior.weapons.filter(w => conditionActive(w.condition, piece)); }
export function prototypeRange(piece: Piece) { return Math.max(0, ...activeWeapons(piece).map(w => w.range ?? 0)); }
export function multiplier(piece: Piece, type: string) {
  let total = 1;
  for (const action of actorFor(piece.actorKey).behavior.actions) {
    if (!action.id.startsWith(type + ":")) continue;
    const match = action.detail.match(/^(\d+)% when (.+)\.$/);
    if (match && conditionActive(match[2], piece)) total *= Number(match[1]) / 100;
  }
  return total;
}
export function domain(a: WorkshopActor) { return a.category === "aircraft" ? "Air" : a.category === "ship" ? "Water" : "Ground"; }
export function targetTags(a: WorkshopActor) {
  // Rule export includes inherited domains that native traits later replace.
  // Normalize those domains while retaining specialty tags such as Underwater.
  const tags = new Set(a.behavior.targetTypes.filter(t => !["Ground", "GroundActor", "Air", "AirborneActor", "Water", "WaterActor", "Vehicle"].includes(t)));
  const d = domain(a);
  for (const t of d === "Air" ? ["Air", "AirborneActor"] : d === "Water" ? ["Water", "WaterActor", "Ship"] : ["Ground", "GroundActor"]) tags.add(t);
  if (a.category === "vehicle") tags.add("Vehicle");
  if (a.category === "infantry") tags.add("Infantry");
  if (isBuilding(a)) tags.add("Structure");
  if (a.category === "defense") tags.add("Defense");
  return tags;
}
export function supportedWeapon(piece: Piece, target: Piece) {
  const targetActor = actorFor(target.actorKey);
  const tags = targetTags(targetActor);
  return activeWeapons(piece).filter(w => (w.damage ?? 0) > 0 && w.targets.some(t => tags.has(t))).sort((a, b) => (b.range ?? 0) - (a.range ?? 0))[0];
}
export function damageFor(source: Piece, target: Piece, weapon: ReturnType<typeof supportedWeapon>) {
  if (!weapon) return 0;
  const armor = actorFor(target.actorKey).behavior.armor ?? "None";
  const versus = (weapon.versus as Record<string, number> | null)?.[armor] ?? 100;
  return Math.max(0, (weapon.damage ?? 0) * Math.max(1, weapon.burst ?? 1) * versus / 100 * multiplier(source, "FirepowerMultiplier") * multiplier(target, "DamageMultiplier"));
}

function rng(seed: number) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
export function generateScene(mode: GameMode = "ra2", seed = 42, size: Scene["size"] = 64, preset: Preset = "river", features: EarthFeature[] = [], latitude = 24.7136, longitude = 46.6753): Scene {
  const r = rng(seed);
  const cells: Terrain[][] = Array.from({ length: size }, () => Array<Terrain>(size).fill(0));
  const channel = size * (.46 + r() * .08);
  if (preset === "earth") {
    const base = compileMissionCore({ latitude, longitude, radiusM: 3500, size, title: "Earth workshop", seed, story: "" }, features);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells[y][x] = base.cells[y][x] as Terrain;
  } else {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const curve = Math.sin((y + seed) / 9) * size * .06;
      if (preset === "river" && Math.abs(x - channel - curve) < size * .055) cells[y][x] = 1;
      if (preset === "coast" && x > size * .63 + curve) cells[y][x] = 1;
      if (preset === "islands") { const a = Math.hypot(x - size * .31, y - size * .36); const b = Math.hypot(x - size * .68, y - size * .62); if (Math.min(a, b) > size * .25) cells[y][x] = 1; }
    }
    // A traversable causeway joins the two land areas.
    for (let y = Math.floor(size / 2) - 1; y <= Math.floor(size / 2) + 1; y++) for (let x = 3; x < size - 3; x++) cells[y][x] = 2;
    for (let y = 4; y < size - 4; y++) if (cells[y][Math.floor(size * .25)] !== 1) cells[y][Math.floor(size * .25)] = 2;
  }
  const spawns = [{ x: Math.floor(size * .23), y: Math.floor(size * .45) }, { x: Math.floor(size * .76), y: Math.floor(size * .55) }];
  for (const s of spawns) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) cells[s.y + dy][s.x + dx] = 0;
  for (const s of spawns) for (let i = 0; i < 18; i++) {
    const x = Math.min(size - 2, Math.max(1, s.x + 5 + Math.floor(r() * 4)));
    const y = Math.min(size - 2, Math.max(1, s.y - 4 + Math.floor(r() * 8)));
    if (cells[y][x] !== 1) cells[y][x] = 3;
  }
  return { version: 1, mode, title: "Crossing " + seed, seed, size, preset, cells, spawns, pieces: [], source: preset === "earth" ? features.length ? "OpenStreetMap · © OpenStreetMap contributors" : "Seeded fallback · no Earth data" : "Procedural terrain", ruleCommit: rosters.sources[mode].commit };
}
export function makePiece(scene: Scene, actorKey: string, faction: string, team: Team, point: Point): Piece {
  const actor = actorFor(actorKey);
  return { id: Math.max(0, ...scene.pieces.map(p => p.id)) + 1, actorKey, faction, team, x: Math.round(point.x), y: Math.round(point.y), health: maxHealth(actor), rank: "rookie", deployed: false, powered: true, flags: [] };
}
function covers(piece: Piece, x: number, y: number) { const [w, h] = dimensions(actorFor(piece.actorKey)); return x >= Math.round(piece.x) && x < Math.round(piece.x) + w && y >= Math.round(piece.y) && y < Math.round(piece.y) + h; }
export function placementIssue(scene: Scene, piece: Piece, pieces: Piece[] = scene.pieces) {
  if (!Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return "Enter finite map coordinates.";
  const actor = actorFor(piece.actorKey);
  if (actor.behavior.health === null) return "This is a building upgrade; install it on its host building in the game.";
  if (actor.mode !== scene.mode) return "This actor belongs to the other game mode.";
  if (pieces.length >= 160 && !pieces.some(p => p.id === piece.id)) return "This scene supports up to 160 actors.";
  const [w, h] = dimensions(actor);
  for (let y = Math.round(piece.y); y < Math.round(piece.y) + h; y++) for (let x = Math.round(piece.x); x < Math.round(piece.x) + w; x++) {
    if (x < 1 || y < 1 || x >= scene.size - 1 || y >= scene.size - 1) return "Keep the full footprint inside the map border.";
    if (domain(actor) !== "Air" && (scene.cells[y][x] === 1) !== actor.behavior.waterPlacement) return actor.behavior.waterPlacement ? "This actor needs water." : "Ground actors need land.";
    if (pieces.some(p => p.id !== piece.id && p.health > 0 && domain(actorFor(p.actorKey)) === domain(actor) && covers(p, x, y))) return "That space is occupied.";
  }
  return null;
}
export function paintScene(scene: Scene, point: Point, terrain: Terrain, radius = 1): Scene {
  const cells = scene.cells.map(row => [...row]);
  for (let y = Math.max(1, Math.round(point.y) - radius); y <= Math.min(scene.size - 2, Math.round(point.y) + radius); y++) for (let x = Math.max(1, Math.round(point.x) - radius); x <= Math.min(scene.size - 2, Math.round(point.x) + radius); x++) {
    // Protect placed actors and the start locations from accidental stranding.
    if (scene.pieces.some(p => p.health > 0 && covers(p, x, y)) || scene.spawns.some(p => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1)) continue;
    cells[y][x] = terrain;
  }
  return { ...scene, cells };
}
export function findPath(scene: Scene, piece: Piece, destination: Point, obstacles: Piece[] = scene.pieces): Point[] {
  if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y)) return [];
  const a = actorFor(piece.actorKey);
  if (isBuilding(a) || piece.deployed || !piece.powered || !(a.behavior.speed ?? 0)) return [];
  const target = { x: Math.round(destination.x), y: Math.round(destination.y) };
  if (target.x < 1 || target.y < 1 || target.x >= scene.size - 1 || target.y >= scene.size - 1) return [];
  if (domain(a) === "Air") return [target];
  const valid = (x: number, y: number) => x >= 1 && y >= 1 && x < scene.size - 1 && y < scene.size - 1 && (scene.cells[y][x] === 1) === (domain(a) === "Water") && !obstacles.some(p => p.id !== piece.id && p.health > 0 && isBuilding(actorFor(p.actorKey)) && covers(p, x, y));
  if (!valid(target.x, target.y)) return [];
  const start = Math.round(piece.y) * scene.size + Math.round(piece.x);
  const end = target.y * scene.size + target.x;
  const parent = new Int32Array(scene.size * scene.size).fill(-1);
  const queue = [start]; parent[start] = start;
  for (let i = 0; i < queue.length && parent[end] === -1; i++) {
    const x = queue[i] % scene.size, y = Math.floor(queue[i] / scene.size);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const xx = x + dx, yy = y + dy, next = yy * scene.size + xx;
      if (valid(xx, yy) && parent[next] === -1) { parent[next] = queue[i]; queue.push(next); }
    }
  }
  if (parent[end] === -1) return [];
  const points = [];
  for (let i = end; i !== start; i = parent[i]) points.push({ x: i % scene.size, y: Math.floor(i / scene.size) });
  return points.reverse();
}
export function createWorld(scene: Scene): World {
  return { scene, time: 0, log: [], shots: 0, damage: 0, destroyed: 0, auto: true, effects: [], pieces: scene.pieces.map(p => ({ ...p, flags: [...p.flags], home: { x: p.x, y: p.y }, order: { type: "idle" }, path: [], facing: p.team === "red" ? Math.PI : 0, cooldown: 0, pathRetry: 0, ammo: ammunition(actorFor(p.actorKey)), phase: p.health > 0 ? "ready" : "wreck", phaseTime: 0, kills: 0 })) };
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function log(world: World, message: string) { world.log.unshift(world.time.toFixed(1) + "s · " + message); if (world.log.length > 40) world.log.length = 40; }
export function issueOrder(world: World, id: number, order: Order): boolean {
  const piece = world.pieces.find(p => p.id === id);
  if (!piece || piece.health <= 0) return false;
  if (order.type === "attack") {
    const target = world.pieces.find(p => p.id === order.targetId);
    if (!target || target.health <= 0 || target.team === piece.team || target.team === "neutral" || !supportedWeapon(piece, target)) return false;
  }
  if (order.type === "move" && order.point) {
    if (!Number.isFinite(order.point.x) || !Number.isFinite(order.point.y)) return false;
    const path = findPath(world.scene, piece, order.point, world.pieces);
    if (!path.length && distance(piece, order.point) > .2) return false;
    piece.path = path;
  } else piece.path = [];
  piece.order = order; piece.pathRetry = 0;
  return true;
}
function move(piece: LivePiece, amount: number) {
  if (!piece.path.length) return;
  const next = piece.path[0], d = distance(piece, next);
  piece.facing = Math.atan2(next.y - piece.y, next.x - piece.x);
  if (d <= amount) { piece.x = next.x; piece.y = next.y; piece.path.shift(); }
  else { piece.x += (next.x - piece.x) / d * amount; piece.y += (next.y - piece.y) / d * amount; }
}
export function stepWorld(world: World, dt = .04): World {
  dt = Math.min(.1, Math.max(0, dt)); world.time += dt;
  const effectKeep: Effect[] = [];
  for (const effect of world.effects) {
    effect.life -= dt;
    if (effect.life > 0) { effectKeep.push(effect); continue; }
    if (effect.kind !== "projectile") continue;
    const victim = world.pieces.find(p => p.id === effect.target);
    if (!victim || victim.health <= 0) continue;
    const damage = Math.min(victim.health, effect.damage);
    victim.health -= damage; world.damage += damage;
    effectKeep.push({ ...effect, kind: "explosion", x: victim.x, y: victim.y, to: { x: victim.x, y: victim.y }, damage: 0, duration: .4, life: .4 });
    if (victim.health <= 0) {
      victim.path = []; victim.phase = domain(actorFor(victim.actorKey)) === "Air" ? "falling" : "wreck"; victim.phaseTime = 1.5;
      world.destroyed++; const killer = world.pieces.find(p => p.id === effect.from); if (killer) killer.kills++;
      log(world, actorFor(victim.actorKey).name + " destroyed");
    }
  }
  world.effects = effectKeep;
  for (const piece of world.pieces) {
    const actor = actorFor(piece.actorKey);
    if (piece.health <= 0) { if (piece.phase === "falling") { piece.phaseTime -= dt; piece.facing += dt * 4; piece.x += dt * .5; if (piece.phaseTime <= 0) { piece.phase = "wreck"; world.effects.push({ x: piece.x, y: piece.y, to: piece, from: piece.id, kind: "explosion", damage: 0, duration: .8, life: .8, color: "#ffc57b" }); } } continue; }
    if (!piece.powered) continue;
    piece.cooldown = Math.max(0, piece.cooldown - dt); piece.pathRetry = Math.max(0, piece.pathRetry - dt);
    const speed = Math.max(0, actor.behavior.speed ?? 0) * 25 / 1024 * multiplier(piece, "SpeedMultiplier") * dt;
    if (piece.phase === "exit" || piece.phase === "rearming") {
      piece.phaseTime -= dt;
      if (piece.phase === "exit") { piece.x = Math.max(1, Math.min(world.scene.size - 2, piece.x + Math.cos(piece.facing) * speed)); piece.y = Math.max(1, Math.min(world.scene.size - 2, piece.y + Math.sin(piece.facing) * speed)); if (piece.phaseTime <= 0) { piece.phase = piece.ammo === 0 ? "rearming" : "ready"; piece.path = piece.ammo === 0 ? [piece.home] : []; piece.phaseTime = 2; } }
      else { if (piece.path.length) { move(piece, speed); piece.phaseTime = 2; } else if (piece.phaseTime <= 0) { piece.ammo = ammunition(actor); piece.phase = "ready"; log(world, actor.name + " rearmed"); } }
      continue;
    }
    if (piece.order.type === "move") {
      move(piece, piece.deployed ? 0 : speed);
      if (!piece.path.length) piece.order = { type: "idle" };
      continue;
    }
    let target = piece.order.type === "attack" ? world.pieces.find(p => p.id === piece.order.targetId && p.health > 0) : undefined;
    if (!target && world.auto && piece.team !== "neutral") target = world.pieces.filter(p => p.health > 0 && p.team !== piece.team && p.team !== "neutral" && supportedWeapon(piece, p) && distance(piece, p) <= Math.max(12, prototypeRange(piece) + 3)).sort((a, b) => distance(piece, a) - distance(piece, b))[0];
    if (!target) { piece.path = []; continue; }
    const weapon = supportedWeapon(piece, target);
    if (!weapon) continue;
    const d = distance(piece, target);
    if (d >= (weapon.minRange ?? 0) && d <= (weapon.range ?? 0)) {
      piece.path = []; piece.facing = Math.atan2(target.y - piece.y, target.x - piece.x);
      if (piece.cooldown > 0 || piece.ammo === 0) continue;
      const amount = damageFor(piece, target, weapon);
      if (!amount) continue;
      const duration = weapon.projectile === "InstantHit" ? .04 : Math.max(.08, Math.min(1.2, d / (weapon.projectile === "Missile" ? 9 : 22)));
      world.effects.push({ x: piece.x, y: piece.y, to: { x: target.x, y: target.y }, target: target.id, from: piece.id, kind: "projectile", damage: amount, duration, life: duration, color: piece.team === "blue" ? "#a3dcff" : "#ffb385" });
      piece.cooldown = Math.max(.04, (weapon.reload ?? 25) / 25 * multiplier(piece, "ReloadDelayMultiplier"));
      world.shots++;
      if (piece.ammo !== null) piece.ammo = Math.max(0, piece.ammo - 1);
      if (actor.category === "aircraft" && actor.behavior.actions.some(a => a.id === "AttackAircraft")) { piece.phase = "exit"; piece.phaseTime = 1.25; }
      else if (actor.category === "aircraft" && piece.ammo === 0) { piece.phase = "rearming"; piece.path = [piece.home]; piece.phaseTime = 2; }
    } else if (!isBuilding(actor) && !piece.deployed && piece.order.type !== "hold") {
      if (piece.pathRetry <= 0) {
        const desiredRange = Math.max((weapon.minRange ?? 0) + .75, (weapon.range ?? 1) * .8);
        const angle = Math.atan2(piece.y - target.y, piece.x - target.x);
        const destination = { x: Math.round(target.x + Math.cos(angle) * desiredRange), y: Math.round(target.y + Math.sin(angle) * desiredRange) };
        piece.path = findPath(world.scene, piece, destination, world.pieces); piece.pathRetry = .75;
      }
      move(piece, speed);
    }
  }
  return world;
}
export function scenarioJson(scene: Scene) { return JSON.stringify(scene, null, 2); }
export function parseScene(text: string): Scene {
  if (text.length > 2_000_000) throw new Error("Scene file is too large.");
  const s = JSON.parse(text) as Scene;
  if (s.version !== 1 || !["ra", "ra2"].includes(s.mode) || ![64, 96, 128].includes(s.size) || !["river", "coast", "islands", "plains", "earth"].includes(s.preset) || !Number.isInteger(s.seed) || typeof s.title !== "string" || s.title.length > 80) throw new Error("Unsupported scene settings.");
  if (!Array.isArray(s.cells) || s.cells.length !== s.size || s.cells.some(row => !Array.isArray(row) || row.length !== s.size || row.some(c => ![0, 1, 2, 3].includes(c)))) throw new Error("Invalid terrain grid.");
  if (!Array.isArray(s.pieces) || s.pieces.length > 160 || new Set(s.pieces.map(p => p.id)).size !== s.pieces.length) throw new Error("Invalid actor list.");
  for (const p of s.pieces) {
    const a = actorFor(p.actorKey);
    if (a.mode !== s.mode || !Number.isInteger(p.id) || p.id < 1 || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isFinite(p.health) || p.health <= 0 || p.health > maxHealth(a) || !["blue", "red", "neutral"].includes(p.team) || !["rookie", "veteran", "elite"].includes(p.rank) || typeof p.deployed !== "boolean" || typeof p.powered !== "boolean" || !Array.isArray(p.flags) || p.flags.length > 32 || p.flags.some(f => typeof f !== "string" || !/^[\w-]{1,60}$/.test(f)) || !rosters.factions.some(f => f.mode === s.mode && f.id === p.faction && f.actors.includes(p.actorKey))) throw new Error("Invalid actor settings.");
    const issue = placementIssue(s, p); if (issue) throw new Error(a.name + ": " + issue);
  }
  if (!Array.isArray(s.spawns) || s.spawns.length !== 2 || s.spawns.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 1 || p.y < 1 || p.x >= s.size - 1 || p.y >= s.size - 1 || s.cells[p.y][p.x] === 1)) throw new Error("Invalid start locations.");
  // Reject unknown metadata fields instead of forwarding local paths or URLs.
  return { version: 1, mode: s.mode, title: s.title, seed: s.seed, size: s.size, preset: s.preset, cells: s.cells, pieces: s.pieces.map(p => ({ id: p.id, actorKey: p.actorKey, faction: p.faction, team: p.team, x: p.x, y: p.y, health: p.health, rank: p.rank, deployed: p.deployed, powered: p.powered, flags: [...p.flags] })), spawns: s.spawns, source: s.preset === "earth" ? "Imported Earth terrain" : "Procedural terrain", ruleCommit: rosters.sources[s.mode].commit };
}
