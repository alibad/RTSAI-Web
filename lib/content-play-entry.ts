import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { localContentBuild, contentCodeCurrent } from './local-content-build';
const run = promisify(execFile);

/**
 * The local game is closed (its code or content changed since the last tested build): say so, and offer the released
 * game, which has the same simulator and takes the same link.
 */
export function closedPage(search: string) {
  const query = search.replace(/&/g, '&amp;').replace(/"/g, '%22').replace(/</g, '%3C');
  const button = 'display:inline-block;padding:10px 16px;border-radius:8px;font-weight:700;text-decoration:none';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The local game needs a new build</title></head>`
    + `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0e110e;color:#f0eee6;font:16px/1.5 Arial,sans-serif"><main style="max-width:540px;padding:32px">`
    + `<h1 style="margin:0 0 12px;font-size:22px;color:#f1d28b">The local game needs a new build</h1>`
    + `<p style="margin:0 0 22px;color:#a9a99d">The game's code or content changed since the last tested build on this PC, so the local game stays closed until it is built and tested again. Your games and edits are safe.</p>`
    + `<p style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px"><a style="${button};background:#f1d28b;color:#111711" href="https://rtsai.net/play/${query}">Open it in the released game</a>`
    + `<a style="${button};border:1px solid rgba(240,238,230,.26);color:#f0eee6" href="/art/review">Back to the Studio</a></p>`
    + `<p style="margin:0;font-size:13px;color:#7d8176">To open the local game again: in the Faction Studio, choose Build &amp; test locally.</p></main></body></html>`;
}

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
      const target = new URL(result.url);
      // Retain the runtime chosen by the verified launcher when adding entry options.
      url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
      if (!target.searchParams.has('profile')) target.searchParams.set('profile', url.searchParams.get('game') === 'classic' ? 'public-classic' : 'public');
      res.writeHead(302, { location: target.href, 'cache-control': 'no-store' }).end();
    } catch {
      res.writeHead(409, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(closedPage(url.search));
    }
  };
}
