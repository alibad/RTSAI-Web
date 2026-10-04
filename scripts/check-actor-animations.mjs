/** Local browser checks. Screenshots contain only project-authored motion artwork. */
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const base="http://127.0.0.1:3461",claim="C:/Users/Admin/Code/AI/logs/gpu-claim.txt",token=`RTSAI animation check pid=${process.pid}`;
const software=process.argv.includes("--software"),existingClaim=readFileSync(claim,"utf8").trim();
if(existingClaim&&!software)throw Error("GPU claimed; defer browser check");
if(!software)writeFileSync(claim,token+"\n");
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE??"C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output=resolve(".cache/animation-check");mkdirSync(output,{recursive:true});
let browser;
const fingerprint=async canvas=>canvas.evaluate(c=>{
  const bytes=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
  let hash=2166136261;for(const b of bytes)hash=Math.imul(hash^b,16777619);
  return hash>>>0;
});
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:software?["--disable-gpu","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]:[]});
  const page=await browser.newPage({viewport:{width:1430,height:1100}}),errors=[];
  const renderer=await page.evaluate(()=>{const gl=document.createElement("canvas").getContext("webgl2"),info=gl?.getExtension("WEBGL_debug_renderer_info");return gl&&info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):"unavailable";});
  if(software)assert.match(renderer,/SwiftShader/i,"software mode must never use the claimed GPU");
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem("rtsai-art-review-coach-v3","1"));
  // No external requests, even for flags or fonts.
  await page.route("**/*",r=>new URL(r.request().url()).hostname==="127.0.0.1"?r.continue():r.abort());
  const data=await(await fetch(base+"/api/art-review/roster?mode=ra2")).json();
  for(const s of Object.values(data.stock)){s.sprite=null;s.spec={...s.spec,voxel:null,sprite:null,cameo:null};}
  await page.route("**/api/art-review/roster?*",r=>r.fulfill({json:data}));
  for(const type of ["ra2","classic","mod"])await page.route(`**/api/art-review/${type}/**`,r=>r.abort());
  await page.goto(base+"/art/review?faction=china&unit=r2cnportable&slot=model&mode=ra2&view=art&v=sprite-v2-motion-study");
  await page.locator('.lab-card[title="sprite-v2-motion-study"]').waitFor();
  await page.locator('.lab-card[title="sprite-v2-motion-study"]').click();
  const shelf=page.locator('.studio-action-shelf[aria-label="Artwork and behavior"]');
  await shelf.getByRole("button",{name:"Idle 2",exact:true}).click();
  const timeline=page.getByRole("slider",{name:"Animation time"});await timeline.waitFor();
  await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  const canvas=page.locator(".lab-stage canvas").first();
  const idleHashes=[];
  for(let i=0;i<12;i++){await timeline.fill(String(i*120));await page.waitForTimeout(150);idleHashes.push(await fingerprint(canvas));}
  if(new Set(idleHashes).size<2){await page.locator(".lab-stage").screenshot({path:resolve(output,"authored-debug.png")});console.log(JSON.stringify({time:await timeline.inputValue(),stage:await page.locator(".lab-stage").innerText(),errors}));}
  assert.ok(new Set(idleHashes).size>1,"idle must articulate across the cycle");
  await timeline.fill("480");
  await page.getByRole("button",{name:"Play animation",exact:true}).click();await page.waitForTimeout(500);
  if(Number(await timeline.inputValue())===480)console.log(JSON.stringify({time:await timeline.inputValue(),hidden:await page.evaluate(()=>document.hidden),stage:await page.locator(".lab-stage").innerText()}));
  assert.ok(Number(await timeline.inputValue())!==480,"timer advances");
  await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  await page.locator(".lab-stage").screenshot({path:resolve(output,"portable-idle-stage.png")});
  const red=await fingerprint(canvas);
  await page.getByRole("button",{name:"View",exact:true}).click();
  await page.getByRole("button",{name:"Blue",exact:true}).click();await page.waitForTimeout(250);
  assert.notEqual(await fingerprint(canvas),red,"player color changes ownership panels");
  await page.getByRole("button",{name:"Red",exact:true}).click();
  await page.getByRole("button",{name:"View",exact:true}).click();
  await shelf.getByRole("button",{name:"Fire",exact:true}).click();
  await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  await timeline.fill("0");await page.waitForTimeout(200);const fire0=await fingerprint(canvas);
  await timeline.fill("80");await page.waitForTimeout(200);assert.notEqual(fire0,await fingerprint(canvas));
  await shelf.getByRole("button",{name:"Die",exact:true}).click();
  await page.waitForTimeout(800);await page.getByRole("button",{name:"Play animation",exact:true}).waitFor();
  const death=await fingerprint(canvas);await page.waitForTimeout(200);assert.equal(await fingerprint(canvas),death,"death holds last frame");
  assert.equal(await shelf.getByRole("button").count(),13,"12 native actions plus encounter");
  await shelf.getByRole("button",{name:"Idle",exact:true}).click();await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  await shelf.getByText(/Animation checks/).click();
  await shelf.screenshot({path:resolve(output,"portable-action-controls.png")});
  // Native game artwork is verified locally using hashes only. No native screenshots.
  await page.unroute("**/api/art-review/roster?*");
  for(const type of ["ra2","classic","mod"])await page.unroute(`**/api/art-review/${type}/**`);
  const native=[];
  for(const [mode,actor,faction,action] of [["ra2","gapowr","america","make"],["classic","weap","england","build-top"],["ra2","r2toufan","iran","body"]]){
    await page.goto(`${base}/art/review?faction=${faction}&unit=${actor}&slot=model&mode=${mode}&view=art`);
    const animation=page.getByRole("combobox",{name:"Animation",exact:true});await animation.waitFor();
    await animation.selectOption(action);
    const time=page.getByRole("slider",{name:"Animation time"});await time.waitFor();
    await page.getByRole("button",{name:"Pause animation",exact:true}).click();
    await time.fill("0");await page.waitForTimeout(250);const before=await fingerprint(canvas);
    await time.fill(mode==="ra2"&&actor==="r2toufan"?"40":"240");await page.waitForTimeout(500);const after=await fingerprint(canvas);
    assert.notEqual(before,after,`${mode}:${actor} ${action} must animate`);
    native.push({mode,actor,action,frameChanges:true});
  }
  assert.deepEqual(errors,[]);
  const report={renderer,authoredCandidate:{actions:12,idleChanges:true,fireChanges:true,playerRemap:true,scrubbing:true,playPause:true,terminalDeathHeld:true},native,originalScreenshots:0,pageErrors:errors};
  writeFileSync(resolve(output,"browser.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}finally{
  try{await browser?.close();}finally{if(readFileSync(claim,"utf8").trim()===token)writeFileSync(claim,"");}
}
