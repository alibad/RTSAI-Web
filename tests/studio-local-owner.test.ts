import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalOwnerContentHandler, type SharedContent } from '../lib/studio-content-server';

test('local owner needs a loopback peer, exact origin and per-launch capability; no sign-in required', async () => {
  const origin = 'http://127.0.0.1:3525';
  let saves = 0;
  const store = { read: async () => ({ revision: 'a'.repeat(64) } as SharedContent),
    edit: async () => { saves++; return {} as SharedContent; } };
  const handle = createLocalOwnerContentHandler(origin, store);
  const request = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(origin + path,
    { method, headers: { ...headers, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ entity: 'engineer', baseRevision: 'a'.repeat(64), cost: 625 }) } : {}) });
  const session = () => request('/api/studio/session', { 'X-RTSAI-Local': '1' });
  assert.equal((await handle(session(), '192.168.1.5')).status, 403);
  assert.equal((await handle(request('/api/studio/session'), '127.0.0.1')).status, 403);
  assert.equal((await handle(request('/api/studio/session', { 'X-RTSAI-Local': '1', origin: 'https://evil.example' }), '127.0.0.1')).status, 403);
  assert.equal((await handle(request('/api/studio/session', { 'X-RTSAI-Local': '1', 'sec-fetch-site': 'cross-site' }), '127.0.0.1')).status, 403);
  assert.equal((await handle(new Request('http://evil.example/api/studio/session', { headers: { 'X-RTSAI-Local': '1' } }), '127.0.0.1')).status, 403);
  const reply = await handle(session(), '127.0.0.1');
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  const { capability } = await reply.json();
  assert.match(capability, /^[a-f0-9]{64}$/);
  for (const token of ['', 'wrong', 'b'.repeat(64)])
    assert.equal((await handle(request('/api/studio/content', { 'X-RTSAI-Owner': token }, 'POST'), '127.0.0.1')).status, 403);
  const auth = { 'X-RTSAI-Owner': capability, origin };
  assert.equal((await handle(request('/api/studio/content', auth), '127.0.0.1')).status, 200);
  assert.equal((await handle(request('/api/studio/content', auth, 'POST'), '::ffff:127.0.0.1')).status, 200);
  assert.equal(saves, 1);
  const restarted = createLocalOwnerContentHandler(origin, store);
  assert.equal((await restarted(request('/api/studio/content', auth, 'POST'), '127.0.0.1')).status, 403);
  assert.equal(saves, 1);
});
