"use client";

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import type { SharedContent } from '../../lib/studio-content-server';

export function SharedContentEditor() {
  const { user, openAuth } = useAuth();
  const [content, setContent] = useState<SharedContent | null>(null);
  const [cost, setCost] = useState('');
  const [notice, setNotice] = useState('Sign in, then load the shared revision. Only configured Studio administrators can edit.');
  const [busy, setBusy] = useState(false);
  async function request(save: boolean, inherit = false) {
    if (!user) { openAuth('Sign in as a Studio administrator'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/studio/content', {
        method: save ? 'POST' : 'GET', headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        ...(save ? { body: JSON.stringify({ entity: content?.entity, baseRevision: content?.revision, cost: inherit ? null : Number(cost) }) } : {}),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? 'Shared content is unavailable.');
      setContent(next); setCost(next.overrideCost === null ? '' : String(next.overrideCost));
      setNotice(save ? 'Revision saved locally. Build the desktop and web previews to play it. Nothing was published.' : 'Loaded the current shared revision.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load content.'); }
    finally { setBusy(false); }
  }
  return <section className="shared-content-editor">
    <p className="shared-content-eyebrow">STUDIO · ADMIN AUTHORING</p>
    <h1>One edit. Both foundations.</h1>
    <p>Edit the shared unit cost, with explicit Classic and RA2 bindings. Original rules, artwork and review history stay preserved.</p>
    <button type="button" disabled={busy} onClick={() => void request(false)}>{user ? 'Load shared content' : 'Sign in to edit'}</button>
    <p role="status" aria-live="polite">{notice}</p>
    {content && <>
      <div className="shared-content-revision"><strong>{content.entity}</strong><span>Revision {content.revision.slice(0, 12)}</span><span>Local · not published</span></div>
      <form onSubmit={event => { event.preventDefault(); void request(true); }}>
        <label htmlFor="shared-cost">Shared build cost</label>
        <div className="shared-content-actions"><input id="shared-cost" type="number" inputMode="numeric" min="1" max="100000" step="1" required value={cost} onChange={event => setCost(event.target.value)} />
          <button disabled={busy}>Save revision</button><button type="button" disabled={busy} onClick={() => void request(true, true)}>Use foundation values</button></div>
      </form>
      <table><caption>Compiled targets for this revision</caption><thead><tr><th>Target</th><th>Actor</th><th>Foundation cost</th><th>Revision cost</th></tr></thead><tbody>
        {Object.entries(content.targets).map(([id, target]) => <tr key={id}><th>{id}</th><td>{target.actor}</td><td>{target.baselineCost}</td><td>{target.cost}</td></tr>)}
      </tbody></table>
      <p className="shared-content-note">Classic web currently uses the preserved top-down adapter. Matching this edit proves the content binding; it does not establish complete gameplay parity with desktop Classic.</p>
    </>}
  </section>;
}
