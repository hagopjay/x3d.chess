#!/usr/bin/env node
// Browser acceptance for the optional AnalysisDesk. Real engine searches and
// deliberately deferred test continuations are recorded as separate steps.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),VIEWER=path.join(ROOT,'viewer');
const output=path.resolve(process.env.DESK_RECEIPT||path.join(ROOT,'evidence/desk-smoke.json'));
const shots=path.resolve(process.env.DESK_SHOTS||path.join(ROOT,'evidence/desk-shots'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const report={schema:'x3dchess.desk-smoke/1',status:'not_run',started_utc:new Date().toISOString(),
  node:process.version,steps:[],errors:[],images:[],source_sha256:{},
  scope:'Local native Chromium/X_ITE interaction at 1440x960 and 390x844 using SwiftShader. One actual two-board WASM MultiPV search plus explicitly synthetic delayed-result fault injection. No target-device performance or chess-strength claim.'};
let server,browser,page;
async function step(name,fn){
  const start=performance.now(),row={name,status:'fail'};report.steps.push(row);
  try{row.result=await fn();row.status='pass';return row.result;}finally{row.elapsed_ms=Math.round(performance.now()-start);}
}
async function shot(name){
  await fs.mkdir(shots,{recursive:true});const file=path.join(shots,name+'.png');
  await page.screenshot({path:file,fullPage:true});report.images.push({path:path.relative(ROOT,file),sha256:hash(await fs.readFile(file))});
}
async function ready(url){
  await page.goto(url);
  await page.waitForFunction(()=>window.x3dchess?.ready===true,null,{timeout:45000});
  await page.waitForFunction(()=>document.querySelectorAll('#deskContent .metric').length===4,null,{timeout:10000});
  await page.evaluate(()=>window.x3dchess.scene.settled());
}
try{
  for(const file of ['viewer/index.html','viewer/style.css','viewer/js/main.js','viewer/js/analysis-desk.js','viewer/js/position-report.js','viewer/js/camera.js','viewer/js/scene.js','viewer/js/lenses.js','viewer/js/wasm-transport.js','viewer/js/pieces.js','viewer/js/board.js','viewer/js/branches.js','viewer/js/themes.js','viewer/js/engine-pool.js','viewer/vendor/chess.js','viewer/scenes/grid.x3d','viewer/vendor/x_ite/x_ite.min.js'])report.source_sha256[file]=hash(await fs.readFile(path.join(ROOT,file)));
  let require=createRequire(import.meta.url),playwright;
  try{playwright=require('playwright');}catch(e){const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;if(!runtime)throw e;require=createRequire(path.join(runtime,'..','package.json'));playwright=require('playwright');}
  report.playwright=require('playwright/package.json').version;
  const executable=process.env.CHROMIUM_EXECUTABLE_PATH||(fsSync.existsSync('/tmp/chromium')?'/tmp/chromium':fsSync.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  report.launch_args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--lang=en-US'];
  try{browser=await playwright.chromium.launch({executablePath:executable,headless:true,args:report.launch_args});}catch(e){report.browser_unavailable=String(e);throw e;}
  report.status='fail';report.browser_version=browser.version();
  const types={'.html':'text/html','.js':'text/javascript','.x3d':'model/x3d+xml','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
  server=http.createServer(async(req,res)=>{
    try{
      const u=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),candidate=path.resolve(VIEWER,'.'+(u==='/'?'/index.html':u));
      if(!candidate.startsWith(VIEWER+path.sep)){res.writeHead(403);res.end();return;}
      const actual=await fs.realpath(candidate);if(!actual.startsWith(VIEWER+path.sep)){res.writeHead(403);res.end();return;}
      const bytes=await fs.readFile(actual);res.writeHead(200,{'content-type':types[path.extname(actual)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
    }catch(e){res.writeHead(e instanceof URIError?400:404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}/`;
  page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce',locale:'en-US'});
  page.on('pageerror',e=>report.errors.push({kind:'pageerror',message:String(e)}));
  page.on('console',m=>{if(m.type()==='error')report.errors.push({kind:'console',message:m.text()});});
  await ready(base+'?engine=study&boards=1&detail=analyst');
  await step('analyst-position-and-layout',async()=>{
    const r=await page.evaluate(()=>{
      const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};
      return{density:document.querySelector('#density').value,selected:window.x3dchess.scene.selected,
        metrics:document.querySelectorAll('.metric').length,stage:rect('.stage'),desk:rect('#analysisDesk'),
        oldPanelDisplay:getComputedStyle(document.querySelector('#panel')).display,bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    need(r.density==='analyst'&&r.selected===0&&r.metrics===4,'Analyst density did not select and describe board zero');
    need(r.oldPanelDisplay==='none','The old floating panel still covers the board');
    need(r.desk.x>=r.stage.right-1,'Analysis desk overlaps the X3D viewport');
    need(r.bodyWidth<=r.viewport,'Desktop layout overflows horizontally');return r;
  });
  await step('structure-and-numeric-control-tabs',async()=>{
    await page.click('[data-tab="pawns"]');need(await page.locator('#deskContent').getByText('Pawn topology',{exact:true}).count()===1,'Structure tab did not render');
    await page.click('[data-tab="control"]');
    const cells=await page.locator('.matrix [data-square]').evaluateAll(nodes=>nodes.map(n=>({square:n.dataset.square,value:n.textContent,label:n.getAttribute('aria-label')})));
    need(cells.length===64&&new Set(cells.map(c=>c.square)).size===64,'Control matrix must contain all 64 unique squares');
    need(cells.every(c=>/^[+−-]?\d+$/.test(c.value)&&c.label.includes('White')&&c.label.includes('Black')),'Control matrix is missing numeric or accessible counts');
    await page.click('[data-square="f5"]');
    await page.waitForFunction(()=>window.x3dchess.scene.views[0].lens.lastInspection?.square==='f5',null,{timeout:10000});
    const ins=await page.evaluate(()=>{const l=window.x3dchess.scene.views[0].lens;return{square:l.lastInspection.square,schema:l.lastInspection.schema,mounted:l.mounts.has('insp'),pressed:document.querySelector('#inspectbtn').getAttribute('aria-pressed')};});
    need(ins.mounted&&ins.pressed==='true','Matrix selection failed to mount X3D square inspection');await page.locator('[data-square="f5"]').focus();await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>window.x3dchess.scene.views[0].lens.lastInspection?.square==='f6');need(await page.locator('[data-square="f6"]').getAttribute('tabindex')==='0','Matrix arrow navigation did not move its focus target');return{cells:cells.length,first:cells[0],last:cells.at(-1),inspection:ins};
  });
  await step('camera-and-palette-controls',async()=>{
    await page.selectOption('#cameraView','top');
    await page.waitForFunction(()=>window.x3dchess.scene.rig.name==='board_0_top'&&!window.x3dchess.scene.rig.flying);
    const top=await page.evaluate(()=>window.x3dchess.scene.rig.pose());
    // Axis-angle (-X,+pi/2) and (+X,-pi/2) are equivalent.
    const origin=await page.evaluate(()=>window.x3dchess.scene.views[0].origin);
    need(top.p[1]>10&&Math.abs(top.p[0]-origin[0])<1e-4&&Math.abs(top.p[2]-origin[2])<1e-4&&Math.abs(top.o[0]*top.o[3]+Math.PI/2)<1e-4,'Overhead camera pose is incorrect: '+JSON.stringify(top));
    await page.selectOption('#cameraView','black');
    await page.waitForFunction(()=>window.x3dchess.scene.rig.name==='board_0_black'&&!window.x3dchess.scene.rig.flying);
    const black=await page.evaluate(()=>window.x3dchess.scene.rig.pose());
    need(black.p[2]<top.p[2]&&Math.abs(black.o[3]-Math.PI)<1e-4,'Black-side camera did not cross the board');
    await page.selectOption('#themeSelect','ice');await page.waitForFunction(()=>window.x3dchess.scene.theme==='ice');
    await page.selectOption('#themeSelect','moss');await page.waitForFunction(()=>window.x3dchess.scene.theme==='moss');
    await page.selectOption('#cameraView','oblique');await page.waitForFunction(()=>!window.x3dchess.scene.rig.flying);
    return{top,black,paletteRoundTrip:['ice','moss']};
  });
  await shot('desk-control-desktop');
  await step('mobile-390-layout-and-control',async()=>{
    await page.setViewportSize({width:390,height:844});await page.locator('[data-square="h8"]').click();
    await page.waitForFunction(()=>window.x3dchess.scene.views[0].lens.lastInspection?.square==='h8');
    const r=await page.evaluate(()=>{
      const d=document.querySelector('#analysisDesk').getBoundingClientRect(),s=document.querySelector('.stage').getBoundingClientRect();
      return{viewport:innerWidth,bodyWidth:document.documentElement.scrollWidth,deskWidth:d.width,deskTop:d.y,stageBottom:s.bottom,matrixCount:document.querySelectorAll('.matrix [data-square]').length};
    });
    need(r.bodyWidth<=r.viewport,'390px mobile page overflows horizontally');need(r.deskTop>=r.stageBottom-1,'Mobile analysis desk covers the board');need(r.matrixCount===64,'Mobile matrix lost cells');return r;
  });
  await shot('desk-control-mobile');
  await page.setViewportSize({width:1440,height:960});
  await ready(base+'?engine=wasm&boards=2&pool=2&depth=6&detail=analyst');
  await page.waitForFunction(()=>window.x3dchess.scene.stats.moves>=2,null,{timeout:45000});
  await page.click('[data-tab="search"]');await page.selectOption('#searchDepth','8');await page.selectOption('#searchPV','3');
  await step('actual-wasm-multipv-hold-and-release',async()=>{
    await page.click('#deskSearch');
    await page.waitForFunction(()=>document.querySelectorAll('.search-line').length>=1,null,{timeout:60000});
    const r=await page.evaluate(()=>({held:!!window.x3dchess.transport.games[0].hold,
      labels:window.x3dchess.scene.branchLabels,lines:document.querySelectorAll('.search-line').length,
      text:document.querySelector('#deskContent').textContent,fen:window.x3dchess.scene.records.get('g0').fen,
      ply:window.x3dchess.transport.games[0].ply}));
    need(r.held&&r.lines>=1&&r.labels.length===r.lines,'Actual search did not produce held, verified X3D and desk continuations');
    need(r.text.includes('legal plies verified')&&r.text.includes('White POV'),'Search table omitted legal replay or perspective');
    await shot('desk-search-desktop');await page.click('#deskSearch');
    await page.waitForFunction(()=>!window.x3dchess.transport.games[0].hold&&document.querySelectorAll('.search-line').length===0);
    await page.waitForFunction(ply=>window.x3dchess.transport.games[0].ply>ply,r.ply,{timeout:15000});
    return{held:r.held,lines:r.lines,labels:r.labels,fen:r.fen,resumed:true};
  });
  // Deliberately replace only the analysis method. Tournament Workers remain real.
  // Resolve a newer legal test continuation before the abandoned older request.
  await page.evaluate(()=>{const t=window.x3dchess.transport;window.__deskRealAnalyze=t.analyze.bind(t);window.__deskRace=[];t.analyze=(fen,options)=>new Promise((resolve,reject)=>window.__deskRace.push({fen,options,resolve,reject}));});
  await step('released-search-cannot-overwrite-newer-result',async()=>{
    await page.click('#deskSearch');await page.waitForFunction(()=>window.__deskRace.length===1);
    await page.click('#deskSearch');await page.waitForFunction(()=>!window.x3dchess.transport.games[0].hold);
    await page.click('#deskSearch');await page.waitForFunction(()=>window.__deskRace.length===2);
    await page.evaluate(async()=>{
      const {Chess}=await import('./vendor/chess.js'),{normalizeResult}=await import('./js/branches.js');
      window.__deskResolve=(index,whiteCp)=>{const q=window.__deskRace[index],c=new Chess(q.fen),m=c.moves({verbose:true})[0];
        q.resolve(normalizeResult({fenSearched:q.fen,lines:[{depth:8,multipv:1,cp:c.turn()==='w'?whiteCp:-whiteCp,pv:[m.from+m.to+(m.promotion||'')],nodes:1,time:0}]}));};
      window.__deskResolve(1,222);
    });
    await page.waitForFunction(()=>document.querySelector('.search-line strong')?.textContent.includes('cp +222'));
    await page.evaluate(()=>window.__deskResolve(0,999));
    // Wait across two desk refresh periods; the abandoned result must stay absent.
    await page.waitForTimeout(1300);
    const r=await page.evaluate(()=>({table:document.querySelector('.search-line strong')?.textContent,
      labels:window.x3dchess.scene.branchLabels,held:!!window.x3dchess.transport.games[0].hold,
      requests:window.__deskRace.map(q=>({fen:q.fen,options:q.options}))}));
    need(r.held&&r.table.includes('cp +222')&&!r.table.includes('999')&&r.labels.every(x=>!x.includes('999')),'Released old search overwrote a newer result');
    await page.click('#deskSearch');await page.waitForFunction(()=>!window.x3dchess.transport.games[0].hold);return{faultInjection:true,...r};
  });
  await step('stop-during-pending-analysis-does-not-hang',async()=>{
    await page.click('#deskSearch');await page.waitForFunction(()=>window.__deskRace.length===3);
    const t=performance.now();await page.click('#runbtn');
    await page.waitForFunction(()=>document.querySelector('#runbtn').textContent==='Restart session',null,{timeout:10000});
    await page.evaluate(()=>window.__deskResolve(2,333));await page.waitForTimeout(700);
    const r=await page.evaluate(()=>({held:window.x3dchess.transport.games.some(g=>!!g.hold),tasks:window.x3dchess.transport.tasks.length,
      searchDisabled:document.querySelector('#deskSearch').disabled,lines:document.querySelectorAll('.search-line').length,
      labels:window.x3dchess.scene.branchLabels,error:document.querySelector('#error').hidden?null:document.querySelector('#error').textContent}));
    need(!r.held&&r.tasks===0&&r.searchDisabled&&r.lines===0&&r.labels.length===0&&!r.error,'Stop retained a hold, task, stale analysis, or UI error');
    await page.evaluate(()=>{window.x3dchess.transport.analyze=window.__deskRealAnalyze;});return{faultInjection:true,stop_ms:Math.round(performance.now()-t),...r};
  });
  need(report.errors.length===0,'Browser errors: '+report.errors.slice(0,3).map(e=>e.message).join(' | '));
  report.status='pass';
}catch(e){report.error=String(e.stack||e);if(page)try{await shot('desk-failure');}catch{};}
finally{
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
  report.finished_utc=new Date().toISOString();report.tool_sha256=hash(await fs.readFile(fileURLToPath(import.meta.url)));
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,steps:report.steps.length,errors:report.errors.length,receipt:output,error:report.error?.slice(0,500)}));
  if(report.status!=='pass')process.exitCode=1;
}
