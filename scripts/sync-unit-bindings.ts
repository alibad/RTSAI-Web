/** Reviewed local editing registry. Actor IDs and trait paths never come from a browser. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadModData } from '../lib/art-lab/resolve';
import { child, childValue, traits, parseMiniYaml } from '../lib/art-lab/miniyaml';
import { computeRosters } from '../lib/art-lab/roster';

const mod = resolve('../RTSAI-Mod');
const engine = resolve('../OpenRA');
const reader = {
  text: (p: string) => /shared-content\/|unit-overrides\//.test(p) ? '# baseline' : readFileSync(resolve(mod, p), 'utf8'),
  bytes: (p: string) => new Uint8Array(readFileSync(resolve(mod, p))),
  exists: (p: string) => existsSync(resolve(mod, p)),
};
const registry: Record<string, unknown> = {};
for (const mode of ['classic', 'ra2'] as const) {
  const core = 'mods/rtsai-classic-core';
  const mapPackage = (ref: string) => {
    const [pkg, rest] = ref.split('|');
    const path = pkg === 'ra' ? `${core}/${rest}` : pkg === 'ra2' ? `mods/rtsai/${rest}`
      : pkg === 'common' ? `${engine}/mods/common/${rest}` : null;
    return { path, reason: path ? null : 'not a local rules package' };
  };
  const extra: Partial<Record<'Rules' | 'Weapons' | 'Sequences', string[]>> = {};
  if (mode === 'classic') {
    const catalog = parseMiniYaml(reader.text(`${core}/experiences.yaml`))[0].value;
    const components = child(catalog, 'Components')?.value;
    const profile = child(child(catalog, 'Profiles')?.value, childValue(catalog, 'DefaultProfile')!)?.value;
    const selected = new Set<string>();
    const list = (s: string | null) => (s ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const visit = (id: string) => { if (selected.has(id)) return; selected.add(id); for (const dep of list(childValue(child(components, id)?.value, 'Dependencies'))) visit(dep); };
    for (const id of list(childValue(profile, 'Components'))) visit(id);
    for (const key of ['Rules', 'Weapons', 'Sequences'] as const)
      extra[key] = (components?.nodes ?? []).filter(n => selected.has(n.key)).flatMap(n => list(childValue(n.value, key)));
  }
  const data = loadModData(reader, { manifestPath: mode === 'classic' ? `${core}/mod.yaml` : 'mods/rtsai/mod.yaml', resolvePackage: mapPackage, extra });
  const roster = computeRosters(data);
  for (const unit of new Map(roster.factions.flatMap(f => f.units.map(u => [u.id, u] as const))).values()) {
    const actor = data.rules.get(unit.id)!;
    const number = (trait: string, field: string) => { const v = childValue(child(actor, trait)?.value, field); return v && /^\d+$/.test(v) ? Number(v) : null; };
    const speedTrait = traits(actor, 'Mobile').length === 1 ? 'Mobile' : traits(actor, 'Aircraft').length === 1 ? 'Aircraft' : null;
    const baseline = { cost: number('Valued', 'Cost'), health: number('Health', 'HP'), speed: speedTrait ? number(speedTrait, 'Speed') : null };
    const binding = { actor: data.ruleKeys.get(unit.id), baseline, speedTrait };
    // The top-down browser adapter shares RA2 actors. Only the Engineer mapping has been verified for Classic.
    const bindings = mode === 'ra2' ? { 'ra2-desktop': binding, 'ra2-web': binding }
      : { 'classic-desktop': binding, ...(unit.id === 'e6' ? { 'classic-web': { actor: 'engineer', baseline: { cost: 500, health: 10000, speed: 60 }, speedTrait: 'Mobile' } } : {}) };
    registry[`${mode}:${unit.id}`] = { mode, actor: unit.id, name: unit.name, factions: roster.factions.filter(f => f.units.some(u => u.id === unit.id)).map(f => ({ id: f.id, name: f.name })), bindings };
  }
}
// Resolve the reviewed Classic web mapping's values from the actual RA2 adapter rules as well.
const engineer = registry['ra2:engineer'] as { bindings: Record<string, unknown> };
const classicEngineer = registry['classic:e6'] as { bindings: Record<string, unknown> };
if (engineer && classicEngineer) classicEngineer.bindings['classic-web'] = engineer.bindings['ra2-web'];
writeFileSync(resolve(mod, 'content/unit-bindings.json'), JSON.stringify({ schema: 1, units: registry }, null, 2) + '\n');
console.log(`Bound ${Object.keys(registry).length} units to explicit desktop/web targets.`);
