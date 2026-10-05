/** Browser check with artwork omitted. Only the opaque text-only source dialog is pictured. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE??"C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output=resolve(".cache/source-check");mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try {
  const page=await browser.newPage({viewport:{width:1200,height:1050}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem("rtsai-art-review-coach-v3","1"));
  await page.route("**/api/art-review/roster?*",async route=>{
    const response=await route.fetch(),roster=await response.json();
    for(const stock of Object.values(roster.stock)){stock.sprite=null;stock.spec={...stock.spec,voxel:null,sprite:null,parts:[],cameo:null};}
    await route.fulfill({json:roster});
  });
  for(const path of ["ra2","classic","mod"])await page.route(`**/api/art-review/${path}/**`,r=>r.abort());
  await page.goto("http://127.0.0.1:3461/art/review?faction=china&unit=r2qilin&slot=model&mode=ra2&view=art");
  await page.getByRole("heading",{name:"Current artwork sources"}).waitFor();
  const details=page.locator(".actor-sources");assert.match(await details.innerText(),/Mixed sources[\s\S]*AI generated[\s\S]*RTSAI-Mod/);
  await details.getByText(/File credits & evidence/).click();assert.match(await details.innerText(),/r2qilin.vxl[\s\S]*6ac68b6/);
  const trigger=page.getByRole("button",{name:"Sources",exact:true});await trigger.click();
  const dialog=page.getByRole("dialog");await dialog.waitFor();
  assert.equal(await dialog.locator(".source-mod-list article").count(),4);
  assert.match(await dialog.locator(".source-loaded").innerText(),/16 factions · 201 resolved actors/);
  const search=dialog.getByRole("searchbox",{name:"Search mod sources"});await search.fill("mental");
  assert.equal(await dialog.locator("article").count(),1);assert.match(await dialog.locator("article").innerText(),/RA2 \/ Yuri’s Revenge[\s\S]*Not imported/);
  await search.fill("");await dialog.screenshot({path:resolve(output,"sources-library.png")});
  await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await page.getByRole("combobox",{name:"Game mode"}).selectOption("classic");
  await page.locator(".actor-sources").getByText("RTS AI Classic · OpenRA fork",{exact:false}).waitFor();
  await trigger.click();assert.match(await page.getByRole("dialog").locator(".source-loaded").innerText(),/Red Alert Classic/);
  assert.deepEqual(errors,[]);
  const report={modelIconSeparate:true,fileHashesAndCommit:true,catalogSearch:true,escapeAndFocusRestore:true,classicSources:true,pageErrors:errors,screenshot:"Text-only source library; game artwork omitted before navigation"};
  writeFileSync(resolve(output,"browser.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
