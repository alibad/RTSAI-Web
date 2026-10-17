"use client";
import { useEffect, useId, useState } from 'react';
import { Check, RotateCcw, Save, Play, Monitor, Globe, RefreshCw } from 'lucide-react';
import { ownerRequest } from '../../../../lib/studio-owner-client';
import type { UnitContent, UnitPreview, UnitStat, UnitValues } from '../../../../lib/unit-content-types';
import './unit-gameplay.css';

const fields: { id: UnitStat; label: string; max: number; hint: string }[] = [
  { id: 'cost', label: 'Build cost', max: 100000, hint: 'credits' },
  { id: 'health', label: 'Health', max: 10000000, hint: 'engine HP' },
  { id: 'speed', label: 'Movement speed', max: 1000, hint: 'engine units / tick' },
];
const drafts = new Map<string, { revision: string; values: Record<UnitStat, string> }>();
const title = (mode: string) => mode === 'classic' ? 'Classic' : 'RA2';

export function UnitGameplayPanel({ mode, actor, name }: { mode: 'classic' | 'ra2'; actor: string; name: string }) {
  const key = `${mode}:${actor}`, prefix = useId();
  const [content, setContent] = useState<UnitContent | null>(null);
  const [values, setValues] = useState<Record<UnitStat, string>>({ cost: '', health: '', speed: '' });
  const [notice, setNotice] = useState('Loading the unit’s gameplay bindings…');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<UnitPreview>({ state: 'unbuilt' });
  const [reload, setReload] = useState(0);
  const [poll, setPoll] = useState(0);
  const loaded = content?.supported ? Object.entries(content.targets) : [];
  const primary = loaded.find(([id]) => id === `${mode}-desktop`)?.[1];
  const dirty = !!primary && fields.some(f => primary.inherited[f.id] !== null && Number(values[f.id]) !== primary.effective[f.id]);
  const webSupported = loaded.some(([id]) => id === `${mode}-web`);

  useEffect(() => {
    const controller = new AbortController();
    void ownerRequest<UnitContent>(`/api/studio/unit?mode=${mode}&actor=${encodeURIComponent(actor)}`, { signal: controller.signal }).then(next => {
      setContent(next);
      if (!next.supported) { setNotice(next.reason ?? 'This unit is not bound yet.'); return; }
      const target = next.targets[`${mode}-desktop`];
      const draft = drafts.get(key);
      setValues(draft?.values ?? Object.fromEntries(fields.map(f => [f.id, target.effective[f.id] === null ? '' : String(target.effective[f.id])])) as Record<UnitStat, string>);
      setNotice(draft ? 'Your unsaved draft is preserved. Reload to discard it.' : 'Edit this unit. Save when you’re ready.');
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [actor, mode, key, reload]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void ownerRequest<UnitPreview>('/api/studio/previews', { signal: controller.signal }).then(setPreview).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [poll]);

  async function save(inherit = false) {
    if (!content?.supported || !primary) return;
    setBusy(true);
    try {
      const overrides: UnitValues = {};
      for (const f of fields) if (!inherit && primary.inherited[f.id] !== null && Number(values[f.id]) !== primary.inherited[f.id]) overrides[f.id] = Number(values[f.id]);
      const next = await ownerRequest<UnitContent>('/api/studio/unit', { method: 'POST', body: { unit: key, baseRevision: drafts.get(key)?.revision ?? content.revision, values: overrides } });
      drafts.delete(key); setContent(next);
      setValues(Object.fromEntries(fields.map(f => [f.id, next.targets[`${mode}-desktop`].effective[f.id] === null ? '' : String(next.targets[`${mode}-desktop`].effective[f.id])])) as Record<UnitStat, string>);
      setNotice(inherit ? 'Restored inherited values. Your earlier revisions are preserved.' : 'Modification saved locally. Build previews to use it in a fresh game.');
      setPoll(n => n + 1);
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function build() {
    setBusy(true);
    try { setPreview(await ownerRequest<UnitPreview>('/api/studio/previews', { method: 'POST', body: {} })); setPoll(n => n + 1); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function launch() {
    try { await ownerRequest('/api/studio/launch', { method: 'POST', body: { mode } }); setNotice(`${title(mode)} desktop launched with the saved revision.`); }
    catch (error) { setNotice((error as Error).message); }
  }
  return <section className="unit-gameplay" aria-label={`${name} gameplay editor`}>
    <header><div><span className="lab-label">GAMEPLAY MODIFICATION</span><h2>{name}</h2></div><span className="ug-mode">{title(mode)}</span></header>
    <p className="ug-scope"><Monitor size={13} /> Desktop {webSupported && <><span>+</span><Globe size={13} /> Web</>}<span className="ug-local">Local owner</span></p>
    {content?.supported && primary && <>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="ug-columns"><span>Stat</span><span>Inherited</span><span>Your value</span></div>
        {fields.map(f => {
          const enabled = loaded.every(([, t]) => t.inherited[f.id] !== null);
          return <div className="ug-field" key={f.id}><label htmlFor={`${prefix}-${f.id}`}>{f.label}<small>{enabled ? f.hint : 'Not applicable'}</small></label>
            <span>{primary.inherited[f.id] ?? '—'}</span>
            <input id={`${prefix}-${f.id}`} aria-label={f.label} type="number" min="1" max={f.max} step="1" disabled={!enabled || busy} required={enabled} value={values[f.id]} onChange={e => {
              const next = { ...values, [f.id]: e.target.value }; setValues(next);
              drafts.set(key, { revision: drafts.get(key)?.revision ?? content.revision, values: next });
            }} />
          </div>;
        })}
        <div className="ug-save"><button className="ug-primary" disabled={busy || !dirty}><Save size={14} />{busy ? 'Saving…' : 'Save modification'}</button>
          <button type="button" className="ug-reset" title="Restore inherited game values; earlier work stays preserved" disabled={busy || !Object.keys(content.overrides).length} onClick={() => void save(true)}><RotateCcw size={13} />Restore</button></div>
      </form>
      <details className="ug-affected"><summary>Affects {content.unit.factions.length} {content.unit.factions.length === 1 ? 'faction' : 'factions'} · {loaded.length} targets</summary>
        <p>{content.unit.factions.map(f => f.name).join(', ')}</p>
        {loaded.map(([id, t]) => <p key={id}><b>{id.endsWith('web') ? 'Web' : 'Desktop'}</b><code>{t.actor}</code><span>{t.effective.cost} cr · {t.effective.health} HP · {t.effective.speed ?? 'stationary'}</span></p>)}
        {!!content.relatedUnits?.length && <p>Inherited by: {content.relatedUnits.map(u => `${u.name} (${u.fields.join(', ')})`).join('; ')}. Their own overrides take precedence.</p>}
      </details>
      {!webSupported && <p className="ug-gap">This unit is not included in the current web rules.</p>}
      {mode === 'classic' && webSupported && <p className="ug-gap">Uses the recovered Classic rules and actor IDs on both platforms. Each desktop experience keeps its own settings and enabled factions.</p>}
      <div className="ug-preview"><div><span>LOCAL PREVIEWS</span><b className={`ug-status is-${preview.state}`}>{preview.state === 'ready' ? <Check size={12} /> : null}{preview.state === 'unbuilt' ? 'Not built' : preview.state === 'outdated' ? 'Outdated' : preview.state === 'building' ? 'Building…' : preview.state === 'failed' ? 'Build failed' : 'Up to date'}</b></div>
        <dl className="ug-revisions" aria-label="Content revision status">
          <div><dt>Saved</dt><dd><code>{(preview.savedRevision ?? content.revision).slice(0, 10)}</code></dd></div>
          <div><dt>Built</dt><dd>{preview.revision ? <code>{preview.revision.slice(0, 10)}</code> : 'Not built'}</dd></div>
          <div><dt>Verified</dt><dd>{preview.verified ? <><code>{preview.revision?.slice(0, 10)}</code><small>Classic + RA2 · desktop + web</small></> : 'Not verified'}</dd></div>
        </dl>
        <button type="button" className="ug-build" disabled={busy || dirty || preview.state === 'building'} onClick={() => void build()}><RefreshCw size={14} />Build & test locally</button>
        {dirty && <small>Save your modification before building.</small>}
        {preview.error && <p className="ug-gap">{preview.error}</p>}
        {preview.state === 'ready' && !dirty && <div className="ug-launch"><button type="button" onClick={() => void launch()}><Play size={13} />Desktop</button>{webSupported && preview.webUrl && <a href={`${preview.webUrl}?profile=${mode === 'classic' ? 'public-classic' : 'public'}&runtime=interp&private=0`} target="_blank" rel="noreferrer"><Globe size={13} />Web game</a>}</div>}
        <small>Studio, local Play and desktop use one tested build. Existing matches keep their rules. Nothing is published.</small>
      </div>
      <footer>Revision <code>{content.revision.slice(0, 10)}</code> · saved locally</footer>
    </>}
    <p className="ug-notice" role="status">{notice}</p>
    <button className="ug-reload" type="button" disabled={busy} onClick={() => { drafts.delete(key); setReload(n => n + 1); }}>Reload saved values</button>
  </section>;
}
