/** Reviewed local editing registry. Actor IDs and trait paths never come from a browser. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDefaultExperienceData } from '../lib/art-lab/classic';
import { child, childValue, traits } from '../lib/art-lab/miniyaml';
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
  const data = loadDefaultExperienceData(reader, { manifestPath: mode === 'classic' ? `${core}/mod.yaml` : 'mods/rtsai/mod.yaml', resolvePackage: mapPackage });
  const roster = computeRosters(data);
  for (const unit of new Map(roster.factions.flatMap(f => f.units.map(u => [u.id, u] as const))).values()) {
    const actor = data.rules.get(unit.id)!;
    const number = (trait: string, field: string) => { const v = childValue(child(actor, trait)?.value, field); return v && /^\d+$/.test(v) ? Number(v) : null; };
    const speedTrait = traits(actor, 'Mobile').length === 1 ? 'Mobile' : traits(actor, 'Aircraft').length === 1 ? 'Aircraft' : null;
    const baseline = { cost: number('Valued', 'Cost'), health: number('Health', 'HP'), speed: speedTrait ? number(speedTrait, 'Speed') : null };
    const ancestors = (id: string, trait: string, field: string, seen = new Set<string>()): string[] => {
      if (seen.has(id)) throw new Error(`Rule inheritance cycle: ${id}`);
      seen.add(id);
      const leaf = child(child(data.rules.get(id), trait)?.value, field);
      if (!leaf) return [];
      const parents = (data.rawRules?.get(id)?.nodes ?? []).filter(n => n.key === 'Inherits' || n.key.startsWith('Inherits@')).map(n => n.value.value?.toLowerCase()).filter((v): v is string => !!v);
      for (const parent of parents.reverse()) {
        if (child(child(data.rules.get(parent), trait)?.value, field)?.location === leaf.location)
          return [parent, ...ancestors(parent, trait, field, seen)];
      }
      return [];
    };
    const inheritance = { cost: ancestors(unit.id, 'Valued', 'Cost'), health: ancestors(unit.id, 'Health', 'HP'), speed: speedTrait ? ancestors(unit.id, speedTrait, 'Speed') : [] };
    const binding = { actor: data.ruleKeys.get(unit.id), baseline, speedTrait, inheritance };
    // Recovered Classic uses its own real actors on both platforms, without RA2 aliases.
    const bindings = mode === 'ra2' ? { 'ra2-desktop': binding, 'ra2-web': binding }
      : { 'classic-desktop': binding, 'classic-web': binding };
    registry[`${mode}:${unit.id}`] = { mode, actor: unit.id, name: unit.name, factions: roster.factions.filter(f => f.units.some(u => u.id === unit.id)).map(f => ({ id: f.id, name: f.name })), bindings };
  }
}
writeFileSync(resolve(mod, 'content/unit-bindings.json'), JSON.stringify({ schema: 1, units: registry }, null, 2) + '\n');
console.log(`Bound ${Object.keys(registry).length} units to explicit desktop/web targets.`);
