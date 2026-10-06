import { actorFor, dimensions, isBuilding, maxHealth, prototypeRange, type LivePiece, type Point, type Scene, type World, type WorkshopActor } from "./workshop";
import type { WorkshopUnitArt } from "./workshop-units";

export type Camera = { panX: number; panY: number; zoom: number; iso: boolean };
export function project(p: Point, size: number, iso: boolean): Point {
  return iso ? { x: (p.x - p.y) * 20 + size * 20, y: (p.x + p.y) * 10 + 12 } : { x: (p.x + .5) * 24, y: (p.y + .5) * 24 };
}
export function unproject(p: Point, size: number, iso: boolean): Point {
  if (!iso) return { x: p.x / 24 - .5, y: p.y / 24 - .5 };
  const x = (p.x - size * 20) / 20, y = (p.y - 12) / 10;
  return { x: (x + y) / 2, y: (y - x) / 2 };
}
/** Where an actor stands: its cell, or the centre of a building's footprint (OpenRA's CenterPosition). */
export function footprintCenter(piece: Point & { actorKey: string }): Point {
  const [w, h] = dimensions(actorFor(piece.actorKey));
  return { x: piece.x + (w - 1) / 2, y: piece.y + (h - 1) / 2 };
}
export function fitScale(scene: Scene, width: number, height: number, iso: boolean) {
  return Math.min((width - 48) / (scene.size * (iso ? 40 : 24)), (height - 50) / (scene.size * (iso ? 20 : 24) + 24));
}
export function screenToCell(p: Point, scene: Scene, camera: Camera, width: number, height: number): Point {
  const scale = fitScale(scene, width, height, camera.iso) * camera.zoom;
  const worldWidth = scene.size * (camera.iso ? 40 : 24), worldHeight = scene.size * (camera.iso ? 20 : 24) + (camera.iso ? 24 : 0);
  return unproject({ x: (p.x - width / 2 - camera.panX) / scale + worldWidth / 2, y: (p.y - height / 2 - camera.panY) / scale + worldHeight / 2 }, scene.size, camera.iso);
}
function polygon(ctx: CanvasRenderingContext2D, points: number[][], color: string, stroke?: string) {
  ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = .6; ctx.stroke(); }
}
export function terrainCanvas(scene: Scene, iso: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = scene.size * (iso ? 40 : 24); canvas.height = scene.size * (iso ? 20 : 24) + (iso ? 24 : 0);
  const ctx = canvas.getContext("2d")!;
  const land = ["#566247","#5b684a","#606d4e","#526042","#626f50","#596747"];
  for (let y = 0; y < scene.size; y++) for (let x = 0; x < scene.size; x++) {
    const p = project({ x, y }, scene.size, iso), c = scene.cells[y][x], n = Math.abs((x * 17 + y * 31 + scene.seed) % 6);
    const color = c === 1 ? ["#294e59","#2a515c","#2c5460"][n % 3] : c === 2 ? "#95896d" : c === 3 ? "#6a7450" : land[n];
    if (iso) polygon(ctx, [[p.x,p.y-10],[p.x+20,p.y],[p.x,p.y+10],[p.x-20,p.y]], color, "rgba(12,26,17,.12)");
    else { ctx.fillStyle = color; ctx.fillRect(p.x-12,p.y-12,24,24); }
    if (c === 1 && n === 0) { ctx.strokeStyle = "#51818a"; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(p.x-6,p.y); ctx.lineTo(p.x+5,p.y); ctx.stroke(); }
    if (c === 3) { for (let k = 0; k < 3; k++) polygon(ctx, [[p.x+k*5-6,p.y-3],[p.x+k*5-3,p.y-5],[p.x+k*5,p.y-1],[p.x+k*5-4,p.y+1]], "#d2b45b"); }
    if (c === 0 && n === 2 && (x*7+y*11+scene.seed)%19 === 0) { ctx.fillStyle = "#394930"; ctx.beginPath(); ctx.ellipse(p.x,p.y+2,6,3,0,0,Math.PI*2); ctx.fill(); polygon(ctx, [[p.x,p.y-14],[p.x+5,p.y],[p.x-5,p.y]], "#3b533b"); }
  }
  return canvas;
}

const teamColor = (piece: LivePiece) => piece.team==="blue"?"#77c3de":piece.team==="red"?"#e8997f":"#d7c892";
const teamShade = (piece: LivePiece) => piece.team==="blue"?"#34687e":piece.team==="red"?"#8b5146":"#6b6850";

/** The tactical symbols of the projection that has no art (and of the replay views). */
function drawSymbol(ctx: CanvasRenderingContext2D, piece: LivePiece, actor: WorkshopActor, p: Point, iso: boolean) {
  const color = teamColor(piece), teamDark = teamShade(piece);
  const air=actor.category==="aircraft", altitude=air?(piece.phase==="falling"?Math.max(0,piece.phaseTime/1.5)*25:piece.health>0?25:0):0;
  ctx.save(); ctx.translate(p.x,p.y);
  ctx.fillStyle="rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(4,4,air?15:14,6,0,0,Math.PI*2); ctx.fill();
  if (piece.health<=0 && piece.phase!=="falling") {
    ctx.fillStyle="#393d32"; ctx.beginPath(); ctx.ellipse(0,0,isBuilding(actor)?20:11,7,0,0,Math.PI*2); ctx.fill(); polygon(ctx,[[-7,-3],[4,-6],[9,1],[-3,4]],"#65604d"); ctx.restore(); return;
  }
  if (isBuilding(actor)) {
    const [w,h]=dimensions(actor), wide=Math.max(14,(w+h)*7), depth=iso?Math.max(8,(w+h)*3.5):Math.max(10,h*7), tall=actor.category==="defense"?18:18+Math.min(16,w*3);
    polygon(ctx,[[-wide,0],[0,depth],[0,depth-tall],[-wide,-tall]],teamDark);
    polygon(ctx,[[0,depth],[wide,0],[wide,-tall],[0,depth-tall]],"#535b48");
    polygon(ctx,[[-wide,-tall],[0,-depth-tall],[wide,-tall],[0,depth-tall]],"#b6b298","#d7d0aa");
    polygon(ctx,[[-wide*.55,-tall],[0,-depth*.6-tall],[wide*.55,-tall],[0,depth*.6-tall]],color);
    if(actor.category==="defense") { ctx.fillStyle=teamDark; ctx.fillRect(-5,-tall-8,10,8); ctx.strokeStyle="#ddd6b8"; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(0,-tall-4); ctx.lineTo(Math.cos(piece.facing)*19,-tall-4+Math.sin(piece.facing)*8); ctx.stroke(); }
    else { ctx.fillStyle="#4d5746"; ctx.fillRect(-5,-tall-10,8,10); ctx.fillStyle=color; ctx.fillRect(-3,-tall-13,12,5); }
  } else {
    const angle=iso?Math.atan2(Math.sin(piece.facing)+Math.cos(piece.facing),2*(Math.cos(piece.facing)-Math.sin(piece.facing))):piece.facing;
    ctx.translate(0,-altitude); ctx.rotate(angle);
    if (actor.category==="aircraft") { polygon(ctx,[[-17,0],[-9,-4],[-12,-18],[0,-9],[14,-2],[20,0],[14,2],[0,9],[-12,18],[-9,4]],"#d6d3bd",teamDark); polygon(ctx,[[-9,-3],[7,-3],[13,0],[7,3],[-9,3]],color); }
    else if (actor.category==="ship") { polygon(ctx,[[-21,-7],[10,-8],[24,0],[10,8],[-21,7]],"#bcbcaf",teamDark); ctx.fillStyle=teamDark; ctx.fillRect(-11,-5,20,10); ctx.fillStyle=color; ctx.fillRect(-3,-4,10,8); ctx.fillStyle="#dfd9bd"; ctx.fillRect(7,-1,17,2); }
    else if(actor.category==="infantry") { ctx.fillStyle=teamDark; ctx.fillRect(-7,-5,10,10); ctx.fillStyle="#e1ce9f"; ctx.beginPath(); ctx.arc(-2,-3,4,0,Math.PI*2); ctx.fill(); ctx.fillStyle=color; ctx.fillRect(-4,-4,5,3); ctx.strokeStyle="#d7d1b5"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,2); ctx.lineTo(10,1); ctx.stroke(); if(piece.deployed) { ctx.strokeStyle="#d3c18c"; ctx.lineWidth=3; ctx.strokeRect(-9,-8,19,16); } }
    else { ctx.fillStyle="#2e3531"; ctx.fillRect(-17,-10,30,5); ctx.fillRect(-17,5,30,5); polygon(ctx,[[-16,-6],[9,-6],[16,0],[9,6],[-16,6]],"#a2ad92",teamDark); ctx.fillStyle=color; ctx.fillRect(-5,-5,13,10); ctx.fillStyle="#d8d4b2"; ctx.fillRect(4,-1.5,23,3); }
  }
  ctx.restore();
}

/** Screen direction of a cell-space heading in this projection. */
function headingOnScreen(radians: number, iso: boolean) {
  const x = Math.cos(radians), y = Math.sin(radians);
  const v = iso ? { x: (x - y) * 20, y: (x + y) * 10 } : { x, y };
  const d = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / d, y: v.y / d };
}

/** A small category pictogram, centred at the origin (about 10 x 10). */
function glyph(ctx: CanvasRenderingContext2D, category: string) {
  ctx.beginPath();
  if (category === "infantry") { ctx.arc(0, -3, 2.2, 0, Math.PI * 2); ctx.moveTo(-3, 4.5); ctx.lineTo(0, -.5); ctx.lineTo(3, 4.5); ctx.closePath(); }
  else if (category === "aircraft") { ctx.moveTo(0, -5); ctx.lineTo(1.4, -1); ctx.lineTo(5, 1); ctx.lineTo(1.4, 1.2); ctx.lineTo(1, 4); ctx.lineTo(2.6, 5); ctx.lineTo(-2.6, 5); ctx.lineTo(-1, 4); ctx.lineTo(-1.4, 1.2); ctx.lineTo(-5, 1); ctx.lineTo(-1.4, -1); ctx.closePath(); }
  else if (category === "ship") { ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.lineTo(3, 4); ctx.lineTo(-3, 4); ctx.closePath(); ctx.rect(-1.5, -4, 3, 4); }
  else if (category === "defense") { ctx.moveTo(0, -5); ctx.lineTo(4.5, -3); ctx.lineTo(3.6, 2); ctx.lineTo(0, 5); ctx.lineTo(-3.6, 2); ctx.lineTo(-4.5, -3); ctx.closePath(); }
  else if (category === "structure") { ctx.rect(-4.5, -1, 9, 6); ctx.moveTo(-5.5, -1); ctx.lineTo(0, -5); ctx.lineTo(5.5, -1); ctx.closePath(); }
  else { ctx.rect(-5, -1.5, 8, 5); ctx.rect(-2.5, -4, 4, 3); ctx.rect(1.5, -3.2, 4.5, 1.4); }
  ctx.fill();
}

/** A clean marker for an actor whose art is not available here (original RA2 units on the public site). */
function drawToken(ctx: CanvasRenderingContext2D, piece: LivePiece, actor: WorkshopActor, p: Point, iso: boolean, altitude: number) {
  const color = teamColor(piece), dark = teamShade(piece), ry = iso ? .5 : 1;
  ctx.save(); ctx.translate(p.x, p.y);
  if (altitude) { ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.beginPath(); ctx.ellipse(0, 0, 12, 12 * ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.translate(0, -altitude); }
  if (isBuilding(actor)) {
    const [w, h] = dimensions(actor), cell = (dx: number, dy: number) => iso ? [(dx - dy) * 20, (dx + dy) * 10] : [dx * 24, dy * 24];
    const outline = [cell(-w / 2, -h / 2), cell(w / 2, -h / 2), cell(w / 2, h / 2), cell(-w / 2, h / 2)];
    polygon(ctx, outline, "rgba(14,20,16,.55)"); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(2, 2, 12, 12 * ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(14,20,16,.8)"; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(0, 0, 11, 11 * ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const d = headingOnScreen(piece.facing, iso);
    // A notch on the ring shows the heading.
    const reach = 1 / Math.sqrt((d.x * d.x) / 121 + (d.y * d.y) / (121 * ry * ry)), rim = { x: d.x * reach, y: d.y * reach };
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(rim.x + d.x * 5, rim.y + d.y * 5); ctx.lineTo(rim.x - d.y * 3.5, rim.y + d.x * 3.5); ctx.lineTo(rim.x + d.y * 3.5, rim.y - d.x * 3.5); ctx.closePath(); ctx.fill();
  }
  const lift = isBuilding(actor) ? 14 : 12;
  ctx.fillStyle = dark; ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(-8, -lift - 8, 16, 16, 3); ctx.fill(); ctx.stroke();
  ctx.translate(0, -lift); ctx.fillStyle = "#f0ecdc"; glyph(ctx, actor.category);
  ctx.restore();
}

function blast(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, size: number) {
  if (age < 1.1) { const radius = (6 + age * 26) * size, g = ctx.createRadialGradient(x, y - 6 * size, 0, x, y - 6 * size, radius); g.addColorStop(0, `rgba(255,247,206,${1 - age})`); g.addColorStop(.35, `rgba(255,199,91,${.9 - age * .8})`); g.addColorStop(.7, `rgba(236,85,43,${.6 - age * .5})`); g.addColorStop(1, "rgba(237,82,32,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 6 * size, radius, 0, Math.PI * 2); ctx.fill(); }
  for (let i = 0; i < 5; i++) { const phase = i * 2.399, drift = age * (6 + i * 2) * size; ctx.fillStyle = `rgba(66,62,54,${Math.max(0, .5 - age / 3)})`; ctx.beginPath(); ctx.arc(x + Math.sin(phase) * drift, y - (8 + age * 14 + Math.cos(phase) * drift * .5) * size, (4 + age * 5) * size, 0, Math.PI * 2); ctx.fill(); }
}

/**
 * Draws the battlefield. With `art` (the Workshop's unit art), actors appear as their in-game art in the projection
 * the art was made for, or as clean markers when their art is not available; otherwise as tactical symbols.
 */
export function drawWorld(ctx: CanvasRenderingContext2D, scene: Scene, world: World, terrain: HTMLCanvasElement, camera: Camera, width: number, height: number, selected: number | null, showRanges: boolean, hover?: Point | null, art?: WorkshopUnitArt | null) {
  ctx.clearRect(0,0,width,height); ctx.fillStyle="#101a17"; ctx.fillRect(0,0,width,height);
  const scale = fitScale(scene,width,height,camera.iso)*camera.zoom;
  const worldWidth=terrain.width, worldHeight=terrain.height;
  ctx.save(); ctx.translate(width/2+camera.panX,height/2+camera.panY); ctx.scale(scale,scale); ctx.translate(-worldWidth/2,-worldHeight/2);
  ctx.drawImage(terrain,0,0);
  for (const [i,spawn] of scene.spawns.entries()) {
    const p=project(spawn,scene.size,camera.iso); ctx.strokeStyle=i===0?"#91cfde":"#e7a17b"; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(p.x,p.y,camera.iso?26:20,camera.iso?13:20,0,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle=ctx.strokeStyle; ctx.font="bold 15px Arial"; ctx.fillText(i===0?"A":"B",p.x-5,p.y+5);
  }
  const showArt = Boolean(art?.shows(camera.iso));
  if (showArt) art!.prepare(world);
  const placed = world.pieces.map(piece => ({ piece, actor: actorFor(piece.actorKey), center: footprintCenter(piece) }));
  placed.sort((a,b)=>a.center.x+a.center.y-b.center.x-b.center.y);
  const at = new Map(placed.map(({ piece, center }) => [piece.id, project(center, scene.size, camera.iso)]));

  // Ground: ranges, the selection ring and the selected actor's path.
  for (const { piece, actor } of placed) {
    const p = at.get(piece.id)!, color = teamColor(piece);
    if ((piece.id===selected || showRanges) && piece.health>0) {
      const r=prototypeRange(piece);
      if (r) { ctx.strokeStyle=color+"66"; ctx.fillStyle=color+"09"; ctx.lineWidth=1.2; ctx.beginPath(); ctx.ellipse(p.x,p.y,r*(camera.iso?Math.SQRT2*20:24),r*(camera.iso?Math.SQRT2*10:24),0,0,Math.PI*2); ctx.fill(); ctx.stroke(); }
    }
    if (piece.id===selected) {
      const [w,h]=dimensions(actor), rx=isBuilding(actor)?Math.max(22,(w+h)*11):22;
      ctx.strokeStyle="#fff0b5"; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(p.x,p.y,rx,camera.iso?rx/2:rx*.9,0,0,Math.PI*2); ctx.stroke();
      if (piece.path.length) { ctx.strokeStyle=color+"aa"; ctx.setLineDash([6,4]); ctx.beginPath(); ctx.moveTo(p.x,p.y); for(const point of piece.path) { const pp=project(point,scene.size,camera.iso); ctx.lineTo(pp.x,pp.y); } ctx.stroke(); ctx.setLineDash([]); }
    }
    if (showArt && piece.health<=0 && piece.phase!=="falling") { ctx.fillStyle="rgba(28,30,24,.55)"; ctx.beginPath(); ctx.ellipse(p.x,p.y,isBuilding(actor)?24:12,camera.iso?(isBuilding(actor)?12:6):12,0,0,Math.PI*2); ctx.fill(); }
  }

  // Actors, back to front: art is batched; markers and symbols flush it first so depth order holds.
  const tops = new Map<number, number>();
  if (showArt) art!.begin();
  for (const { piece, actor } of placed) {
    const p = at.get(piece.id)!;
    if (!showArt) { drawSymbol(ctx, piece, actor, p, camera.iso); continue; }
    const drawn = art!.piece(ctx, world, piece, p, camera.iso);
    if (drawn) {
      if (drawn.lift > 0) { ctx.fillStyle="rgba(0,0,0,.22)"; ctx.beginPath(); ctx.ellipse(p.x,p.y,14,camera.iso?6:12,0,0,Math.PI*2); ctx.fill(); }
      tops.set(piece.id, drawn.top - drawn.lift);
      continue;
    }
    art!.flush(ctx);
    if (piece.health > 0 || piece.phase === "falling") {
      const altitude = actor.category === "aircraft" ? (piece.phase === "falling" ? Math.max(0, piece.phaseTime / 1.5) : 1) * 25 : 0;
      drawToken(ctx, piece, actor, p, camera.iso, altitude);
      tops.set(piece.id, -altitude - (isBuilding(actor) ? 22 : 20));
    }
  }
  if (showArt) art!.flush(ctx);

  // Health bars and the selected actor's name, above every actor.
  for (const { piece, actor } of placed) {
    if (piece.health<=0) continue;
    const p = at.get(piece.id)!, [w,h]=dimensions(actor);
    const air=actor.category==="aircraft", symbolTop=-(air?25:0)-(isBuilding(actor)?30+Math.min(16,w*3):20);
    const barY=p.y+(tops.has(piece.id)?Math.min(-10,tops.get(piece.id)!)-6:showArt?-(isBuilding(actor)?30:26):symbolTop), barW=isBuilding(actor)?Math.min(50,(w+h)*7):27;
    ctx.fillStyle="#1c2420"; ctx.fillRect(p.x-barW/2,barY,barW,3);
    ctx.fillStyle=piece.health/maxHealth(actor)>.4?"#a1c68b":"#ef9b70"; ctx.fillRect(p.x-barW/2,barY,barW*piece.health/maxHealth(actor),3);
    if(piece.id===selected) { ctx.font=String(12/scale)+"px Arial"; ctx.textAlign="center"; const text=actor.name; const textWidth=ctx.measureText(text).width; ctx.fillStyle="#102019e8"; ctx.fillRect(p.x-textWidth/2-5,barY-25/scale,textWidth+10,18/scale); ctx.fillStyle="#f0eee0"; ctx.fillText(text,p.x,barY-12/scale); ctx.textAlign="start"; }
  }

  for(const e of world.effects) {
    const p=project(e,scene.size,camera.iso), target=world.pieces.find(p=>p.id===e.target), q=project(target??e.to,scene.size,camera.iso), progress=1-e.life/e.duration;
    if(e.kind==="projectile") { ctx.strokeStyle=e.color; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(p.x+(q.x-p.x)*Math.max(0,progress-.14),p.y+(q.y-p.y)*Math.max(0,progress-.14)); ctx.lineTo(p.x+(q.x-p.x)*progress,p.y+(q.y-p.y)*progress); ctx.stroke(); ctx.fillStyle="#ffdf86"; ctx.beginPath(); ctx.arc(p.x+(q.x-p.x)*progress,p.y+(q.y-p.y)*progress,3,0,Math.PI*2); ctx.fill(); }
    else { ctx.globalAlpha=Math.max(0,1-progress); ctx.fillStyle="#f2c575"; ctx.beginPath(); ctx.arc(p.x,p.y,4+progress*18,0,Math.PI*2); ctx.fill(); ctx.strokeStyle="#ffe6ab"; ctx.lineWidth=2; ctx.stroke(); ctx.globalAlpha=1; }
  }
  if (showArt) for (const { piece, actor } of placed) {
    const p = at.get(piece.id)!;
    // A destroyed vehicle, ship, aircraft or building bursts before its wreck shows (infantry play their own death).
    const dead = art!.deadFor(world, piece.id);
    if (dead !== null && dead < 2 && actor.category !== "infantry" && piece.phase !== "falling") blast(ctx, p.x, p.y, dead, isBuilding(actor) ? 1.5 : 1);
    // Without the art's own muzzle flash, a brief illustrative flash marks each shot.
    const fired = art!.firedFor(world, piece.id);
    if (piece.health > 0 && fired < .1 && !art!.ownFlash(piece)) { ctx.fillStyle=`rgba(255,236,170,${1-fired*10})`; ctx.beginPath(); ctx.arc(p.x,p.y-(tops.has(piece.id)?Math.max(6,-tops.get(piece.id)!*.55):10),3.5,0,Math.PI*2); ctx.fill(); }
  }
  if(hover) { const p=project({x:Math.round(hover.x),y:Math.round(hover.y)},scene.size,camera.iso); ctx.strokeStyle="#fff2b9aa"; ctx.lineWidth=1.5; if(camera.iso) polygon(ctx,[[p.x,p.y-10],[p.x+20,p.y],[p.x,p.y+10],[p.x-20,p.y]],"#ffffcc12","#fff2b9aa"); else ctx.strokeRect(p.x-12,p.y-12,24,24); }
  ctx.restore();
}
