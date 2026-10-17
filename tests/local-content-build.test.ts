import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { localContentBuild } from '../lib/local-content-build';

test('only an unchanged receipt with all four verified targets can select a shared build', () => {
  const root = mkdtempSync(join(tmpdir(), 'rtsai-content-status-'));
  const web = join(root, 'RTSAI-Web'), recovery = join(root, 'RTSAI-Mod/.recovery');
  mkdirSync(web); mkdirSync(recovery, { recursive: true });
  const file = join(root, 'receipt.json'), pointer = join(recovery, 'content-current.json');
  const save = (verified: boolean, targets: string[]) => {
    writeFileSync(file, JSON.stringify({ buildId: 'fixture', revision: 'a'.repeat(64), verified, verification: { passed: verified, targets } }));
    writeFileSync(pointer, JSON.stringify({ receipt: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }));
  };
  try {
    assert.equal(localContentBuild(web), null);
    save(false, []); assert.throws(() => localContentBuild(web), /four content targets/);
    save(true, ['classic-desktop']); assert.throws(() => localContentBuild(web), /four content targets/);
    save(true, ['classic-desktop', 'classic-web', 'ra2-desktop', 'ra2-web']);
    assert.equal(localContentBuild(web)?.buildId, 'fixture');
    writeFileSync(file, '{}'); assert.throws(() => localContentBuild(web), /receipt changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
