/** Local pilot only. Verified Firebase UID authorization is independent of ADMIN_BUILD.
 * Game content stays in the canonical mod; saving never deploys or runs a build.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyFirebaseIdentity, type FirebaseIdentity } from './firebase-token';

const run = promisify(execFile);
export type SharedContent = {
  schema: number; revision: string; entity: string; overrideCost: number | null;
  targets: Record<string, { mod: string; actor: string; baselineCost: number; cost: number; rules: string; rulesSha256: string }>;
};
export type ContentStore = { read(): Promise<SharedContent>; edit(revision: string, cost: number | null): Promise<SharedContent> };

export function localContentStore(modRoot = resolve(process.cwd(), '../RTSAI-Mod')): ContentStore {
  const command = async (args: string[]) => {
    const result = await run(process.env.RTSAI_CONTENT_PYTHON ?? 'python',
      [resolve(modRoot, 'tools/shared-content.py'), ...args, '--root', modRoot], { maxBuffer: 256 * 1024, timeout: 15000 });
    return JSON.parse(result.stdout) as SharedContent;
  };
  return { read: () => command(['show']), edit: (revision, cost) => command(['edit', '--base-revision', revision,
    ...(cost === null ? ['--inherit'] : ['--cost', String(cost)])]) };
}

type Dependencies = {
  enabled(): boolean;
  verifyIdentity(request: Request): Promise<FirebaseIdentity | null>;
  administratorIds(): string[];
  store: ContentStore;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);

export function createStudioContentHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return json({ error: 'Not found' }, 404);
    if (!local(new URL(request.url).hostname)) return json({ error: 'Local authoring only' }, 403);
    const origin = request.headers.get('origin');
    if (origin) {
      try { if (new URL(origin).origin !== new URL(request.url).origin) return json({ error: 'Origin denied' }, 403); }
      catch { return json({ error: 'Origin denied' }, 403); }
    }
    const identity = await deps.verifyIdentity(request);
    if (!identity) return json({ error: 'Sign in as a Studio administrator' }, 401);
    if (!deps.administratorIds().includes(identity.uid)) return json({ error: 'Studio administrator access required' }, 403);
    try {
      if (request.method === 'GET') return json(await deps.store.read());
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
      const text = await request.text();
      if (text.length > 4096) return json({ error: 'Edit too large' }, 413);
      let body: Record<string, unknown>;
      try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!body || Object.keys(body).sort().join(',') !== 'baseRevision,cost,entity' || body.entity !== 'engineer'
        || typeof body.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.baseRevision)
        || (body.cost !== null && (!Number.isInteger(body.cost) || Number(body.cost) < 1 || Number(body.cost) > 100000)))
        return json({ error: 'Expected engineer, baseRevision and an integer cost (or null to inherit)' }, 400);
      return json(await deps.store.edit(body.baseRevision, body.cost as number | null));
    } catch (error) {
      const result = error as Error & { stderr?: string };
      if (result.stderr?.includes('changed since') || result.stderr?.includes('being edited'))
        return json({ error: 'Content changed. Reload before saving.' }, 409);
      return json({ error: 'Content could not be saved. The local build log contains the details.' }, 500);
    }
  };
}

export const studioContentHandler = createStudioContentHandler({
  // Never activate filesystem writes in a production/serverless deployment.
  enabled: () => process.env.NODE_ENV !== 'production' && process.env.RTSAI_STUDIO_LOCAL_WRITES === '1',
  verifyIdentity: verifyFirebaseIdentity,
  administratorIds: () => (process.env.RTSAI_STUDIO_ADMIN_UIDS ?? '').split(',').map(id => id.trim()).filter(Boolean),
  store: localContentStore(),
});

/** Only mounted by the loopback Node gateway, never by a website route. */
export function createLocalOwnerContentHandler(origin: string, store = localContentStore()) {
  const capability = randomBytes(32).toString('hex');
  const handler = createStudioContentHandler({ enabled: () => true,
    verifyIdentity: async () => ({ uid: 'local-owner', email: null, name: null }),
    administratorIds: () => ['local-owner'], store });
  return async (request: Request, peer: string | undefined): Promise<Response> => {
    const url = new URL(request.url);
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') || url.origin !== origin
      || (request.headers.has('origin') && request.headers.get('origin') !== origin)
      || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Local owner access only' }, 403);
    if (url.pathname === '/api/studio/session') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      // A foreign page cannot send this header without a CORS preflight, which we do not allow.
      if (request.headers.get('x-rtsai-local') !== '1') return json({ error: 'Local session required' }, 403);
      return json({ capability });
    }
    const supplied = Buffer.from(request.headers.get('x-rtsai-owner') ?? '');
    const expected = Buffer.from(capability);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return json({ error: 'Reload the local Studio session' }, 403);
    return handler(request);
  };
}
