/** Local-only game-icon checks. Never capture or emit original artwork pixels. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const claim="C:/Users/Admin/Code/AI/logs/gpu-claim.txt",token=`RTSAI model catalog check pid=${process.pid}`;
if(readFileSync(claim,"utf8").trim())throw Error("GPU claimed; defer browser check");
writeFileSync(claim,token+"\n");
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE??"C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const page=await browser.newPage({viewport:{width:1430,height:1040}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem("rtsai-art-review-coach-v3","1"));
  for(const [mode,actor,faction] of [["ra2","nawall","russia"],["classic","weap","england"]]){
    await page.goto(`http://127.0.0.1:3461/art/review?faction=${faction}&unit=${actor}&slot=model&mode=${mode}&view=art&models=1`);
    const dialog=page.getByRole("dialog",{name:"Inspect the model. Check the game asset."});
    await dialog.waitFor();
    await dialog.getByRole("searchbox",{name:"Search 3D models"}).fill(actor);
    await dialog.locator(".mesh-actor-list button").first().click();
    await dialog.locator(".mesh-native-art").waitFor();
    await page.waitForFunction(()=>{const i=document.querySelector(".mesh-native-art");return i?.complete&&i.naturalWidth>0;});
    assert.equal(await dialog.locator(".mesh-viewport canvas").count(),0,"unreviewed reconstruction must not render");
    assert.equal(await dialog.locator('a[download]').count(),0,"withheld reconstruction must not be offered as a model download");
    assert.match(await dialog.locator(".mesh-job-summary").innerText(),/New game exports: VXL 0 · HVA 0 · SHP 0/);
    if(mode==="ra2")assert.match(await dialog.locator(".mesh-empty").innerText(),/Incorrect input: build-menu icon/);
    await page.keyboard.press("Escape");
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({gameIconsLoaded:true,withheldMeshesHidden:true,nativeExportStatusVisible:true,modes:2,pageErrors:errors,screenshotsCaptured:0}));
}finally{
  try{await browser?.close();}finally{if(readFileSync(claim,"utf8").trim()===token)writeFileSync(claim,"");}
}
