#!/usr/bin/env node
// Native-browser check of the lens overlays (terrain, concepts, inspector, engine lines, skyline).
// Writes not_run when Chromium cannot start; never represented as anything but what the page actually did.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VIEWER=path.join(ROOT,'viewer');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={schema:'x3dchess.browser-smoke/1',status:'not_run',started_utc:new Date().toISOString(),
  node:process.version,query:process.env.QUERY||'?engine=wasm&boards=4&depth=8&pool=2',errors:[],
  scope:'Native X_ITE UI/geometry check when executed. A blocked browser is not a pass.'};
let server,browser;
const output=path.resolve(process.env.LENS_RECEIPT||path.join(ROOT,'evidence/lens-smoke.json'));
const need=(x,m)=>{if(!x)throw new Error(m);};
const sleep=n=>new Promise(r=>setTimeout(r,n));
try {
  let require=createRequire(import.meta.url),playwright;
  try{playwright=require('playwright');report.playwright=require('playwright/package.json').version;}
  catch(e){
    const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if(!runtime)throw e;
    require=createRequire(path.join(runtime,'..','package.json'));
    playwright=require('playwright');report.playwright=require('playwright/package.json').version;
  }
  const executable=process.env.CHROMIUM_EXECUTABLE_PATH|| (fsSync.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  try{
    browser=await playwright.chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--lang=en-US','--enable-unsafe-swiftshader']});
  }catch(e){report.browser_unavailable=String(e);throw e;}
  report.status='fail';report.browser_version=browser.version();
  const external=process.env.X_ITE_DIR?path.resolve(process.env.X_ITE_DIR):null;
  const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.x3d':'model/x3d+xml','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
  server=http.createServer(async(req,res)=>{
    try{
      const u=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      const base=external&&u.startsWith('/__xite/')?external:VIEWER;
      const rel=base===external?u.slice(8):u==='/'?'/index.html':u;
      const candidate=path.resolve(base,'.'+(rel.startsWith('/')?rel:'/'+rel));
      if(candidate!==base&&!candidate.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
      const actual=await fs.realpath(candidate);
      if(!actual.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
      const bytes=await fs.readFile(actual);res.writeHead(200,{'content-type':types[path.extname(actual)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
    }catch(e){res.writeHead(e instanceof URIError?400:404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,page=await browser.newPage({locale:'en-US',viewport:{width:1440,height:960}});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  if(external)await page.route('https://cdn.jsdelivr.net/npm/x_ite@*/dist/**',r=>r.fulfill({path:path.join(external,r.request().url().split('/dist/')[1])}));
  await page.goto(`http://127.0.0.1:${port}/${report.query}`);
  await page.waitForFunction(()=>window.x3dchess?.ready===true,null,{timeout:45000});
  const shotsDir=process.env.LENS_SHOTS?path.resolve(process.env.LENS_SHOTS):null;
  const shot=async name=>{if(shotsDir){await fs.mkdir(shotsDir,{recursive:true});await page.screenshot({path:path.join(shotsDir,name)});}};
  const steps=report.steps=[];const step=async(name,fn)=>{const out=await fn();steps.push({name,...out});return out;};
  await page.waitForFunction(()=>window.x3dchess.scene.stats.moves>=6,null,{timeout:60000});
  await page.evaluate(()=>window.x3dchess.scene.select(0));await page.waitForTimeout(1500);
  // terrain
  await page.click('#terrainbtn');await page.waitForTimeout(2500);
  await step('terrain',()=>page.evaluate(()=>{const v=window.x3dchess.scene.views;const l=v.map(b=>b.lens);const shapes=l.map(x=>x.mounts.has('terrain'));
    return{mounted:shapes.every(Boolean),pressed:document.getElementById('terrainbtn').getAttribute('aria-pressed'),info:document.getElementById('lensInfo').textContent.slice(0,80)};}));
  need(steps.at(-1).mounted&&steps.at(-1).pressed==='true','terrain overlay did not mount on every board');
  await shot('lens-terrain.png');
  await page.keyboard.press('Shift+G');await page.waitForTimeout(1500);
  const modeNow=await page.evaluate(()=>window.x3dchess.scene.lensState.mode);need(modeNow==='material','Shift+G did not switch terrain mode');
  await page.click('#terrainbtn');await page.waitForTimeout(800);
  // concepts: cycle through every concept once
  const ids=await page.evaluate(()=>window.x3dchess.scene.CONCEPT_IDS);const seen=[];
  for(let i=0;i<ids.length;i++){await page.keyboard.press('c');await page.waitForTimeout(500);seen.push(await page.evaluate(()=>document.getElementById('lensInfo').textContent.slice(0,40)));}
  await page.evaluate(()=>window.x3dchess.scene.settled());
  await step('concepts',()=>({cycled:ids.length,labels:seen.slice(0,3)}));
  await page.keyboard.press('c');await page.waitForTimeout(300);
  await page.evaluate(()=>{const s=window.x3dchess.scene;return s.settled();});
  // pick the concept with markers on the selected board for a picture
  await page.keyboard.press('c');await page.waitForTimeout(1200);await shot('lens-concept-first.png');
  while(await page.evaluate(()=>window.x3dchess.scene.lensState.concept)>=0){await page.keyboard.press('c');await page.waitForTimeout(150);}
  // inspector: keyboard then a real mouse click on the board
  await page.click('#inspectbtn');await page.waitForTimeout(1500);
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(1200);
  await step('inspector-key',()=>page.evaluate(()=>{const l=window.x3dchess.scene.views[window.x3dchess.scene.selected].lens;return{square:l.insp.square,schema:l.lastInspection?.schema,info:document.getElementById('lensInfo').textContent.slice(0,120)};}));
  need(steps.at(-1).square&&steps.at(-1).schema==='x3dchess.inspection/1','inspector did not inspect a square by keyboard');
  await shot('lens-inspector.png');
  const before=await page.evaluate(()=>window.x3dchess.scene.views[window.x3dchess.scene.selected].lens.insp.square);
  const box=await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x+box.width*0.45,box.y+box.height*0.55);await page.waitForTimeout(2500);
  await step('inspector-click',()=>page.evaluate(()=>{const s=window.x3dchess.scene;const l=s.views[s.selected].lens;return{selected:s.selected,square:l.insp.square};}));
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForTimeout(500);
  const off=await page.evaluate(()=>window.x3dchess.scene.lensState.inspect);
  if(off){await page.click('#inspectbtn');}
  // engine lines on the focused board (wasm only)
  if(report.query.includes('engine=wasm')){
    await page.evaluate(()=>window.x3dchess.scene.select(0));await page.waitForTimeout(800);
    await page.click('#linesbtn');
    await page.waitForFunction(()=>/Engine lines|dropped/.test(document.getElementById('lensInfo').textContent),null,{timeout:60000});
    await step('engine-lines',()=>page.evaluate(()=>({info:document.getElementById('lensInfo').textContent.slice(0,200),labels:window.x3dchess.scene.branchLabels})));
    need(steps.at(-1).labels.length>=1&&/Engine lines/.test(steps.at(-1).info),'engine lines did not draw: '+steps.at(-1).info);
    const movesA=await page.evaluate(()=>window.x3dchess.scene.stats.moves);await page.waitForTimeout(2500);
    const heldOk=await page.evaluate(()=>{const g=window.x3dchess.transport.games[window.x3dchess.scene.selected];return !!g.hold;});need(heldOk,'focused game was not held');
    await shot('lens-lines.png');
    await page.click('#linesbtn');await page.waitForTimeout(1200);need(!(await page.evaluate(()=>!!window.x3dchess.transport.games[window.x3dchess.scene.selected].hold)),'game was not released');
  }
  // skyline
  await page.click('#skybtn');await page.waitForTimeout(2500);
  await step('skyline',()=>page.evaluate(()=>{const sk=window.x3dchess.scene.sky;return{visible:sk.scene?.rootNodes[0].visible,columns:sk.details().length,labels:sk.details().map(d=>d.label)};}));
  need(steps.at(-1).visible===true&&steps.at(-1).columns===(await page.evaluate(()=>window.x3dchess.scene.views.length)),'skyline did not show one column per board');
  await page.waitForTimeout(2500);await shot('lens-skyline.png');
  report.before_stop=await page.evaluate(()=>({mode:window.x3dchess.config.engine}));
  await page.evaluate(async()=>{await window.x3dchess.transport?.stop();await window.x3dchess.scene.settled();});
  await page.waitForTimeout(1800);
  report.scene=await page.evaluate(()=>{const s=window.x3dchess.scene;return{boards:s.views.length,pieces:s.pieceCount(),misplaced:s.misplaced(),stats:s.stats,sky_revision:s.sky.state.revision};});
  need(report.scene.misplaced===0,'misplaced pieces with lenses on');
  need(report.errors.length===0,'Browser console/page errors: '+report.errors.slice(0,3).join(' | '));
  report.status='pass';
}catch(e){
  report.error=String(e.stack||e);
  if(!browser)report.status='not_run';
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(r=>server.close(r));
  report.finished_utc=new Date().toISOString();report.tool_sha256=hash(await fs.readFile(fileURLToPath(import.meta.url)));
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,errors:report.errors.length,steps:report.steps?.length,receipt:output,error:report.error?.slice(0,400)}));
  if(report.status!=='pass')process.exitCode=1;
}
