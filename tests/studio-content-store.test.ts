import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createStudioContentHandler, localContentStore } from '../lib/studio-content-server';
import { sharedUnitCost, sharedContentRevision } from '../lib/shared-content';
import { viewerFaction } from '../lib/viewer';

test('a verified administrator edit crosses the real Python compiler boundary and preserves foundation values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rtsai-shared-content-'));
  assert.ok(root.startsWith(join(tmpdir(), 'rtsai-shared-content-')));
  try {
    const mod = resolve('../RTSAI-Mod');
    const source = JSON.parse(await readFile(join(mod, 'content/shared-content.json'), 'utf8'));
    await mkdir(join(root, 'tools'), { recursive: true });
    await mkdir(join(root, 'content'), { recursive: true });
    await copyFile(join(mod, 'tools/shared-content.py'), join(root, 'tools/shared-content.py'));
    await writeFile(join(root, 'content/shared-content.json'), JSON.stringify(source));
    for (const [id, target] of Object.entries(source.entities.engineer.bindings) as [string, { mod: string }][]) {
      const dir = join(root, 'mods', target.mod);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'mod.yaml'), `Metadata:\n\tTitle: fixture\nRules:\n\tra2|shared-content/${id}.yaml\n\nSequences:\n`);
    }
    const store = localContentStore(root);
    const initial = await store.read();
    const handler = createStudioContentHandler({ enabled: () => true, verifyIdentity: async () => ({ uid: 'owner-fixture', email: null, name: null }),
      administratorIds: () => ['owner-fixture'], store });
    const reply = await handler(new Request('http://localhost/api/studio/content', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity: 'engineer', cost: 630, baseRevision: initial.revision }) }));
    assert.equal(reply.status, 200);
    const changed = await store.read();
    assert.notEqual(changed.revision, initial.revision);
    assert.deepEqual(Object.values(changed.targets).map(t => t.cost), [630, 630, 630, 630]);
    assert.match(await readFile(join(root, 'mods/rtsai/shared-content/classic-desktop.yaml'), 'utf8'), /E6:\n\tValued:\n\t\tCost: 630/);
    assert.equal(JSON.parse(await readFile(join(root, `content/revisions/${initial.revision}.json`), 'utf8')).entities.engineer.cost, initial.overrideCost);
    const restored = await store.edit(changed.revision, null);
    assert.deepEqual(Object.values(restored.targets).map(t => t.cost), [400, 500, 500, 500]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('viewer uses explicit mode bindings without changing unrelated units', () => {
  assert.match(sharedContentRevision, /^[a-f0-9]{64}$/);
  assert.equal(sharedUnitCost('classic', 'E6', 400), 650);
  assert.equal(sharedUnitCost('ra2', 'engineer', 500), 700);
  assert.equal(sharedUnitCost('classic', 'engineer', 123), 123);
  assert.equal(sharedUnitCost('ra2', 'e1', 100), 100);
  const engineer = viewerFaction('america')?.units.find(unit => unit.id === 'engineer');
  assert.equal(engineer?.cost, 700);
  assert.match(engineer?.stats.find(stat => stat.id === 'health')?.display ?? '', /^100 HP/);
  assert.equal(engineer?.stats.find(stat => stat.id === 'speed')?.display, '66');
});
