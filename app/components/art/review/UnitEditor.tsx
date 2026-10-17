"use client";
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Save, RefreshCw, RotateCcw, Shield, Crosshair, Hammer, Eye, Wrench } from 'lucide-react';
import { ownerRequest } from '../../../../lib/studio-owner-client';
import type { RuleNode, UnitDetails, UnitPreview, UnitValues, UnitWorkspace } from '../../../../lib/unit-content-types';
import { corePaths, parseRuleFragment, printRuleFragment, ruleAt, ruleGroup, ruleLabel, setRule } from '../../../../lib/unit-rule-editor';
import './unit-editor.css';

type Draft = { revision: string; values: UnitValues; details: UnitDetails };
const emptyDetails = (): UnitDetails => ({ actor: '', weapons: {} });
const sections = ['Overview', 'Combat', 'Production', 'Movement & defense', 'Abilities', 'Art & audio', 'Advanced rules', 'Review changes'];
const sectionIcons = [Eye, Crosshair, Hammer, Shield, Wrench, Eye, Wrench, Check];
const snapshot = (draft: Draft) => JSON.stringify({ values: draft.values, details: draft.details });

export function UnitEditor() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') === 'classic' ? 'classic' : 'ra2';
  const actor = params.get('unit') ?? '';
  const key = `${mode}:${actor}`, draftKey = `rtsai.unit-editor.v1.${key}`;
  const [content, setContent] = useState<UnitWorkspace | null>(null);
  const viewer = `/art/review?mode=${mode}&unit=${encodeURIComponent(actor)}&faction=${encodeURIComponent(content?.unit.factions[0]?.id ?? (mode === 'classic' ? 'england' : 'america'))}&view=art`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState('');
  const [section, setSection] = useState('Overview');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('Reading this unit’s rules through OpenRA…');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<UnitPreview>({ state: 'unbuilt' });
  const [reload, setReload] = useState(0);
  const primary = content?.details.targets[`${mode}-desktop`];
  const dirty = !!draft && snapshot(draft) !== saved;
  const [ruleError, setRuleError] = useState('');
  const [weaponProfile, setWeaponProfile] = useState<string | null>(null);
  let actorPatch: RuleNode[] = [];
  try { actorPatch = parseRuleFragment(draft?.details.actor ?? ''); } catch { /* Advanced text is validated below. */ }

  useEffect(() => {
    const controller = new AbortController();
    void ownerRequest<UnitWorkspace>(`/api/studio/unit?mode=${mode}&actor=${encodeURIComponent(actor)}&workspace=1`, { signal: controller.signal }).then(next => {
      if (!next.supported) throw new Error(next.reason);
      setContent(next);
      const fresh: Draft = { revision: next.revision, values: next.overrides, details: next.details.overrides };
      setSaved(snapshot(fresh));
      let prior: Draft | null = null;
      try {
        const candidate = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
        if (candidate && /^[a-f0-9]{64}$/.test(candidate.revision) && candidate.values && typeof candidate.values === 'object' && typeof candidate.details?.actor === 'string' && candidate.details.weapons && typeof candidate.details.weapons === 'object') prior = candidate;
      } catch { /* optional draft */ }
      setDraft(prior ?? fresh);
      setNotice(prior ? prior.revision === next.revision ? 'Your unsaved draft is restored.' : 'Saved content changed in another tab. Your draft is preserved. Reload saved rules before saving.' : 'Edit this unit’s rules. The viewer remains open in its own tab.');
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [mode, actor, draftKey, reload]);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void ownerRequest<UnitPreview>('/api/studio/previews', { signal: controller.signal }).then(setPreview).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    refresh(); const timer = setInterval(refresh, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [dirty]);

  function change(next: Draft) {
    setDraft(next);
    try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { setNotice('Browser draft storage is unavailable. Keep this tab open until you save.'); }
  }
  function updateRule(path: string[], value: string, armament?: string) {
    if (!draft) return;
    const next = structuredClone(draft);
    if (armament) {
      const base = primary?.weapons.find(w => w.armament === armament)?.base;
      if (!base) return;
      const w = next.details.weapons[armament] ?? { base, rules: '' };
      w.rules = printRuleFragment(setRule(parseRuleFragment(w.rules), path, value));
      next.details.weapons[armament] = w;
    } else next.details.actor = printRuleFragment(setRule(actorPatch, path, value));
    change(next); setRuleError('');
  }
  async function save() {
    if (!draft || !content) return;
    setBusy(true); setNotice('Checking the complete rules in the native engine for both modes and targets…');
    try {
      parseRuleFragment(draft.details.actor);
      await ownerRequest('/api/studio/unit', { method: 'POST', body: { unit: key, baseRevision: draft.revision, values: draft.values, details: draft.details } });
      localStorage.removeItem(draftKey); setReload(n => n + 1);
      setNotice('Saved locally. Build & verify before starting a fresh game.');
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function build() {
    try { setPreview(await ownerRequest<UnitPreview>('/api/studio/previews', { method: 'POST', body: {} })); }
    catch (error) { setNotice((error as Error).message); }
  }
  async function launch(selected: 'classic' | 'ra2') {
    setBusy(true);
    try { await ownerRequest('/api/studio/launch', { method: 'POST', body: { mode: selected } }); setNotice(`${selected === 'classic' ? 'Classic' : 'RA2'} desktop launched from this verified build.`); }
    catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  function reloadSaved() {
    if (dirty && !window.confirm('Reload saved rules? Your browser draft will be discarded; saved revisions remain preserved.')) return;
    localStorage.removeItem(draftKey); setReload(n => n + 1);
  }
  const nodes = primary?.nodes ?? [];
  const matches = (node: RuleNode) => !query || JSON.stringify(node).toLowerCase().includes(query.toLowerCase());

  function fields(rows: RuleNode[], path: string[] = [], armament?: string): React.ReactNode {
    return rows.map(node => {
      const at = [...path, node.key];
      if (!armament && corePaths.has(at.join('/'))) return null;
      let patch = actorPatch;
      try { if (armament) patch = parseRuleFragment(draft?.details.weapons[armament]?.rules ?? ''); }
      catch { return <p role="alert" key={node.key}>Fix the weapon rule syntax in Advanced rules before using the form.</p>; }
      const edited = ruleAt(patch, at);
      const value = edited?.value ?? node.value ?? '';
      if (node.children.length && armament && path.length === 0) return <details className="ue-trait" key={node.key} open={node.key === 'Warhead@1Dam'}><summary>{ruleLabel(node.key)} <small>{node.value}</small></summary>{fields(node.children, at, armament)}</details>;
      if (node.children.length) return <fieldset className="ue-nested" key={node.key}><legend>{ruleLabel(node.key)}{node.value && <small> {node.value}</small>}</legend>{fields(node.children, at, armament)}</fieldset>;
      if (path.length === 0 && !armament && node.value === null) return <div className="ue-enabled" key={node.key}><Check size={14} />{ruleLabel(node.key)}<small>Present in this unit’s rules</small></div>;
      const id = `${armament ?? 'actor'}-${at.join('-')}`;
      return <label className={`ue-field ${edited ? 'is-edited' : ''}`} key={node.key} htmlFor={id}><span>{ruleLabel(node.key)}<small>{at.join(' / ')}{edited ? ' · override' : ''}</small></span>
        {/^(True|False)$/i.test(value) ? <input id={id} type="checkbox" checked={/^True$/i.test(value)} disabled={busy} onChange={e => updateRule(at, e.target.checked ? 'True' : 'False', armament)} />
          : <input id={id} value={value} disabled={busy || !!ruleError} spellCheck={false} onChange={e => updateRule(at, e.target.value, armament)} />}
      </label>;
    });
  }
  function traits(group: string) {
    return nodes.filter(n => ruleGroup(n.key) === group && matches(n)).map(n => <details className="ue-trait" key={n.key} open={query ? true : undefined}>
      <summary>{ruleLabel(n.key)}<small>{n.children.length} properties</small></summary>{fields([n])}
    </details>);
  }
  const hasWeb = !!content?.targets[`${mode}-web`];
  const effective = content?.targets[`${mode}-desktop`]?.effective;

  return <div className="unit-editor"><header className="ue-header"><div><span>FACTION STUDIO / UNIT EDITOR</span><h1>{content?.unit.name ?? actor}<small>{mode === 'classic' ? 'Classic' : 'RA2'}</small></h1></div><a href={viewer} target="_blank" rel="noreferrer"><Eye size={15} />View unit <ArrowUpRight size={14} /></a><b className="ue-local">LOCAL OWNER</b></header>
    <div className="ue-layout"><nav className="ue-nav" aria-label="Unit editing sections">{sections.map((s, i) => { const Icon = sectionIcons[i]; return <button key={s} aria-current={section === s ? 'page' : undefined} onClick={() => setSection(s)}><Icon size={17} />{s}</button>; })}<p>Mode-specific rules.<br />Original files stay intact.</p></nav>
      <main className="ue-main"><div className="ue-section-heading"><div><span>{mode === 'classic' ? 'CLASSIC / TOP-DOWN' : 'RA2 / ISOMETRIC'}</span><h2>{section}</h2></div>{!['Overview','Advanced rules','Review changes'].includes(section) && <input aria-label="Find a rule" placeholder="Find a rule…" value={query} onChange={e => setQuery(e.target.value)} />}</div>
        {!content || !draft ? <p role="status">{notice}</p> : <>
          {section === 'Overview' && <><p className="ue-intro">A separate workspace for the complete unit rules. Change production, combat, abilities and presentation here. Your browsing and art review stay in the viewer.</p><section className="ue-card"><h3>Core stats</h3>{(['cost','health','speed'] as const).map(stat => <label className="ue-field" key={stat}><span>{stat === 'cost' ? 'Build cost' : stat === 'health' ? 'Health' : 'Movement speed'}<small>{stat === 'health' ? 'Engine HP; scales differ between modes' : stat === 'speed' ? 'Engine units per tick' : 'Credits'}</small></span><input aria-label={stat === 'cost' ? 'Build cost' : stat === 'health' ? 'Health' : 'Movement speed'} type="number" min={1} max={stat === 'health' ? 10000000 : stat === 'cost' ? 100000 : 1000} disabled={effective?.[stat] === null || busy} value={draft.values[stat] ?? effective?.[stat] ?? ''} onChange={e => change({ ...draft, values: { ...draft.values, [stat]: Number(e.target.value) } })} /></label>)}</section>
            <div className="ue-overview-grid">{['Combat','Production','Abilities','Art & audio'].map(s => <button key={s} onClick={() => setSection(s)}><h3>{s} →</h3><p>{s === 'Combat' ? `${primary?.weapons.length ?? 0} armaments · damage, range, targeting and armor` : s === 'Production' ? 'Factions, prerequisites, queues and build time' : s === 'Abilities' ? 'Deployment, transport, capture, conditions and support' : 'Existing render images, animations, icons, voices and sounds'}</p></button>)}</div>
            <section className="ue-card"><h3>Applies to</h3><p>{content.unit.factions.map(f => f.name).join(' · ')}</p><p>Desktop {hasWeb ? '+ Web' : 'only'} · {nodes.length} resolved actor traits · read through OpenRA.</p><p>OpenRA checks your complete changes on save. The tested build changes only after all four build targets pass. A unit can inherit changes into its variants; their own overrides take precedence.</p></section></>}
          {section === 'Combat' && <><p className="ue-intro">Weapon variants belong to this unit. Other units retain their shared weapon. Distances use OpenRA notation, such as 5c0 for five cells; reload delays use engine ticks.</p><div className="ue-weapon-profiles" role="group" aria-label="Weapon profile">{primary?.weapons.map(w => <button key={w.armament} aria-pressed={w.armament === (weaponProfile ?? primary.weapons[0]?.armament)} onClick={() => setWeaponProfile(w.armament)}>{ruleLabel(w.armament.replace(/^Armament@?/, '') || 'Primary')}</button>)}</div>{primary?.weapons.filter(w => w.armament === (weaponProfile ?? primary.weapons[0]?.armament)).map(w => <section className="ue-card" key={w.armament}><h3>{ruleLabel(w.armament)} <small>{w.base}</small></h3>{fields(w.nodes, [], w.armament)}</section>)}{!primary?.weapons.length && <p>This unit has no direct weapon. Armaments can be added through Advanced rules using an existing weapon.</p>}{traits('Combat')}</>}
          {['Production','Movement & defense','Abilities','Art & audio'].includes(section) && <><p className="ue-intro">Properties come from this unit’s existing {mode === 'classic' ? 'Classic' : 'RA2'} rules. Expand a trait to edit its configured values. Advanced rules can add properties or traits.</p>{section === 'Art & audio' && <p className="ue-note">References select existing game resources. Keep creating and reviewing models, sprites and audio in the viewer’s existing art and sound workflows. AI generation is unchanged.</p>}{traits(section)}</>}
          {section === 'Advanced rules' && <><p className="ue-intro">A minimal MiniYaml overlay for this actor only. Indent with tabs or groups of four spaces. You can add properties and traits or remove an inherited trait with a leading minus. Core cost, health and speed stay in Overview. Shared source files are preserved.</p><label className="ue-code-label">Actor override<textarea aria-label="Actor rule overrides" spellCheck={false} value={draft.details.actor} onChange={e => { change({ ...draft, details: { ...draft.details, actor: e.target.value } }); try { parseRuleFragment(e.target.value); setRuleError(''); } catch (error) { setRuleError((error as Error).message); } }} /></label>
            {primary?.weapons.map(w => <label className="ue-code-label" key={w.armament}>{ruleLabel(w.armament)} · private variant of {w.base}<textarea aria-label={`${w.armament} weapon overrides`} spellCheck={false} value={draft.details.weapons[w.armament]?.rules ?? ''} onChange={e => change({ ...draft, details: { ...draft.details, weapons: { ...draft.details.weapons, [w.armament]: { base: w.base, rules: e.target.value } } } })} /></label>)}
            <details className="ue-trait"><summary>Loaded actor rules · reference</summary><pre>{printRuleFragment(nodes)}</pre></details>
          </>}
          {section === 'Review changes' && <><p className="ue-intro">Review the saved overlay and your draft. Saving validates all affected targets. Building freezes and tests the saved revision; it does not publish.</p><section className="ue-card"><h3>Core stat overrides</h3><pre>{JSON.stringify(draft.values, null, 2)}</pre><h3>Actor overrides</h3><pre>{draft.details.actor || 'No actor overrides.'}</pre>{Object.entries(draft.details.weapons).map(([arm, w]) => <div key={arm}><h3>{arm} · private variant of {w.base}</h3><pre>{w.rules}</pre></div>)}</section><details className="ue-trait"><summary>Previously saved overrides</summary><pre>{saved && JSON.stringify(JSON.parse(saved), null, 2)}</pre></details><section className="ue-card"><h3>This unit’s revision history</h3><p>Stage an earlier version, review it, then save. Other units stay unchanged.</p>{content.history?.map(row => <div className="ue-field" key={row.revision}><span>{row.revision.slice(0,10)}<small>{new Date(row.savedAt * 1000).toLocaleString()}</small></span><button className="ue-secondary" disabled={busy || snapshot({ revision: content.revision, values: row.values, details: row.details }) === snapshot(draft)} onClick={() => { change({ revision: content.revision, values: row.values, details: row.details }); setNotice('Earlier revision staged. Review and save to apply it to this unit.'); }}>Stage revision</button></div>)}{!content.history?.length && <p>No earlier saved edits for this unit.</p>}</section><button className="ue-secondary" onClick={() => { change({ revision: draft.revision, values: {}, details: emptyDetails() }); setNotice('Restore staged. Save to inherit the original rules again. Earlier revisions remain preserved.'); }}><RotateCcw size={14} />Stage restore of this unit</button></>}
        </>}
      </main><aside className="ue-sidebar" aria-label="Save build and launch"><span className="ue-eyebrow">YOUR WORK</span><h2>{dirty ? 'Unsaved draft' : 'Saved locally'}</h2><p>Only this unit’s overlay is saved. Other authored work stays in place.</p><button className="ue-primary" disabled={!dirty || busy || !!ruleError || preview.state === 'building'} onClick={() => void save()}><Save size={16} />{busy ? 'Checking…' : 'Save unit changes'}</button><button className="ue-secondary" disabled={busy} onClick={reloadSaved}>Reload saved rules</button>{ruleError && <p role="alert">{ruleError}</p>}<p className="ue-status" role="status">{notice}</p>
        <section className="ue-build"><span className="ue-eyebrow">LOCAL BUILD</span><h3>{preview.state === 'ready' ? 'Ready to play' : preview.state === 'building' ? 'Building & verifying…' : preview.state === 'failed' ? 'Build failed' : 'Build required'}</h3><dl>{(['Saved','Built','Verified'] as const).map(label => <div key={label}><dt>{label}</dt><dd>{label === 'Saved' ? (preview.savedRevision ?? content?.revision)?.slice(0,10) ?? '—' : label === 'Verified' && !preview.verified ? 'Not verified' : preview.revision?.slice(0,10) ?? '—'}</dd></div>)}</dl><button className="ue-secondary" disabled={dirty || busy || preview.state === 'building' || !content} onClick={() => void build()}><RefreshCw size={15} />Build & verify locally</button>{dirty && <p>Save the draft first.</p>}<p>Tests Classic and RA2 on desktop and web. Only a passing build becomes the selected revision.</p>{preview.error && <p role="alert">{preview.error}</p>}</section>
        <section className="ue-launch"><span className="ue-eyebrow">LAUNCH VERIFIED BUILD</span>{(['classic','ra2'] as const).map(m => <div key={m}><b>{m === 'classic' ? 'Classic' : 'RA2'}</b><button aria-label={`${m === 'classic' ? 'Classic' : 'RA2'} desktop`} disabled={dirty || busy || preview.state !== 'ready'} onClick={() => void launch(m)}>Desktop ↗</button>{preview.state === 'ready' && !dirty ? <a aria-label={`${m === 'classic' ? 'Classic' : 'RA2'} web game`} href={`/play/?profile=${m === 'classic' ? 'public-classic' : 'public'}&runtime=interp&private=0`} target="_blank" rel="noreferrer">Web ↗</a> : <span>Web</span>}</div>)}</section><p>Local owner editing · nothing is published.<br />Existing matches keep their rules.</p>
      </aside></div></div>;
}
