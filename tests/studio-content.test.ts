import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudioContentHandler, type SharedContent } from '../lib/studio-content-server';

test('only a verified administrator can read or edit; build flags and client identity do not grant access', async () => {
  let saves = 0;
  const handler = (enabled = true) => createStudioContentHandler({ enabled: () => enabled,
    verifyIdentity: async request => {
      const token = request.headers.get('authorization');
      return token === 'Bearer admin-test' ? { uid: 'owner', email: null, name: null }
        : token === 'Bearer member-test' ? { uid: 'member', email: null, name: null } : null;
    }, administratorIds: () => ['owner'],
    store: { read: async () => ({ revision: 'a'.repeat(64) } as SharedContent), edit: async () => { saves++; return {} as SharedContent; } },
  });
  const request = (token = '', body?: unknown, origin = 'http://localhost:3461') => new Request('http://localhost:3461/api/studio/content', {
    method: body === undefined ? 'GET' : 'POST', headers: { authorization: token, origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const edit = { entity: 'engineer', baseRevision: 'a'.repeat(64), cost: 625 };
  assert.equal((await handler(false)(request('Bearer admin-test', edit))).status, 404);
  assert.equal((await handler()(request('', edit))).status, 401);
  assert.equal((await handler()(request('Bearer member-test', edit))).status, 403);
  assert.equal((await handler()(request('Bearer admin-test', edit, 'https://other.example'))).status, 403);
  assert.equal(saves, 0);
  assert.equal((await handler()(request('Bearer admin-test'))).status, 200);
  assert.equal((await handler()(request('Bearer admin-test', edit))).status, 200);
  assert.equal(saves, 1);
  for (const body of [{ ...edit, cost: 0 }, { ...edit, cost: '625' }, { ...edit, path: '../secret' }, { ...edit, entity: '../engineer' }])
    assert.equal((await handler()(request('Bearer admin-test', body))).status, 400);
  assert.equal(saves, 1);
});

test('an outdated edit reports a conflict instead of overwriting another revision', async () => {
  const handler = createStudioContentHandler({ enabled: () => true, verifyIdentity: async () => ({ uid: 'owner', email: null, name: null }),
    administratorIds: () => ['owner'], store: { read: async () => ({} as SharedContent), edit: async () => { throw Object.assign(new Error('conflict'), { stderr: 'Content changed since it was opened' }); } },
  });
  assert.equal((await handler(new Request('http://localhost/api/studio/content', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity: 'engineer', baseRevision: 'a'.repeat(64), cost: 625 }) }))).status, 409);
});
