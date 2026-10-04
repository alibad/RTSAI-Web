import assert from "node:assert/strict";
import test from "node:test";
import { advanceTrial, createTrial, defaultConfig, experiments, finishTrial, reportFor, summarize, trialScene, validateConfig, type EvalConfig } from "../lib/behavior-eval";
import { starterScene } from "../app/components/MapWorkshop";
function evaluate(c:EvalConfig,policy=c.candidate,rep=0){const s=createTrial(c,policy,rep);while(!advanceTrial(s,c,250)){/* Advance until elimination or the declared limit. */}return finishTrial(s,c,rep);}

test("all presets in both games produce measured combat and finite replay evidence",()=>{
  for(const mode of ["ra2","ra"] as const)for(const preset of experiments){
    const c=defaultConfig(mode,preset.id),t=evaluate(c);
    assert.ok(t.shots>0,mode+"/"+preset.id);assert.ok(t.damage>0);assert.ok(t.checks.every(v=>v.pass));
    assert.ok(t.frames.length>=2);assert.equal(t.frames[0].time,0);assert.equal(t.frames.at(-1)!.time,t.seconds);
    assert.ok(t.seconds<=c.duration+.001);assert.equal(t.scene.mode,mode);
  }
});
test("paired policies receive identical scenes; repeat runs have identical decisions and outcomes",()=>{
  const c=defaultConfig();assert.deepEqual(createTrial(c,c.baseline,0).scene,createTrial(c,c.candidate,0).scene);
  assert.deepEqual(evaluate(c),evaluate(c));
  const west=trialScene(c,42,false),east=trialScene(c,42,true);
  for(let i=0;i<west.pieces.length;i++){assert.equal(west.pieces[i].x+east.pieces[i].x,64);assert.equal(west.pieces[i].team,east.pieces[i].team);assert.equal(west.pieces[i].health,east.pieces[i].health);}
  assert.equal(createTrial(c,c.candidate,0).seed,createTrial(c,c.candidate,1).seed);
  assert.equal(createTrial(c,c.candidate,2).seed,c.seed+1);
});
test("deployment policy changes supported infantry and its weapon behavior",()=>{
  const c=defaultConfig("ra2","deployment"),deployed=evaluate(c),moving=evaluate(c,"nearest");
  assert.ok(deployed.frames[1].pieces.filter(p=>p.team==="blue").every(p=>p.deployed));
  assert.ok(moving.frames[1].pieces.every(p=>!p.deployed));assert.notEqual(deployed.shots,moving.shots);
});
test("hold-versus-hold at long distance is a visible failed combat check, not a successful draw",()=>{
  const c={...defaultConfig(),candidate:"hold" as const,opponent:"hold" as const,gap:24,duration:30};
  const t=evaluate(c);assert.equal(t.outcome,"draw");assert.equal(t.shots,0);assert.equal(t.checks.find(c=>c.name==="Combat observed")!.pass,false);
});
test("requested victories fail even when combat integrity passes",()=>{
  const c={...defaultConfig(),expectation:"blue-win" as const},t=evaluate(c);
  assert.equal(t.outcome,"red");assert.ok(t.checks.find(c=>c.name==="Simulation integrity")!.pass);
  assert.equal(t.checks.find(c=>c.name==="Blue wins")!.pass,false);
});
test("authored scenes preserve terrain and placements, isolate mutations, and require two living teams",()=>{
  const custom=starterScene("ra2"),copy=structuredClone(custom),c={...defaultConfig(),custom};
  const s=createTrial(c,"focus",0);advanceTrial(s,c,50);assert.deepEqual(custom,copy);
  assert.deepEqual(trialScene(c,42,false),trialScene(c,43,true));
  assert.throws(()=>validateConfig({...c,custom:{...custom,pieces:custom.pieces.filter(p=>p.team==="blue")}}),/both teams/);
});
test("invalid limits, foreign actors, malformed policies and expectations cannot execute",()=>{
  const c=defaultConfig();for(const patch of [{reps:99},{duration:Infinity},{gap:1},{count:9},{seed:-1},{a:defaultConfig("ra").a},{opponent:"__proto__"},{expectation:"unknown"}])assert.throws(()=>validateConfig({...c,...patch} as EvalConfig));
});
test("summary reports completed sample counts, draws, Wilson uncertainty and labeled provenance",()=>{
  const c=defaultConfig(),t=evaluate(c),draw={...t,outcome:"draw" as const},win={...t,outcome:"blue" as const},s=summarize([t,draw,win],c.candidate);
  assert.equal(s.n,3);assert.equal(s.wins,1);assert.equal(s.draws,1);assert.equal(s.score,.5);assert.ok(s.low<1/3&&s.high>1/3);
  const report=reportFor(c,[t]);assert.equal(report.evidence,"browser-prototype");assert.equal(report.ruleCommit,t.scene.ruleCommit);assert.equal(report.trials[0].frames[0].time,0);
});
