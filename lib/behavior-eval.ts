import { rosters, type GameMode } from "./game-content";
import { actorFor, canDeploy, createWorld, generateScene, issueOrder, makePiece, maxHealth, parseScene, placementIssue, prototypeRange, stepWorld, supportedWeapon, type LivePiece, type Scene, type World } from "./workshop";

export const policies = { nearest: "Advance & engage", focus: "Focus weakest target", hold: "Hold firing line", kite: "Kite between shots", deploy: "Deploy & defend" } as const;
export type Policy = keyof typeof policies;
export type EvalConfig = { mode: GameMode; a: string; b: string; count: number; gap: number; duration: number; reps: number; seed: number; candidate: Policy; baseline: Policy; opponent: Policy; expectation: "combat" | "blue-win"; custom?: Scene };
export type Check = { name: string; pass: boolean; detail: string };
export type Frame = { time: number; pieces: LivePiece[]; effects: World["effects"]; shots: number; damage: number; destroyed: number };
export type Trial = { id: string; policy: Policy; seed: number; mirrored: boolean; outcome: "blue" | "red" | "draw"; seconds: number; shots: number; damage: number; blueLeft: number; redLeft: number; commands: number; rejected: number; checks: Check[]; frames: Frame[]; decisions: string[]; scene: Scene };
export type EvalReport = { version: 1; evidence: "browser-prototype"; config: EvalConfig; ruleCommit: string; trials: Trial[]; created: string };
export const experiments = [
  { id: "armor", name: "Armor duel", detail: "Approach, reload timing and target focus", ra2: ["r2qilin", "htnk"], ra: ["cnqilin", "3tnk"] },
  { id: "deployment", name: "Infantry deployment", detail: "A mobile squad versus a deployed firing line", ra2: ["e1", "e2"], ra: ["e1", "e1"] },
  { id: "air", name: "Air interception", detail: "Target eligibility, aircraft attack and destruction", ra2: ["fv", "orca"], ra: ["cnmantis", "yak"] },
  { id: "defense", name: "Defense assault", detail: "Range advantage versus a stationary defense", ra2: ["mtnk", "nalasr"], ra: ["2tnk", "ftur"] },
  { id: "naval", name: "Naval engagement", detail: "Water movement and ship-to-ship fire", ra2: ["dest", "sub"], ra: ["dd", "ss"] },
  { id: "levant-armor", name: "Israel / Lebanon armor", detail: "Protected armor versus a mobile anti-armor screen", ra2: ["r2merkava", "r2hzrecoilless"], ra: ["merkava", "hzrecoilless"] },
  { id: "levant-air", name: "Israel / Lebanon air defense", detail: "Air-only targeting versus a consumable attack drone", ra2: ["r2ilshield", "r2hzdrone"], ra: ["ilshield", "hzdrone"] },
] as const;
export function defaultConfig(mode: GameMode = "ra2", experiment = "armor"): EvalConfig {
  const preset = experiments.find(p => p.id === experiment) ?? experiments[0];
  const keys = preset[mode].map(id => rosters.actors.find(a => a.mode === mode && a.id === id)?.key);
  const fallback = rosters.actors.filter(a => a.mode === mode && a.category === "vehicle" && a.behavior.weapons.some(w => (w.damage ?? 0) > 0));
  return { mode, a: keys[0] ?? fallback[0].key, b: keys[1] ?? fallback[1].key, count: 3, gap: experiment === "deployment" ? 6 : 12, duration: 60, reps: 4, seed: 42, candidate: experiment === "deployment" ? "deploy" : "focus", baseline: "nearest", opponent: "nearest", expectation: "combat" };
}
export function validateConfig(c: EvalConfig) {
  if (!["ra", "ra2"].includes(c.mode) || ![c.candidate,c.baseline,c.opponent].every(p => Object.hasOwn(policies,p))) throw new Error("Choose a supported mode and policy.");
  if (![c.count,c.gap,c.duration,c.reps,c.seed].every(Number.isInteger) || c.count < 1 || c.count > 8 || c.gap < 2 || c.gap > 24 || c.duration < 10 || c.duration > 120 || c.reps < 1 || c.reps > 6 || c.seed < 0 || c.seed > 1000000) throw new Error("Experiment settings are outside their limits.");
  if (!["combat","blue-win"].includes(c.expectation)) throw new Error("Unknown expectation.");
  if (actorFor(c.a).mode !== c.mode || actorFor(c.b).mode !== c.mode) throw new Error("Both actors must belong to the selected mode.");
  if (c.custom) { const scene = parseScene(JSON.stringify(c.custom)); if (scene.mode !== c.mode || !["blue","red"].every(team => scene.pieces.some(p => p.team === team && p.health > 0))) throw new Error("A saved scene needs living actors on both teams in this mode."); }
}
export function trialScene(c: EvalConfig, seed: number, mirrored: boolean): Scene {
  validateConfig(c);
  if(c.custom) return parseScene(JSON.stringify(c.custom)); // Preserve the authored battlefield exactly.
  const s = generateScene(c.mode, seed, 64, "plains"); s.title = "Behavior experiment";
  const water = [c.a,c.b].every(key => actorFor(key).category === "ship");
  if(water) { for(let y=1;y<63;y++)for(let x=1;x<63;x++)s.cells[y][x]=1; for(const p of s.spawns)s.cells[p.y][p.x]=0; }
  for(const [key,team,sign] of [[c.a,"blue",mirrored?1:-1],[c.b,"red",mirrored?-1:1]] as const){
    const f = rosters.factions.find(f => f.mode === c.mode && f.actors.includes(key))!;
    for(let i=0;i<c.count;i++){
      const p = makePiece(s,key,f.id,team,{x:32+sign*Math.ceil(c.gap/2),y:24+i*4+(seed%3)});
      const error=placementIssue(s,p); if(error)throw new Error(actorFor(key).name+": "+error); s.pieces.push(p);
    }
  }
  return s;
}
function remaining(world:World,team:string){return world.pieces.filter(p=>p.team===team&&p.health>0).reduce((v,p)=>v+Math.max(0,actorFor(p.actorKey).cost??0)*p.health/maxHealth(actorFor(p.actorKey)),0);}
function snapshot(w:World):Frame { return structuredClone({time:w.time,pieces:w.pieces,effects:w.effects,shots:w.shots,damage:w.damage,destroyed:w.destroyed}); }
export function createTrial(c:EvalConfig,policy:Policy,rep:number){
  const seed=c.custom?.seed??c.seed+Math.floor(rep/2),mirrored=!c.custom&&rep%2===1,scene=trialScene(c,seed,mirrored),world=createWorld(scene);world.auto=false;
  return { world, scene, policy, seed, mirrored, commands:0,rejected:0, decisions:[] as string[],frames:[snapshot(world)], ticks:0,done:false,invalid:false };
}
export type TrialState=ReturnType<typeof createTrial>;
function decide(state:TrialState,team:"blue"|"red",policy:Policy){
  const w=state.world;
  for(const p of w.pieces.filter(p=>p.team===team&&p.health>0&&p.powered)){
    if(policy==="deploy"&&canDeploy(actorFor(p.actorKey)))p.deployed=true;
    const targets=w.pieces.filter(t=>t.health>0&&t.team!==team&&t.team!=="neutral"&&supportedWeapon(p,t));
    targets.sort((a,b)=>policy==="focus" ? a.health-b.health||a.id-b.id : Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)||a.id-b.id);
    const t=targets[0];if(!t)continue;
    const d=Math.hypot(t.x-p.x,t.y-p.y),range=prototypeRange(p);
    let order:Parameters<typeof issueOrder>[2]={type:"attack",targetId:t.id};
    if(policy==="hold"||policy==="deploy") { if(d>range){order={type:"hold"};} else { order={type:"attack",targetId:t.id}; } }
    if(policy==="kite"&&!p.deployed&&p.cooldown>.4&&d<range*.85&&d>0)order={type:"move",point:{x:Math.round(Math.max(1,Math.min(w.scene.size-2,p.x+(p.x-t.x)/d*3))),y:Math.round(Math.max(1,Math.min(w.scene.size-2,p.y+(p.y-t.y)/d*3)))}};
    if(p.order.type===order.type&&p.order.targetId===order.targetId&&(!order.point||Math.hypot((p.order.point?.x??0)-order.point.x,(p.order.point?.y??0)-order.point.y)<1))continue;
    state.commands++;const accepted=issueOrder(w,p.id,order);if(!accepted)state.rejected++;
    if(state.decisions.length<240)state.decisions.push(`${w.time.toFixed(1)}s · ${team} ${actorFor(p.actorKey).name} · ${order.type}${order.targetId?` #${order.targetId}`:""}${accepted?"":" (rejected)"}`);
  }
}
export function advanceTrial(state:TrialState,c:EvalConfig,ticks=100){
  for(let i=0;i<ticks&&!state.done;i++){
    if(state.ticks%10===0){decide(state,"blue",state.policy);decide(state,"red",c.opponent);}
    stepWorld(state.world);state.ticks++;
    state.invalid ||=state.world.pieces.some(p=>![p.x,p.y,p.health].every(Number.isFinite)||p.health<0);
    if(state.ticks%50===0)state.frames.push(snapshot(state.world));
    state.done=state.ticks>=c.duration*25||!["blue","red"].every(team=>state.world.pieces.some(p=>p.team===team&&p.health>0));
  }
  return state.done;
}
export function finishTrial(state:TrialState,c:EvalConfig,rep:number):Trial{
  const w=state.world;const alive=(team:string)=>w.pieces.some(p=>p.team===team&&p.health>0);
  const outcome=!alive("red")&&alive("blue")?"blue":!alive("blue")&&alive("red")?"red":"draw";
  if(state.frames.at(-1)!.time!==w.time)state.frames.push(snapshot(w));
  const checks:Check[]=[{name:"Simulation integrity",pass:!state.invalid,detail:"Finite positions and non-negative health"},{name:"Combat observed",pass:w.shots>0&&w.damage>0,detail:`${w.shots} shots · ${Math.round(w.damage)} damage`},{name:"Commands accepted",pass:state.rejected===0,detail:`${state.commands-state.rejected}/${state.commands} accepted`}];
  if(c.expectation==="blue-win")checks.push({name:"Blue wins",pass:outcome==="blue",detail:outcome==="draw"?"Time limit / stalemate":`${outcome} wins`});
  return {id:`${state.policy}-${rep}`,policy:state.policy,seed:state.seed,mirrored:state.mirrored,outcome,seconds:w.time,shots:w.shots,damage:w.damage,blueLeft:remaining(w,"blue"),redLeft:remaining(w,"red"),commands:state.commands,rejected:state.rejected,checks,frames:state.frames,decisions:state.decisions,scene:state.scene};
}
export function summarize(trials:Trial[],policy:Policy){
  const rows=trials.filter(t=>t.policy===policy),n=rows.length,wins=rows.filter(t=>t.outcome==="blue").length,draws=rows.filter(t=>t.outcome==="draw").length;
  const p=n?wins/n:0,z=1.96,den=1+z*z/Math.max(1,n),center=(p+z*z/(2*Math.max(1,n)))/den,half=z*Math.sqrt(p*(1-p)/Math.max(1,n)+z*z/(4*Math.max(1,n)**2))/den;
  return {n,wins,draws,score:n?(wins+.5*draws)/n:0,low:n?Math.max(0,center-half):0,high:n?Math.min(1,center+half):0,passes:rows.filter(t=>t.checks.every(c=>c.pass)).length,value:n?rows.reduce((sum,t)=>sum+t.blueLeft,0)/n:0};
}
export function reportFor(c:EvalConfig,trials:Trial[]):EvalReport{return {version:1,evidence:"browser-prototype",config:c,ruleCommit:rosters.sources[c.mode].commit,trials,created:new Date().toISOString()};}
