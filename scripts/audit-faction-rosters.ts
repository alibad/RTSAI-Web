/** Export Studio's exact roster and its source rules for comparison with the independent native engine audit. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDefaultExperienceData } from '../lib/art-lab/classic';
import { child, childValue, traits } from '../lib/art-lab/miniyaml';
import { computeRosters } from '../lib/art-lab/roster';

const mod = resolve('../RTSAI-Mod'), engine = resolve('../OpenRA');
const reader = { text: (p: string) => readFileSync(resolve(mod, p), 'utf8'), bytes: (p: string) => new Uint8Array(readFileSync(resolve(mod, p))), exists: (p: string) => existsSync(resolve(mod, p)) };
const output = process.argv[2];
if (!output) throw Error('Usage: node --import tsx scripts/audit-faction-rosters.ts <output.json>');
const modes = Object.fromEntries((['classic', 'ra2'] as const).map(mode => {
  const core = 'mods/rtsai-classic-core';
  const data = loadDefaultExperienceData(reader, { manifestPath: mode === 'classic' ? `${core}/mod.yaml` : 'mods/rtsai/mod.yaml', resolvePackage: ref => {
    const [pkg, rest] = ref.split('|');
    const path = pkg === 'ra' ? `${core}/${rest}` : pkg === 'ra2' ? `mods/rtsai/${rest}` : pkg === 'common' ? `${engine}/mods/common/${rest}` : null;
    return { path, reason: path ? null : 'not local' };
  } });
  const roster = computeRosters(data);
  const deployments = Object.fromEntries(roster.factions.map(f => [f.id, [...new Set(traits(data.rules.get('world')!, 'StartingUnits')
    .filter(([, n]) => !childValue(n.value, 'Factions') || childValue(n.value, 'Factions')!.split(',').map(x => x.trim()).includes(f.id))
    .flatMap(([, n]) => traits(data.rules.get((childValue(n.value, 'BaseActor') ?? '').toLowerCase()) ?? { value: null, nodes: [] }, 'Transforms')
      .map(([, t]) => childValue(t.value, 'IntoActor')?.toLowerCase()).filter((id): id is string => !!id && !!child(data.rules.get(id), 'Building'))))].sort()]));
  const actors = Object.fromEntries([...data.rules].filter(([id]) => !id.startsWith('^')).map(([id, actor]) => {
    const tooltip = traits(actor, 'Tooltip').find(([, n]) => !childValue(n.value, 'RequiresCondition'))?.[1]?.value ?? child(actor, 'DisguiseTooltip')?.value;
    const nameKey = childValue(tooltip, 'Name');
    return [id, { nameKey, name: nameKey ? data.messages.get(nameKey) : null, source: data.ruleSources.get(id),
      prerequisites: childValue(child(actor, 'Buildable')?.value, 'Prerequisites'),
      queue: childValue(child(actor, 'Buildable')?.value, 'Queue'),
      tooltipTraits: actor.nodes.filter(n => /Tooltip/.test(n.key)).map(n => ({ trait: n.key, name: childValue(n.value, 'Name'), condition: childValue(n.value, 'RequiresCondition') })) }];
  }));
  return [mode, { ...roster, actors, deployments }];
}));
writeFileSync(output, JSON.stringify({ schema: 1, modes }, null, 2) + '\n');
console.log(Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, { factions: m.factions.length, units: new Set(m.factions.flatMap(f => f.units.map(u => u.id))).size }])));
