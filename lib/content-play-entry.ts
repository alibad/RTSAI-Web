import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { localContentBuild, contentCodeCurrent } from './local-content-build';
const run = promisify(execFile);

/** New sessions use the shared candidate. Old asset URLs keep their existing server and rules. */
export function contentPlayEntry(webRoot: string, fallback: (req: IncomingMessage, res: ServerResponse) => void) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!['/play', '/play/'].includes(url.pathname) || req.method !== 'GET') return fallback(req, res);
    try {
      const build = localContentBuild(webRoot);
      if (!build) return fallback(req, res);
      const current = JSON.parse((await run('python', [resolve(webRoot, '../RTSAI-Mod/tools/unit-content.py'), 'check'])).stdout) as { revision: string };
      if (current.revision !== build.revision || !contentCodeCurrent(webRoot, build)) throw Error('Saved content or code changed. Build & test locally in Studio first.');
      const result = JSON.parse((await run(process.execPath, [resolve(webRoot, '../RTSAI-WebGame/tools/local-game.mjs'), 'start'], { timeout: 120000, maxBuffer: 1024 * 1024 })).stdout) as { url: string; buildId: string };
      if (result.buildId !== build.buildId) throw Error('The local launcher selected a different content build.');
      const target = new URL(result.url); target.search = url.search;
      if (!target.searchParams.has('profile')) target.searchParams.set('profile', url.searchParams.get('game') === 'classic' ? 'public-classic' : 'public');
      res.writeHead(302, { location: target.href, 'cache-control': 'no-store' }).end();
    } catch {
      res.writeHead(409, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end('<!doctype html><title>Build current content</title><p>The saved content or game code needs a new verified build. Your existing games and edits are preserved.</p><p><a href="/art/review">Open Faction Studio</a> and choose Build &amp; test locally.</p>');
    }
  };
}
