// Snapshot reviewed gameplay metadata only. No artwork, credentials, drafts or deployment.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = path.resolve(web, '../RTSAI-Mod');
const manifest = JSON.parse(execFileSync(process.env.RTSAI_CONTENT_PYTHON ?? 'python',
  [path.join(mod, 'tools/shared-content.py'), 'check', '--root', mod], { encoding: 'utf8' }));
const data = JSON.stringify(manifest, null, 2) + '\n';
const output = path.join(web, 'data/shared-content.generated.json');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(output, 'utf8').replaceAll('\r\n', '\n') !== data) throw new Error('Shared viewer revision is stale; run scripts/sync-shared-content.mjs');
} else fs.writeFileSync(output, data);
console.log(`Shared viewer content ${manifest.revision.slice(0, 12)}`);
