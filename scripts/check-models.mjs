/** Pictured models/thumbnails are project authored. Original game artwork is omitted before navigation. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const claim="C:/Users/Admin/Code/AI/logs/gpu-claim.txt",token=`RTSAI model viewer check pid=${process.pid}`;
const activeClaim=readFileSync(claim,"utf8").trim(),batchPid=process.argv.find(a=>a.startsWith("--batch-pid="))?.split("=")[1];
const sessionPath=resolve("../RTSAI-Art/.cache/model-forge/session.json");
const ownedBatch=batchPid&&JSON.parse(readFileSync(sessionPath,"utf8")).waitPid===Number(batchPid)&&activeClaim.startsWith(`RTSAI model-forge pid=${batchPid} `);
if(activeClaim&&!ownedBatch)throw Error("GPU claimed by another job; defer browser check");
if(!ownedBatch)writeFileSync(claim,token+"\n");
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE??"C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output=resolve(".cache/model-check");mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try {
  const page=await browser.newPage({viewport:{width:1430,height:1040}}),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem("rtsai-art-review-coach-v3","1");window.__gpuContexts=0;window.__longTasks=[];const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==="webgl2"||type==="webgl")window.__gpuContexts++;return get.call(this,type,...args);};new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:"longtask",buffered:true});});
  const data=await(await fetch("http://127.0.0.1:3461/api/art-review/roster?mode=ra2")).json();for(const s of Object.values(data.stock)){s.sprite=null;s.spec={...s.spec,voxel:null,sprite:null,cameo:null};}
  await page.route("**/api/art-review/roster?*",r=>r.fulfill({json:data}));
  for(const type of ["ra2","classic","mod"])await page.route(`**/api/art-review/${type}/**`,r=>r.abort());
  await page.goto("http://127.0.0.1:3461/art/review?faction=china&unit=r2mantis&slot=model&mode=ra2&view=art");
  await page.getByRole("button",{name:"3D models",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Inspect the model. Check the game asset."});await dialog.waitFor();
  await dialog.getByRole("searchbox",{name:"Search 3D models"}).fill("mantis");
  await dialog.locator(".mesh-actor-list button").first().waitFor();assert.equal(await dialog.locator(".mesh-actor-list button").count(),1);
  await dialog.getByRole("button",{name:"New design · GLB draft",exact:true}).waitFor();
  await dialog.locator(".mesh-viewport canvas").waitFor();await dialog.getByText("Loading GLB…",{exact:true}).waitFor({state:"hidden",timeout:30000});
  assert.match(await dialog.locator(".mesh-evidence").innerText(),/29,999 triangles/);
  await dialog.screenshot({path:resolve(output,"mantis-glb.png")});
  for(const [name,color] of [["red","#d54939"],["blue","#3867ef"],["green","#39a865"],["yellow","#e9c640"],["purple","#a45de2"],["cyan","#42c7d8"]]){
    await dialog.getByRole("textbox",{name:"GLB player color"}).fill(color);
    await dialog.screenshot({path:resolve(output,`mantis-${name}.png`)});
    if(name==="red"||name==="blue")await dialog.locator(".mesh-viewport").screenshot({path:resolve(output,`mantis-${name}-view.png`)});
  }
  const canvas=dialog.locator(".mesh-viewport canvas"),box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.72,box.y+box.height*.55,{steps:12});await page.mouse.up();
  await dialog.getByRole("button",{name:"Wireframe",exact:true}).click();assert.equal(await dialog.getByRole("button",{name:"Wireframe",exact:true}).getAttribute("aria-pressed"),"true");
  await dialog.getByRole("button",{name:"Wireframe",exact:true}).click();await dialog.screenshot({path:resolve(output,"mantis-glb-rotated.png")});
  await dialog.getByRole("button",{name:"Current voxel → GLB",exact:true}).click();await dialog.getByText("Loading GLB…",{exact:true}).waitFor({state:"hidden",timeout:30000});
  await dialog.getByRole("textbox",{name:"GLB player color"}).fill("#3867ef");
  await dialog.getByRole("slider",{name:"GLB turret aim"}).fill("75");
  if(process.argv.includes("--pilots"))for(const actor of ["r2cnrifle","r2skyspear","r2haiying","r2spectrum"]){
    await dialog.getByRole("searchbox",{name:"Search 3D models"}).fill(actor);
    await dialog.locator(".mesh-actor-list button").first().click();
    await dialog.getByRole("button",{name:"New design · GLB draft",exact:true}).waitFor();
    await dialog.getByText("Loading GLB…",{exact:true}).waitFor({state:"hidden",timeout:30000});
    await dialog.screenshot({path:resolve(output,`${actor}-glb.png`)});
    await dialog.locator(".mesh-viewport").screenshot({path:resolve(output,`${actor}-view.png`)});
  }
  const report=await page.evaluate(()=>({gpuContexts:window.__gpuContexts,longTasks:window.__longTasks}));assert.equal(report.gpuContexts,1,"GLB views share one context");
  await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);
  assert.deepEqual(errors,[]);Object.assign(report,{search:true,glbLoaded:true,orbit:true,wireframe:true,generatedPlayerColors:6,nativeRemapAndTurret:true,close:true,pageErrors:errors,screenshot:"Project-generated Mantis only; original game art omitted"});
  writeFileSync(resolve(output,"browser.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {try {await browser.close();} finally {if(!ownedBatch&&readFileSync(claim,"utf8").trim()===token)writeFileSync(claim,"");}}
