/** Native preview assertions stay local. Screenshots use wholly authored synthetic SHP fixtures. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output = resolve(".cache/building-layer-check"); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], requests = [], report = [];
page.on("pageerror", e => errors.push(e.message));
page.on("request", r => requests.push(new URL(r.url()).pathname));
await page.addInitScript(() => {
  localStorage.setItem("rtsai-art-review-coach-v3", "1");
  window.__buildingPerf={long:[],events:[]};
  new PerformanceObserver(l=>window.__buildingPerf.long.push(...l.getEntries().map(e=>e.duration))).observe({type:"longtask"});
  new PerformanceObserver(l=>window.__buildingPerf.events.push(...l.getEntries().map(e=>e.duration))).observe({type:"event",durationThreshold:16});
});
try {
  for (const [mode, faction, actor] of [["classic", "england", "weap"], ["ra2", "china", "gaweap"], ["ra2", "america", "gaairc"]]) {
    requests.length = 0;
    await page.goto(`http://127.0.0.1:3461/art/review?faction=${faction}&unit=${actor}&slot=model&mode=${mode}&view=art`, { waitUntil: "load" });
    await page.waitForFunction(() => { const c=document.querySelector(".lab-stage-canvas"); return c?.width>100 && c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0); });
    if (mode === "classic") {
      await page.waitForFunction(() => Array.from(document.querySelectorAll("select[aria-label=Animation] option")).some(o=>o.value==="build-top"));
      await page.waitForFunction(() => performance.getEntriesByType("resource").some(e=>e.name.includes("weap3.shp")));
      assert.ok(requests.some(url => url.includes("weap3.shp")), "idle loads the closed roof/door layer");
      await page.getByRole("combobox", { name: "Animation" }).selectOption("damaged-idle");
      await page.waitForFunction(() => performance.getEntriesByType("resource").some(e=>e.name.includes("weap2.shp")));
      await page.getByRole("combobox", { name: "Animation" }).selectOption("build-top");
      assert.match(await page.getByRole("combobox", { name: "Animation" }).innerText(), /Production door/);
      await page.waitForTimeout(200);
      await page.evaluate(()=>{window.__buildingPerf.long=[];window.__buildingPerf.events=[];});
      for(const animation of ["body","damaged-idle","build-top","make","body"]) await page.getByRole("combobox",{name:"Animation"}).selectOption(animation);
      await page.waitForTimeout(250);
      const perf=await page.evaluate(()=>window.__buildingPerf);
      assert.ok(perf.long.every(n=>n<=50),"building interaction has no main-thread task above 50 ms");
      assert.ok(perf.events.every(n=>n<=100),"building input paints within 100 ms");
      const cdp=await page.context().newCDPSession(page); await cdp.send("Performance.enable");
      const metrics=async()=>Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
      const t0=await metrics();await page.waitForTimeout(2000);const t1=await metrics();
      const idleCpuPct=(t1.TaskDuration-t0.TaskDuration)/(t1.Timestamp-t0.Timestamp)*100;
      assert.ok(idleCpuPct<2,"closed factory idle stays below 2% main-thread activity");
      report.push({nativeInteraction:{longTasks:perf.long,maxInputMs:Math.max(0,...perf.events),idleCpuPct:Number(idleCpuPct.toFixed(2))}});
      await cdp.detach();
    }
    report.push({ mode, actor, loadedLayers: requests.filter(url=>url.endsWith(".shp")), stageDrawn: true });
  }
  // Replace every stock sprite/palette before making screenshots. Original pixels never enter these images.
  const after = await (await fetch("http://127.0.0.1:3461/api/art-review/roster?mode=classic")).json();
  const before = structuredClone(after);
  before.stock.weap.sprite.overlays=[];
  before.stock.weap.spec.sprite.overlays=[];
  const synthShp = name => {
    const w=80,h=80,n=16,b=Buffer.alloc(8+n*24+n*w*h); b.writeUInt16LE(w,2); b.writeUInt16LE(h,4); b.writeUInt16LE(n,6);
    for(let f=0;f<n;f++) {
      const at=8+f*24, data=8+n*24+f*w*h;
      b.writeUInt16LE(w,at+4); b.writeUInt16LE(h,at+6); b.writeUInt32LE(data,at+20);
      const rect=(x,y,r,bt,c)=>{for(let yy=y;yy<bt;yy++)for(let xx=x;xx<r;xx++)b[data+yy*w+xx]=c;};
      if(name==="weap.shp") { rect(16,45,65,65,2); rect(23,48,55,65,4); rect(16,43,65,46,3); rect(17,48,22,63,3); rect(57,48,63,63,3); }
      else { rect(16,26,65,46,2); rect(16,39,65,43,3); for(let y=15;y<27;y++)rect(16+(27-y)*2,y,65-(27-y)*2,y+1,5); rect(26,28,54,37,4); rect(35,15,46,22,3); }
    }
    return b;
  };
  const pal=Buffer.alloc(768); [[0,0,0],[0,0,0],[52,51,46],[51,8,7],[8,13,15],[61,59,53]].forEach((c,i)=>c.forEach((v,j)=>pal[i*3+j]=v));
  await page.route("**/api/art-review/ra2/**", r=>r.abort());
  const fixture = r=>{ const n=new URL(r.request().url()).pathname.split("/").pop().replace(/^[a-f0-9]{12}-/,""); return r.fulfill({status:200,contentType:"application/octet-stream",body:n.endsWith(".pal")?pal:synthShp(n)}); };
  await page.route("**/api/art-review/classic/**", fixture);
  await page.route("**/api/art-review/mod/**", fixture);
  for(const [label,payload] of [["before",before],["after",after]]) {
    const copy=structuredClone(payload);
    copy.factions=copy.factions.filter(f=>f.id==="england").map(f=>({...f,units:f.units.filter(u=>u.id==="weap"),references:[]}));
    copy.stock={weap:copy.stock.weap}; copy.stock.weap.spec.cameo=null;
    if(label==="before") copy.stock.weap.sprite.overlays=[];
    await page.route("**/api/art-review/roster?*", r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(copy)}));
    await page.goto("http://127.0.0.1:3461/art/review?faction=england&unit=weap&slot=model&mode=classic&view=art",{waitUntil:"load"});
    await page.waitForTimeout(700);
    await page.getByRole("button",{name:"Zoom in",exact:true}).click();
    await page.getByRole("button",{name:"Zoom in",exact:true}).click();
    await page.waitForTimeout(150);
    const roofPixels=await page.evaluate(()=>{const c=document.querySelector(".lab-stage-canvas"),p=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<p.length;i+=4)if(p[i]===247&&p[i+1]===239&&p[i+2]===215)n++;return n;});
    if(label==="before") assert.equal(roofPixels,0); else assert.ok(roofPixels>100,"upper facade reaches the actual Studio canvas");
    await page.locator(".lab-stage").screenshot({path:resolve(output,`synthetic-${label}.png`)});
    report.push({synthetic:label,roofPixels});
    await page.unroute("**/api/art-review/roster?*");
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,"browser.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({report,pageErrors:errors},null,2));
} finally { await browser.close(); }
