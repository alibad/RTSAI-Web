/** Add project-owned source renders. Never opens original game content. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const catalog = JSON.parse(await readFile(resolve('../OpenRA-AI/catalog/factions.json'), 'utf8'));
const manifestPath = resolve('public/game-media/manifest.json');
const assets = JSON.parse(await readFile(manifestPath, 'utf8')).filter(a => !['israel','hezbollah'].includes(a.faction));
for (const faction of catalog.factions.filter(f => ['israel','hezbollah'].includes(f.id))) {
  const file = resolve(`../RTSAI-Mod/mods/rtsai/modern-factions/${faction.id}-art/source-art-review.png`);
  const bytes = await readFile(file);
  const heroName = `${faction.id}-roster.${createHash('sha256').update(bytes).digest('hex').slice(0,12)}.png`;
  await mkdir(resolve(`public/game-media/${faction.id}`),{recursive:true});
  await writeFile(resolve(`public/game-media/${faction.id}/${heroName}`),bytes);
  assets.push({id: faction.heroAssetId, faction: faction.id, title: `${faction.name} authored roster`, category: 'concept', detail: 'Measured source renders; native visual approval pending', validation: 'Source artwork', src: `/game-media/${faction.id}/${heroName}`, width:1000,height:860,bytes:bytes.length,sourcePath:`../RTSAI-Mod/mods/rtsai/modern-factions/${faction.id}-art/source-art-review.png`});
  for (const unit of catalog.units.filter(u => u.factionId === faction.id)) {
    const sourceView = resolve(`../RTSAI-Art/rebuild/levant-media/${unit.variants.ra2.actorId}.png`);
    const viewBytes = await readFile(sourceView);
    const viewName = `${unit.id}-source.${createHash('sha256').update(viewBytes).digest('hex').slice(0,12)}.png`;
    await writeFile(resolve(`public/game-media/${faction.id}/${viewName}`),viewBytes);
    assets.push({id:unit.assetIds[0],faction:faction.id,title:`${unit.name} authored source render`,category:'unit',detail:'Original CPU-authored geometry; native visual approval pending',validation:'Source artwork',src:`/game-media/${faction.id}/${viewName}`,width:240,height:192,bytes:viewBytes.length,sourcePath:`../RTSAI-Art/rebuild/levant-media/${unit.variants.ra2.actorId}.png`});
    const source = resolve(`../RTSAI-Mod/mods/rtsai/modern-factions/icons/${unit.variants.ra2.actorId}.png`);
    const image = await readFile(source); const hash=createHash('sha256').update(image).digest('hex').slice(0,12);
    const name=`${unit.id}.${hash}.png`; const dir=resolve(`public/game-media/${faction.id}`);await mkdir(dir,{recursive:true});await writeFile(resolve(dir,name),image);
    assets.push({id:unit.assetIds[1],faction:faction.id,title:`${unit.name} production cameo`,category:'cameo',detail:'Authored source render; final art approval pending',validation:'Source artwork',src:`/game-media/${faction.id}/${name}`,width:60,height:48,bytes:(await stat(source)).size,sourcePath:`../RTSAI-Mod/mods/rtsai/modern-factions/icons/${unit.variants.ra2.actorId}.png`});
  }
}
for (const asset of assets.filter(a=>['israel','hezbollah'].includes(a.faction))) asset.nativeApproval='pending';
assets.sort((a,b)=>a.faction.localeCompare(b.faction)||a.id.localeCompare(b.id));
await writeFile(manifestPath,JSON.stringify(assets,null,2)+'\n');
await writeFile(resolve('lib/game-media.generated.ts'),'// Generated from the project-owned media manifest.\nexport const gameMedia = '+JSON.stringify(assets,null,2)+' as const;\n');
console.log(`Added ${assets.filter(a=>['israel','hezbollah'].includes(a.faction)).length} owned media records`);
