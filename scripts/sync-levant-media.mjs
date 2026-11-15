/**
 * Israel and Lebanon dossier media, from the approved (promoted) art. Never opens original game content.
 * - roster: the faction lineup that scripts/export-faction-art.py composites from the approved unit renders
 *   (data/faction-art.json); run `npm run sync:faction-art` first when the art changes.
 * - <unit>-source: the approved unit render (RTSAI-Art units/<actor>/candidates/cameo-v3-render/render-x4.png, the
 *   render behind the installed cameo).
 * - <unit>-cameo: the installed build-menu cameo (RTSAI-Mod mods/rtsai/modern-factions/icons/<actor>.png).
 * Runs after scripts/sync-game-media.mjs, which rewrites the rest of public/game-media.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const games = resolve(web, '..');
const art = resolve(process.env.RTSAI_ART_DIR ?? join(games, 'RTSAI-Art'));
const mod = resolve(process.env.RTSAI_MOD_DIR ?? join(games, 'RTSAI-Mod'));
const levant = ['israel', 'lebanon'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
const fromGames = path => '../' + path.slice(games.length + 1).replaceAll('\\', '/');

const catalog = JSON.parse(await readFile(join(mod, 'catalog/factions.json'), 'utf8'));
const factionArt = JSON.parse(await readFile(join(web, 'data/faction-art.json'), 'utf8'));
const manifestPath = join(web, 'public/game-media/manifest.json');
const assets = JSON.parse(await readFile(manifestPath, 'utf8')).filter(a => !levant.includes(a.faction));

async function publish(faction, stem, bytes, ext) {
  const name = `${stem}.${hash(bytes)}.${ext}`;
  await writeFile(join(web, 'public/game-media', faction, name), bytes);
  return { src: `/game-media/${faction}/${name}`, bytes: bytes.length };
}
async function read(path) {
  if (!existsSync(path)) throw new Error(`Missing approved art: ${path}`);
  return readFile(path);
}

for (const faction of catalog.factions.filter(f => levant.includes(f.id))) {
  const dir = join(web, 'public/game-media', faction.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const lineup = factionArt.lineups[faction.id];
  if (!lineup) throw new Error(`No faction lineup for ${faction.id}; run npm run sync:faction-art`);
  const widest = String(Math.max(...Object.keys(lineup.webp).map(Number)));
  const hero = await publish(faction.id, `${faction.id}-roster`, await read(join(web, 'public', lineup.webp[widest])), 'webp');
  assets.push({ id: faction.heroAssetId, faction: faction.id, title: `${faction.name} lineup`, category: 'concept', detail: 'Faction lineup rendered from the approved 3D models', validation: 'Source artwork',
    ...hero, width: Number(widest), height: Math.round(Number(widest) * lineup.height / lineup.width),
    sourcePath: `../RTSAI-Art/units/{${lineup.actors.join(',')}}/candidates/cameo-v3-render (lineup by scripts/export-faction-art.py)` });
  for (const unit of catalog.units.filter(u => u.factionId === faction.id)) {
    const actor = unit.variants.ra2.actorId;
    const renderPath = join(art, 'units', actor, 'candidates/cameo-v3-render/render-x4.png');
    const render = await publish(faction.id, `${unit.id}-source`, await read(renderPath), 'png');
    assets.push({ id: unit.assetIds[0], faction: faction.id, title: `${unit.name} render`, category: 'unit', detail: 'Rendered from the approved 3D model', validation: 'Source artwork', ...render, width: 240, height: 192, sourcePath: fromGames(renderPath) });
    const iconPath = join(mod, 'mods/rtsai/modern-factions/icons', `${actor}.png`);
    const icon = await publish(faction.id, unit.id, await read(iconPath), 'png');
    assets.push({ id: unit.assetIds[1], faction: faction.id, title: `${unit.name} production cameo`, category: 'cameo', detail: 'Installed build-menu cameo', validation: 'Shipped asset', ...icon, width: 60, height: 48, sourcePath: fromGames(iconPath) });
  }
  const written = new Set(assets.filter(a => a.faction === faction.id).map(a => a.src.split('/').pop()));
  for (const file of await readdir(dir)) if (!written.has(file)) await rm(join(dir, file));
}
assets.sort((a, b) => a.faction.localeCompare(b.faction) || a.id.localeCompare(b.id));
await writeFile(manifestPath, JSON.stringify(assets, null, 2) + '\n');
await writeFile(join(web, 'lib/game-media.generated.ts'), '// Generated from the project-owned media manifest.\nexport const gameMedia = ' + JSON.stringify(assets, null, 2) + ' as const;\n');
console.log(`Added ${assets.filter(a => levant.includes(a.faction)).length} Levant media records from the approved art`);
