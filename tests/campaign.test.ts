import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPreviewResult, campaignIssues, changeCampaignMode, checkMission, duration, missionScene, newProgress, parseCampaign, parsePreview, parseProgress, previewEnvelope, removeMission, resolveStory, shotAt, starterCampaign, type Campaign } from '../lib/campaign';
import { introVtt } from '../lib/campaign-video';
import { createWorld, issueOrder, maxHealth, actorFor, parseScene, stepWorld } from '../lib/workshop';
import { compileWorkshopMap } from '../lib/workshop-export';

test('both modes provide five neutral fictional chapters with native actors and valid browser maps', () => {
  for (const mode of ['ra2', 'ra'] as const) {
    const c = starterCampaign(mode), copy = parseCampaign(JSON.stringify(c));
    assert.deepEqual(copy, c); assert.equal(c.missions.length, 5); assert.deepEqual(campaignIssues(c), []);
    for (const m of c.missions) {
      const scene = missionScene(c, m); assert.equal(scene.pieces.length, 3); assert.equal(scene.mode, mode);
      assert.deepEqual(parseScene(JSON.stringify(scene)), scene);
      assert.equal(actorFor(scene.pieces[0].actorKey).behavior.weapons.length, 0);
      const map = compileWorkshopMap(scene); assert.ok(map.binary.length > 1000); assert.match(map.yaml, /Actors:/);
      assert.equal(duration(m), 20); assert.equal(m.objectives.length, 3);
    }
  }
});
test('story branches skip chapters deliberately, carry bounded consequences and finish', () => {
  const c = starterCampaign(); let p = resolveStory(c, newProgress(c), 'line-first');
  assert.equal(p.current, 'grid'); assert.equal(p.trust, 46); assert.equal(p.supplies, 75);
  p = resolveStory(c, p, 'care'); p = resolveStory(c, p, 'delay'); p = resolveStory(c, p, 'care');
  assert.equal(p.current, null); assert.equal(p.history.length, 4); assert.equal(p.history[0].mission, 'last-light');
  assert.throws(() => resolveStory(c, p, 'care'), /new story/);
  const bounded = resolveStory(c, { ...newProgress(c), supplies: 3, trust: 98 }, 'care');
  assert.equal(bounded.supplies, 0); assert.equal(bounded.trust, 100);
  assert.throws(() => resolveStory(c, newProgress(c), '__proto__'), /unavailable/);
});
test('imports reject dangling branches, loops, duplicated keys and oversized or invalid settings', () => {
  const c = starterCampaign(), bad = (change: (c: Campaign) => void) => { const copy = structuredClone(c); change(copy); return JSON.stringify(copy); };
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].choices[0].next = 'missing'; })), /missing mission/);
  assert.throws(() => parseCampaign(bad(c => { c.missions.at(-1)!.choices[0].next = c.start; })), /must not loop/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[1].id = c.start; })), /unique/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].shots[1].id = c.missions[0].shots[0].id; })), /unique/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].shots[0].speaker = 'missing'; })), /missing character/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].shots[0].seconds = 999; })), /whole number/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].objectives[0].seconds = 180; })), /time limit/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].objectives[0].actorId = 999; })), /missing map actor/);
  assert.throws(() => parseCampaign(bad(c => { c.missions[0].actorKey = 'classic:e6'; })), /faction and mode/);
  assert.throws(() => parseCampaign(' '.repeat(2_000_001)), /too large/);
});
test('imports strip media URLs, scripts and unrelated metadata instead of forwarding it', () => {
  const c = starterCampaign(), data = { ...c, secret: 'local-only', mediaUrl: 'https://example.invalid', script: 'eval()', missions: c.missions.map(m => ({ ...m, script: 'code', shots: m.shots.map(s => ({ ...s, file: 'C:/private.png' })) })) };
  assert.deepEqual(parseCampaign(JSON.stringify(data)), c);
});
test('removing a chapter rewires incoming branches and preserves an ending', () => {
  let c = removeMission(starterCampaign(), 'grid');
  assert.ok(!c.missions.some(m => m.id === 'grid')); assert.ok(c.missions[0].choices.some(ch => ch.next === 'harbor'));
  assert.deepEqual(campaignIssues(c), []);
  c = removeMission(c, c.start); assert.equal(c.start, 'clinic'); assert.deepEqual(campaignIssues(c), []);
  while (c.missions.length > 1) c = removeMission(c, c.missions.at(-1)!.id);
  assert.deepEqual(campaignIssues(c), []); assert.throws(() => removeMission(c, c.start), /at least one/);
});
test('shot timing selects the next shot at boundaries and holds the final shot', () => {
  const m = starterCampaign().missions[0];
  assert.equal(shotAt(m, 0).shot.id, 'establish'); assert.equal(shotAt(m, 5).shot.id, 'voice');
  assert.equal(shotAt(m, 11).shot.id, 'task'); assert.equal(shotAt(m, 20).shot.id, 'question');
  assert.equal(shotAt(m, 999).elapsed, 4);
});
test('objectives respond to real movement, repair, elapsed time and destruction in the browser world', () => {
  for (const mode of ['ra2', 'ra'] as const) {
    const c = starterCampaign(mode), m = c.missions[0], world = createWorld(missionScene(c, m));
    assert.equal(checkMission(m, world).status, 'pending');
    assert.ok(issueOrder(world, 1, { type: 'move', point: { x: 25, y: 32 } }));
    world.pieces[1].health = maxHealth(actorFor(world.pieces[1].actorKey));
    for (let i = 0; i < 750; i++) stepWorld(world, .04);
    assert.equal(checkMission(m, world).status, 'success');
    world.pieces[1].health = 0; assert.equal(checkMission(m, world).status, 'setback');
    const timed = createWorld(missionScene(c, m)); timed.time = m.limit; assert.equal(checkMission(m, timed).status, 'setback');
  }
});
test('preview roundtrip preserves custom terrain, placements and objectives without overwriting another draft', () => {
  const c = starterCampaign(), m = c.missions[0], preview = parsePreview(previewEnvelope(c, m));
  const scene = structuredClone(preview.scene); scene.cells[12][12] = 3; scene.pieces[0].x = 19;
  const source = JSON.stringify({ version: 1, campaignId: c.id, source: JSON.stringify(parseCampaign(JSON.stringify(c))), missionId: m.id, evidence: 'browser-prototype', status: 'success', seconds: 24.5, scene });
  const applied = applyPreviewResult(source, c); assert.equal(applied.attached, true); assert.equal(applied.result.status, 'success');
  assert.deepEqual(missionScene(applied.campaign, applied.campaign.missions[0]), scene);
  assert.throws(() => applyPreviewResult(source, { ...c, title: 'A newer draft' }), /different draft/);
  assert.throws(() => changeCampaignMode(applied.campaign, 'ra'), /attached maps/);
  assert.throws(() => applyPreviewResult(source.replace('"success"', '"unknown"'), c), /Unknown option/);
  const lost = structuredClone(scene); lost.pieces = lost.pieces.filter(p => p.id !== 2);
  assert.throws(() => applyPreviewResult(JSON.stringify({ ...JSON.parse(source), scene: lost }), c), /missing map actor/);
});
test('mode and faction changes resolve real actors in both rosters; unreachable chapters are surfaced', () => {
  const c = changeCampaignMode(starterCampaign(), 'ra', 'china'); assert.equal(c.mode, 'ra'); assert.equal(c.faction, 'china');
  assert.deepEqual(campaignIssues(c), []); for (const m of c.missions) assert.equal(actorFor(m.actorKey).mode, 'ra');
  const detached = structuredClone(c); detached.missions[0].choices.forEach(ch => { ch.next = 'grid'; });
  assert.ok(campaignIssues(detached).some(message => message.includes('not reachable')));
});
test('story history restores across navigation and rejects stale or fabricated consequences', () => {
  const c = starterCampaign(); let progress = resolveStory(c, newProgress(c), 'line-first');
  assert.deepEqual(parseProgress(JSON.stringify(progress), c), progress);
  assert.throws(() => parseProgress(JSON.stringify({ ...progress, supplies: 100 }), c), /branches changed/);
  assert.throws(() => parseProgress(JSON.stringify({ ...progress, campaignId: 'another' }), c), /another campaign/);
  while (progress.current) progress = resolveStory(c, progress, 'care');
  assert.deepEqual(parseProgress(JSON.stringify(progress), c), progress);
  const manual = { ...newProgress(c), current: 'harbor' }; assert.deepEqual(parseProgress(JSON.stringify(manual), c), manual);
});
test('downloadable captions span every shot and escape text as text', () => {
  const c = starterCampaign(), m = structuredClone(c.missions[0]); m.shots[0].dialogue = '<script> & a --> b';
  const vtt = introVtt(c, m); assert.match(vtt, /^WEBVTT\n/); assert.match(vtt, /00:00:00.000 --> 00:00:05.000/); assert.match(vtt, /00:00:16.000 --> 00:00:20.000/);
  assert.match(vtt, /&lt;script&gt; &amp; a --&gt; b/); assert.doesNotMatch(vtt, /<script>/); assert.equal((vtt.match(/ --> /g) ?? []).length, 4);
});
