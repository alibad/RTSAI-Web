/** Local browser verification. Every pictured sprite/cameo/palette is authored here. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output=resolve(".cache/encounter-check");mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
const page=await browser.newPage({viewport:{width:1430,height:1000}}),errors=[],visualRequests=[];
page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(r.url().includes("/visual?"))visualRequests.push(r.url());});
await page.addInitScript(()=>localStorage.setItem("rtsai-art-review-coach-v3","1"));
const shp=(effect=false)=>{
  const w=80,h=64,n=128,b=Buffer.alloc(8+n*24+n*w*h);b.writeUInt16LE(w,2);b.writeUInt16LE(h,4);b.writeUInt16LE(n,6);
  for(let f=0;f<n;f++){const at=8+f*24,data=8+n*24+f*w*h;b.writeUInt16LE(w,at+4);b.writeUInt16LE(h,at+6);b.writeUInt32LE(data,at+20);
    const rect=(x,y,r,bt,c)=>{for(let yy=y;yy<bt;yy++)for(let xx=x;xx<r;xx++)b[data+yy*w+xx]=c;};
    if(effect){const radius=3+f%12;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((x-40)**2+(y-32)**2<radius**2)b[data+y*w+x]=f%2?7:8;}
    else{rect(17,31,62,45,2);rect(21,26,59,41,3);rect(21,28,26,41,4);rect(54,28,59,41,4);rect(31,22,47,33,5);const angle=(f%32)/32*Math.PI*2;for(let r=0;r<24;r++){const x=Math.round(39+Math.cos(angle)*r),y=Math.round(25+Math.sin(angle)*r*.55);rect(x,y,x+3,y+3,3);}rect(29,38,52,40,6);}
  }return b;
};
const pal=Buffer.alloc(768);[[0,0,0],[0,0,0],[14,16,15],[54,53,47],[25,26,23],[61,60,54],[55,20,17],[63,48,17],[63,61,43]].forEach((c,i)=>c.forEach((v,j)=>pal[i*3+j]=v));
try{
  const roster=await(await fetch("http://127.0.0.1:3461/api/art-review/roster?mode=ra2")).json();
  const ids=["r2qilin","htnk","r2mantis"].filter(id=>roster.stock[id]);
  roster.factions=roster.factions.map(f=>({...f,units:f.units.filter(u=>ids.includes(u.id)),replaced:[]})).filter(f=>f.units.length);
  roster.stock=Object.fromEntries(ids.map(id=>[id,roster.stock[id]]));
  for(const stock of Object.values(roster.stock)){
    const seq={name:"idle",file:"/api/art-review/classic/test.shp",external:null,start:0,length:1,stride:1,facings:32,reverseFacings:false,useClassicFacings:false,transpose:false,tick:40,zOffset:0,shadowStart:-1,offset:[0,0,0],frames:null,reverses:false,usedBy:["WithSpriteBody"],inherited:false};
    const sprite={...stock.sprite,image:stock.info.id,sequences:[seq],turret:null,overlay:null,overlays:[],quantizedFacings:32};
    stock.sprite=sprite;stock.spec={...stock.spec,voxel:null,parts:[],sprite,cameo:`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="48" viewBox="0 0 60 48"><rect width="60" height="48" rx="4" fill="#263029"/><rect x="8" y="23" width="42" height="15" fill="#53554d"/><rect x="12" y="18" width="34" height="16" fill="#d5d4c1"/><rect x="22" y="13" width="17" height="14" fill="#eeecd9"/><path d="M30 19h25" stroke="#eeecd9" stroke-width="4"/><path d="M12 35h34" stroke="#a74442" stroke-width="3"/></svg>')}`};
  }
  await page.route("**/api/art-review/roster?*",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(roster)}));
  // Asset routes are replaced before navigation. No original pixels are downloaded into screenshots.
  const binary=r=>r.fulfill({status:200,contentType:"application/octet-stream",body:new URL(r.request().url()).pathname.endsWith(".pal")?pal:shp()});
  await page.route("**/api/art-review/ra2/**",binary);await page.route("**/api/art-review/classic/**",binary);await page.route("**/api/art-review/mod/**",binary);
  await page.route("**/api/art-review/visual?*",async r=>{const native=await r.fetch();const value=await native.json();value.sequence.file="/test-effect.shp";value.palette.url="/test-effect.pal";await r.fulfill({json:value});});
  await page.route("**/test-effect.shp",r=>r.fulfill({body:shp(true),contentType:"application/octet-stream"}));await page.route("**/test-effect.pal",r=>r.fulfill({body:pal,contentType:"application/octet-stream"}));
  await page.goto("http://127.0.0.1:3461/art/review?faction=china&unit=r2qilin&slot=model&mode=ra2&view=arena");
  const search=page.getByRole("searchbox",{name:"Search encounter units"});await search.waitFor();assert.equal(await page.locator(".enc-placed").count(),2);
  await search.fill("qilin");assert.equal(await page.locator(".enc-unit-card").count(),1);
  const field=page.locator(".enc-field canvas"),box=await field.boundingBox();
  await page.locator(".enc-unit-card").first().dragTo(field,{targetPosition:{x:box.width*.36,y:box.height*.6}});
  assert.equal(await page.locator(".enc-placed").count(),3,"native HTML drag adds an actor");
  const original=await page.locator(".enc-placed").first().innerText();
  await page.mouse.move(box.x+box.width*.24,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.28,box.y+box.height*.54,{steps:4});await page.mouse.up();
  assert.notEqual(await page.locator(".enc-placed").first().innerText(),original,"pointer dragging repositions an existing actor");
  await page.locator(".enc-placed").last().click();
  const before=await page.locator(".enc-placed[aria-pressed=true]").innerText();
  await field.focus();await page.keyboard.press("ArrowRight");assert.notEqual(await page.locator(".enc-placed[aria-pressed=true]").innerText(),before,"keyboard moves placed actor");
  await page.getByRole("button",{name:"Move to…",exact:true}).click();await field.click({position:{x:box.width*.47,y:box.height*.65}});
  assert.match(await page.locator(".enc-placed[aria-pressed=true]").innerText(),/move/);
  await page.getByRole("button",{name:"Duplicate selected actor"}).click();assert.equal(await page.locator(".enc-placed").count(),4);
  await page.getByRole("button",{name:"Remove selected actor"}).click();assert.equal(await page.locator(".enc-placed").count(),3);
  // Searchable visual faction chooser and Escape return focus to its trigger.
  await page.getByRole("button",{name:"Palette faction",exact:true}).click();await page.getByRole("textbox",{name:"Search Palette faction"}).fill("china");
  assert.equal(await page.getByRole("dialog",{name:"Choose faction"}).getByRole("option").count(),1);await page.keyboard.press("Escape");
  await search.fill("");await page.waitForTimeout(400);
  await page.screenshot({path:resolve(output,"setup-authored-fixtures.png")});
  const submitted=page.waitForRequest(r=>r.url().endsWith("/api/art-review/duel")&&r.method()==="POST");
  await page.getByRole("button",{name:"Run encounter",exact:true}).click();const request=(await submitted).postDataJSON();assert.equal(request.placements.length,3);assert.ok(request.placements.some(p=>p.order==="move"&&p.destination));
  await page.getByRole("button",{name:"First shot",exact:true}).waitFor({timeout:90000});
  await page.getByRole("button",{name:"First impact",exact:true}).click();await page.waitForTimeout(500);
  assert.ok(visualRequests.length>0,"replay resolves actual native effect references");
  assert.match(await page.locator(".enc-field-status").innerText(),/Measured/);
  await page.screenshot({path:resolve(output,"replay-authored-fixtures.png")});
  await page.getByRole("button",{name:"Edit setup",exact:true}).click();assert.match(await page.locator(".enc-field-status").innerText(),/not simulated/);
  assert.deepEqual(errors,[]);
  const report={search:true,htmlDrag:true,pointerReposition:true,keyboardPlacement:true,moveDestination:true,duplicateRemove:true,nativeRequest:request,nativeVisualReferences:visualRequests.length,pageErrors:errors,screenshotArt:"Authored synthetic fixtures; no original game pixels"};
  writeFileSync(resolve(output,"browser.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
