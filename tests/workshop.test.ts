import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { rosters, rosterFactionById, type GameMode } from "../lib/game-content";
import { actorFor, activeWeapons, canDeploy, conditionActive, createWorld, damageFor, dimensions, findPath, generateScene, issueOrder, makePiece, paintScene, parseScene, placementIssue, scenarioJson, stepWorld, supportedWeapon, type Scene } from "../lib/workshop";
import { compileWorkshopMap, nativeMapPosition, nativePosition, workshopArchive } from "../lib/workshop-export";
import { starterScene } from "../app/components/MapWorkshop";
const key=(id:string,mode="ra2")=>rosters.actors.find(a=>a.id===id&&a.mode===mode)!.key;
function add(scene:Scene,id:string,x:number,y:number,team:"blue"|"red"="blue",faction="america"){
  const p=makePiece(scene,key(id,scene.mode),faction,team,{x,y});
  assert.equal(placementIssue(scene,p),null,id);scene.pieces.push(p);return p;
}
function advance(world:ReturnType<typeof createWorld>,seconds:number){for(let i=0;i<seconds*25;i++)stepWorld(world);}

test("both starter scenes engage without requiring an initial order",()=>{
  for(const mode of ["ra","ra2"] as const){const world=createWorld(starterScene(mode));advance(world,30);assert.ok(world.shots>0,mode);assert.ok(world.damage>0,mode);}
});

test("terrain is deterministic across presets and modes, with valid spawns",()=>{
  for(const mode of ["ra","ra2"] as const)for(const preset of ["river","coast","islands","plains"] as const){
    const s=generateScene(mode,37,64,preset);assert.deepEqual(s,generateScene(mode,37,64,preset));
    assert.notDeepEqual(s.cells,generateScene(mode,38,64,preset).cells);
    for(const p of s.spawns)assert.notEqual(s.cells[p.y][p.x],1);
  }
});
test("all actor facts carry source behavior; every faction can place its complete roster",()=>{
  for(const a of rosters.actors){assert.ok(a.behavior.health>0);assert.ok(Array.isArray(a.behavior.weapons));assert.ok(Array.isArray(a.behavior.actions));}
  for(const faction of rosters.factions){
    const s=generateScene(faction.mode as GameMode,42,64,"plains");for(let y=1;y<63;y++)for(let x=35;x<63;x++)s.cells[y][x]=1;
    for(const actorKey of faction.actors){const a=actorFor(actorKey),p=makePiece(s,actorKey,faction.id,"blue",{x:a.behavior.waterPlacement?45:10,y:10});assert.equal(placementIssue(s,p),null,a.name);assert.deepEqual(dimensions(a).every(n=>n>0),true);}
  }
});
test("placement checks footprints, domains, borders, finite coordinates and painting protects placements",()=>{
  const s=generateScene("ra2",42,64,"plains"),building=add(s,"garefn",10,10);
  const blocked=makePiece(s,key("mtnk"),"america","blue",{x:11,y:11});assert.match(placementIssue(s,blocked)!,/occupied/);
  const naval=rosters.actors.find(a=>a.mode==="ra2"&&a.category==="ship")!;
  assert.match(placementIssue(s,makePiece(s,naval.key,"america","blue",{x:15,y:15}))!,/water/);
  blocked.x=NaN;assert.match(placementIssue(s,blocked)!,/finite/);
  const painted=paintScene(s,{x:10,y:10},1,2);assert.equal(painted.cells[building.y][building.x],s.cells[building.y][building.x]);assert.equal(painted.cells[8][8],1);
});
test("ground pathing crosses a causeway, avoids buildings, and rejects sealed water",()=>{
  const s=generateScene("ra2",42,64,"plains");const tank=add(s,"mtnk",10,20);
  for(let y=1;y<63;y++)s.cells[y][15]=1;s.cells[32][15]=2;
  const path=findPath(s,tank,{x:20,y:20});assert.ok(path.some(p=>p.x===15&&p.y===32));assert.ok(path.every(p=>s.cells[p.y][p.x]!==1));
  s.cells[32][15]=1;assert.equal(findPath(s,tank,{x:20,y:20}).length,0);
});
test("deployment and rank select configured weapons; malformed conditions do not execute",()=>{
  const s=generateScene(),p=makePiece(s,key("e1"),"america","blue",{x:10,y:10});
  assert.equal(canDeploy(actorFor(p.actorKey)),true);assert.ok(activeWeapons(p).some(w=>w.id==="M60"));
  p.deployed=true;assert.ok(activeWeapons(p).some(w=>w.id==="para"));assert.equal(findPath(s,p,{x:12,y:10}).length,0);
  p.rank="elite";assert.ok(activeWeapons(p).every(w=>!w.condition||conditionActive(w.condition,p)));
  assert.equal(conditionActive("deployed && (!disabled || rank-elite)",p),true);
  assert.equal(conditionActive("deployed; alert(1)",p),false);assert.equal(conditionActive("(",p),false);
});
test("target domains and armor constrain direct damage and orders",()=>{
  const s=generateScene("ra2",42,64,"plains"),tank=add(s,"mtnk",10,10),enemy=add(s,"mtnk",14,10,"red");
  const plane=add(s,"orca",14,11,"red");
  assert.equal(supportedWeapon(tank,plane),undefined);const weapon=supportedWeapon(tank,enemy)!;
  assert.equal(damageFor(tank,enemy,weapon),65);
  const world=createWorld(s);assert.equal(issueOrder(world,tank.id,{type:"attack",targetId:plane.id}),false);
  assert.equal(issueOrder(world,tank.id,{type:"attack",targetId:enemy.id}),true);
  assert.equal(issueOrder(world,tank.id,{type:"move",point:{x:NaN,y:10}}),false);
});
test("Classic target aliases support ground guns and anti-air without shooting inherited aircraft ground tags",()=>{
  const s=generateScene("ra",42,64,"plains");
  const tank=add(s,"2tnk",10,10,"blue","england"),aa=add(s,"cnmantis",12,10,"blue","china");
  const aircraft=rosters.actors.find(a=>a.mode==="ra"&&a.category==="aircraft")!;
  const target=makePiece(s,aircraft.key,"china","red",{x:13,y:10});
  assert.equal(supportedWeapon(tank,target),undefined);assert.ok(supportedWeapon(aa,target));
  assert.ok(supportedWeapon(tank,{...tank,id:99,team:"red"}));
});
test("naval yards use measured water placement while retaining building targets",()=>{
  for(const [mode,id] of [["ra2","gayard"],["ra2","nayard"],["ra","syrd"],["ra","spen"]] as const){
    const s=generateScene(mode,42,64,"plains"),a=actorFor(key(id,mode));assert.equal(a.behavior.waterPlacement,true);
    const yard=makePiece(s,a.key,mode==="ra2"?"america":"england","blue",{x:10,y:10});assert.match(placementIssue(s,yard)!,/water/);
    const [w,h]=dimensions(a);for(let y=10;y<10+h;y++)for(let x=10;x<10+w;x++)s.cells[y][x]=1;assert.equal(placementIssue(s,yard),null);
  }
});
test("a configured tank duel produces damage, destruction and persistent wrecks",()=>{
  const s=generateScene("ra2",42,64,"plains");add(s,"mtnk",10,10);add(s,"mtnk",14,10,"red");const world=createWorld(s);advance(world,20);
  assert.ok(world.shots>0);assert.ok(world.damage>0);assert.ok(world.destroyed>0);assert.ok(world.pieces.some(p=>p.phase==="wreck"));assert.ok(world.log.some(line=>line.includes("destroyed")));
});
test("aircraft attack, exit, return and rearm; destroyed aircraft fall",()=>{
  const s=generateScene("ra2",42,64,"plains"),plane=add(s,"orca",10,10),target=add(s,"garefn",14,10,"red"),world=createWorld(s);
  world.auto=false;assert.equal(issueOrder(world,plane.id,{type:"attack",targetId:target.id}),true);
  stepWorld(world);assert.equal(world.pieces[0].phase,"exit");assert.equal(world.pieces[0].ammo,0);
  let rearming=false,rearmed=false;for(let i=0;i<500;i++){stepWorld(world);rearming ||=String(world.pieces[0].phase)==="rearming";rearmed ||=world.log.some(line=>line.includes("rearmed"));}
  assert.ok(rearming);assert.ok(rearmed);assert.ok(world.shots>=2);
  const live=world.pieces[0];world.effects.push({x:0,y:0,to:live,target:live.id,from:target.id,kind:"projectile",damage:99999,duration:.04,life:.04,color:"#fff"});
  stepWorld(world);assert.equal(live.phase,"falling");advance(world,2);assert.equal(live.phase,"wreck");
});
test("scene files round-trip and reject invalid mode, faction, overlap and excessive size",()=>{
  const s=generateScene("ra2",42,64,"plains");add(s,"mtnk",10,10);assert.deepEqual(parseScene(scenarioJson(s)),s);
  assert.throws(()=>parseScene(JSON.stringify({...s,mode:"anything"})),/settings/);
  assert.throws(()=>parseScene(JSON.stringify({...s,pieces:[{...s.pieces[0],faction:"missing"}]})),/actor settings/);
  assert.throws(()=>parseScene(JSON.stringify({...s,pieces:[s.pieces[0],{...s.pieces[0],id:2}]})),/occupied/);
  assert.throws(()=>parseScene(" ".repeat(2_000_001)),/large/);
  assert.equal(rosterFactionById("america","ra2")?.actors.includes(s.pieces[0].actorKey),true);
});
test("Classic and RA2 exports retain tile, ore, actor and start coordinates in format 12",()=>{
  for(const mode of ["ra","ra2"] as const){
    const s=generateScene(mode,42,64,"plains");add(s,mode==="ra2"?"mtnk":"2tnk",10,10,"blue",mode==="ra2"?"america":"england");
    const map=compileWorkshopMap(s),view=new DataView(map.binary.buffer),area=map.width*map.height;
    assert.equal(view.getUint8(0),2);assert.equal(view.getUint16(1,true),map.width);assert.equal(map.binary.length,17+area*5);
    assert.match(map.yaml,/MapFormat: 12/);assert.match(map.yaml,mode==="ra2"?/RequiresMod: rtsai/:/RequiresMod: ra/);
    const all=new Set<string>();
    for(let y=0;y<s.size;y++)for(let x=0;x<s.size;x++){
      const p=nativeMapPosition(nativePosition(s,{x,y}),mode);assert.ok(p.x>=0&&p.x<map.width&&p.y>=0&&p.y<map.height);all.add(p.x+","+p.y);
      const index=p.x*map.height+p.y,tile=s.cells[y][x];
      assert.equal(view.getUint16(17+index*3,true),tile===1?(mode==="ra2"?314:1):tile===2?(mode==="ra2"?216:178):(mode==="ra2"?0:255));
      if(tile===3)assert.equal(map.binary[17+area*3+index*2],1);
    }
    assert.equal(all.size,64*64);
    const archive=unzipSync(workshopArchive(s,new Uint8Array([1,2,3])));
    assert.deepEqual(Object.keys(archive).sort(),["map.bin","map.png","map.yaml","workshop-readme.txt","workshop-scene.json"]);
    assert.equal(strFromU8(archive["map.yaml"]),map.yaml);assert.deepEqual(parseScene(strFromU8(archive["workshop-scene.json"])),s);
  }
});
