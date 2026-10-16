import { execFile, spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { UnitPreview } from './unit-content-types';

const run = promisify(execFile);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function createUnitStudioService(webRoot: string) {
  const modRoot = resolve(webRoot, '../RTSAI-Mod');
  const latest = resolve(webRoot, '.cache/unit-preview-latest.json');
  let job: UnitPreview = { state: 'unbuilt' };
  let preview: { revision: string; webUrl: string; native: string; support: string; webPid: number } | null = null;
  if (existsSync(latest)) { try { preview = JSON.parse(readFileSync(latest, 'utf8')); } catch { /* no valid preview */ } }
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
    if (job.state === 'building' || job.state === 'failed') return job;
    if (!preview) return { state: 'unbuilt' };
    try { process.kill(preview.webPid, 0); } catch { return { state: 'outdated', revision: preview.revision, error: 'Restart local previews to open the web game.' }; }
    const current = await command(['check']) as { revision: string };
    return { state: current.revision === preview.revision ? 'ready' : 'outdated', revision: preview.revision, webUrl: preview.webUrl };
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
          void run(python, [resolve(modRoot, 'tools/build-unit-preview.py'), '--web-root', webRoot], { maxBuffer: 256 * 1024, timeout: 300000 }).then(() => {
            preview = JSON.parse(readFileSync(latest, 'utf8')); job = { state: 'ready' };
          }).catch(() => { job = { state: 'failed', error: 'The preview build failed. Your saved modification is preserved.', log: '.cache/unit-preview-build.log' }; });
          return json(job, 202);
        }
      }
      if (url.pathname === '/api/studio/launch' && request.method === 'POST') {
        const body = await request.json();
        if (!body || Object.keys(body).join(',') !== 'mode' || !['classic', 'ra2'].includes(body.mode)) return json({ error: 'Invalid game mode' }, 400);
        if (!preview || (await status()).state !== 'ready') return json({ error: 'Build the current revision first' }, 409);
        const game = spawn(resolve(preview.native, 'bin/OpenRA.exe'), [`Game.Mod=${body.mode === 'classic' ? 'rtsai-classic-core' : 'rtsai-ra2'}`, `Engine.EngineDir=${preview.native}`, `Engine.ModSearchPaths=${resolve(preview.native, 'mods')}`, `Engine.SupportDir=${preview.support}`, 'Game.FetchNews=false'], { cwd: preview.native, detached: true, stdio: 'ignore', windowsHide: false });
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
