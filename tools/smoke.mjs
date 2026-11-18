#!/usr/bin/env node
// Fresh native-browser check. Writes not_run when Chromium cannot start;
// passing Node/rules checks are never represented as browser pixels.
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
  node:process.version,query:process.env.QUERY||'?engine=replay&boards=20',errors:[],
  scope:'Native X_ITE UI/geometry check when executed. A blocked browser is not a pass.'};
let server,browser;
const output=path.resolve(process.env.SMOKE_RECEIPT||path.join(ROOT,'evidence/browser-smoke.json'));
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
  await page.waitForTimeout(Number(process.env.WAIT_MS||8000));
  if(process.env.CYCLE){await page.evaluate(()=>window.x3dchess.scene.cycleTheme());await page.waitForTimeout(1000);}
  if(process.env.CLICK){const[x,y]=process.env.CLICK.split(',').map(Number);await page.mouse.click(x,y);await page.waitForTimeout(2000);}
  report.before_stop=await page.evaluate(()=>({mode:window.x3dchess.config.engine,transport:window.x3dchess.transport?.state||null}));
  await page.evaluate(async()=>{await window.x3dchess.transport?.stop();await window.x3dchess.scene.settled();});
  await page.waitForTimeout(1500);
  report.scene=await page.evaluate(()=>{
    const s=window.x3dchess.scene;
    return{boards:s.views.length,pieces:s.pieceCount(),sceneChildren:s.childCount(),misplaced:s.misplaced(),stats:s.stats,
      graphCount:s.graphCount(),heatPainted:s.heatPainted(),phasePoints:s.phase.points(),selected:s.selected,
      board_origins:s.views.map(v=>({declared:v.origin,actual:[v.proto.translation.x,v.proto.translation.y,v.proto.translation.z]})),
      engine:s.views.length&&window.x3dchess.transport?.pool?{searches:window.x3dchess.transport.pool.searches,nodes:window.x3dchess.transport.pool.nodes}:null};
  });
  const params=new URLSearchParams(report.query.replace(/^\?/,'')),engine=params.get('engine')||'wasm';
  const requested=engine==='study'?1:Number(params.get('boards')||20),scene=report.scene;
  need(scene.boards===requested,'Requested board count differs from live scene');
  need(scene.pieces>=requested*2&&scene.pieces<=requested*32,'Piece count outside legal board bounds');
  need(scene.pieces===scene.sceneChildren&&scene.misplaced===0,'Orphan or misplaced live piece nodes');
  need(scene.board_origins.every(o=>o.actual.every((x,i)=>Math.abs(x-o.declared[i])<1e-5)),'Actual board origins differ from piece origins');
  const minMoves=Number(process.env.MIN_MOVES??(engine==='study'?0:1));
  need(scene.stats.moves>=minMoves,'Too few actual transport moves');
  need(report.errors.length===0,'Browser console/page errors');
  const image=path.resolve(process.argv[2]||path.join(ROOT,'evidence/browser-smoke.png'));
  await fs.mkdir(path.dirname(image),{recursive:true});await page.screenshot({path:image});
  report.image={path:path.relative(ROOT,image),sha256:hash(await fs.readFile(image))};report.status='pass';
}catch(e){
  report.error=String(e.stack||e);
  if(!browser)report.status='not_run';
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(r=>server.close(r));
  report.finished_utc=new Date().toISOString();report.tool_sha256=hash(await fs.readFile(fileURLToPath(import.meta.url)));
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,boards:report.scene?.boards,moves:report.scene?.stats?.moves,errors:report.errors.length,receipt:output}));
  if(report.status!=='pass')process.exitCode=1;
}
