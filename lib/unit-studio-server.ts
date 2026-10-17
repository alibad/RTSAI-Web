import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { UnitPreview } from './unit-content-types';
import { localContentBuild, contentCodeCurrent } from './local-content-build';

const run = promisify(execFile);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function createUnitStudioService(webRoot: string) {
  const modRoot = resolve(webRoot, '../RTSAI-Mod');
  let job: UnitPreview = { state: 'unbuilt' };
  const python = process.env.RTSAI_CONTENT_PYTHON ?? 'python';
  function command(args: string[], input?: unknown): Promise<unknown> {
    return new Promise((accept, reject) => {
      const child = execFile(python, [resolve(modRoot, 'tools/unit-content.py'), ...args, '--root', modRoot], { maxBuffer: 1024 * 1024, timeout: 20000 }, (error, stdout, stderr) => {
        if (error) { reject(Object.assign(error, { stderr })); return; }
        try { accept(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
      child.stdin?.end(input === undefined ? undefined : JSON.stringify(input));
    });
  }
  const status = async (): Promise<UnitPreview> => {
    const current = await command(['check']) as { revision: string };
    const build = localContentBuild(webRoot);
    const identity = { savedRevision: current.revision, revision: build?.revision, buildId: build?.buildId,
      builtAt: build?.builtAt, verifiedAt: build?.verifiedAt, verified: build?.verified ?? false, targets: build?.verification?.targets };
    if (job.state === 'building' || job.state === 'failed') return { ...job, ...identity };
    if (existsSync(resolve(modRoot, 'content/unit-preview.lock'))) return { state: 'building', ...identity };
    if (!build) return { state: 'unbuilt', ...identity };
    const ready = current.revision === build.revision && contentCodeCurrent(webRoot, build);
    return { state: ready ? 'ready' : 'outdated', ...identity, webUrl: '/play/',
      ...(!ready ? { error: 'Saved content or game code has changed. Build and verify all four targets again.' } : {}) };

  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/studio/unit') {
        if (request.method === 'GET') {
          const mode = url.searchParams.get('mode'), actor = url.searchParams.get('actor');
          if (!['classic', 'ra2'].includes(mode ?? '') || !/^[a-z0-9_.-]{1,64}$/.test(actor ?? '')) return json({ error: 'Choose a Classic or RA2 unit' }, 400);
          return json(await command(['view', '--unit', `${mode}:${actor}`]));
        }
        if (request.method === 'POST') return json(await command(['edit'], await request.json()));
      }
      if (url.pathname === '/api/studio/previews') {
        if (request.method === 'GET') return json(await status());
        if (request.method === 'POST') {
          if (job.state === 'building') return json(job);
          job = { state: 'building' };
          void run(python, [resolve(modRoot, 'tools/build-unit-preview.py'), '--web-root', webRoot], { maxBuffer: 256 * 1024, timeout: 900000 }).then(() => {
            job = { state: 'ready' };
          }).catch(() => { job = { state: 'failed', error: 'The preview build failed. Your saved modification is preserved.', log: '.cache/unit-preview-build.log' }; });
          return json(job, 202);
        }
      }
      if (url.pathname === '/api/studio/launch' && request.method === 'POST') {
        const body = await request.json();
        if (!body || Object.keys(body).join(',') !== 'mode' || !['classic', 'ra2'].includes(body.mode)) return json({ error: 'Invalid game mode' }, 400);
        if ((await status()).state !== 'ready') return json({ error: 'Build the current revision first' }, 409);
        const build = localContentBuild(webRoot)!;
        await run(process.execPath, [resolve(webRoot, '../RTSAI-WebGame/tools/local-game.mjs'), 'start'], { timeout: 120000 });
        const mod = body.mode === 'classic' ? 'rtsai-classic-core' : 'rtsai-ra2';
        const profile = JSON.parse((await run(python, [resolve(modRoot, 'tools/prepare-library-profile.py'), '--root', build.support, '--mode', mod])).stdout) as { support: string };
        const game = spawn(resolve(build.native, 'bin/OpenRA.exe'), [`Game.Mod=${mod}`, `Engine.EngineDir=${build.native}`, `Engine.ModSearchPaths=${resolve(build.native, 'mods')}`, `Engine.SupportDir=${profile.support}`, 'Game.FetchNews=false'], { cwd: build.native, detached: true, stdio: 'ignore', windowsHide: false,
          env: { ...process.env, OPENRA_AI_ROOT: resolve(webRoot, '../OpenRA-AI'), RTSAI_LIBRARY_SUPPORT: build.support } });
        await new Promise<void>((accept, reject) => { game.once('spawn', accept); game.once('error', reject); });
        game.unref();
        return json({ launched: true });
      }
      return json({ error: 'Method not allowed' }, 405);
    } catch (error) {
      const message = (error as { stderr?: string }).stderr ?? '';
      return json({ error: message.includes('changed since') || message.includes('being edited') ? 'Content changed. Reload before saving.' : 'The unit edit could not be applied. Check the selected unit and stat values.' }, message.includes('changed since') || message.includes('being edited') ? 409 : 400);
    }
  };
}
