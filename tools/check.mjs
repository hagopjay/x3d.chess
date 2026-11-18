#!/usr/bin/env node
// Reproducible local integration checks. Browser execution is reported separately.
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=path.join(ROOT,'evidence/integration-check.json');
const python=process.env.CHESS_TEST_PYTHON||'python3';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=x=>JSON.stringify(Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))));
const need=(condition,message)=>{if(!condition)throw new Error(message);};
const relative=p=>path.relative(ROOT,p).split(path.sep).join('/');
const hashFile=async p=>hash(await fs.readFile(p));
const jsonFile=async p=>JSON.parse(await fs.readFile(path.join(ROOT,p),'utf8'));
const ignored=new Set(['.git','node_modules','.venv','__pycache__','.pytest_cache']);
const engineArgv=[process.execPath,path.join(ROOT,'viewer/vendor/stockfish/stockfish-19-lite-single.js')];
const env={...process.env,
  PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||''),
  PYTHONPATH:[path.join(ROOT,'server'),process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  PYTHONDONTWRITEBYTECODE:'1',PYTHONOPTIMIZE:'0',PYTEST_DISABLE_PLUGIN_AUTOLOAD:'1',
  PYTEST_ADDOPTS:'',PYTEST_PLUGINS:'',
  // python-chess shlex-splits this value; JSON string quoting handles these paths.
  ENGINE_CMD:engineArgv.map(x=>JSON.stringify(x)).join(' ')};
const report={schema:'x3dchess.integration-check/1',status:'fail',started_utc:new Date().toISOString(),
  environment:{node:process.version,platform:process.platform,arch:process.arch,python_command:python,
    pythonpath:env.PYTHONPATH,python_optimize_environment:0,pytest_plugin_autoload:false,
    pytest_addopts:'',pytest_explicit_plugins:'',server_engine_argv:engineArgv},
  checks:[],receipts:{},
  scope:'Local rules, lifecycle, saved-witness agreement, actual generated XML, full pinned XSD/implemented semantics, and Node-executed vendored WASM. Does not establish native X_ITE/Worker rendering, GPU performance, engine strength, or publisher authentication.'};
let temporary;

async function snapshotSources(){
  const files={};
  async function walk(dir){
    for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(ignored.has(entry.name)||entry.name.endsWith('.pyc')||entry.name.endsWith('.log'))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())await walk(full);
      else if(entry.isFile())files[relative(full)]=await hashFile(full);
      else if(entry.isSymbolicLink())throw new Error('Source inventory refuses symlinks: '+relative(full));
    }
  }
  for(const name of ['viewer','server','tools','vendor','docs','.github']){
    try{await walk(path.join(ROOT,name));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  for(const entry of await fs.readdir(ROOT,{withFileTypes:true})){
    if(entry.isFile()&&!entry.name.endsWith('.log'))files[entry.name]=await hashFile(path.join(ROOT,entry.name));
  }
  const sorted=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
  return {files_sha256:sorted,inventory_sha256:hash(canonical(sorted)),
    scope:'Root files and viewer/server/tools/vendor/docs/.github trees, excluding caches and installed packages. Generated examples and evidence are inventoried separately to avoid receipt recursion.'};
}

async function command(id,executable,args,{timeout=180000}={}){
  const row={id,kind:'command',argv:[executable,...args],cwd:'.',status:'fail',started_utc:new Date().toISOString()};
  const started=performance.now();
  const capture={stdout:{hash:crypto.createHash('sha256'),bytes:0,tail:''},stderr:{hash:crypto.createHash('sha256'),bytes:0,tail:''}};
  console.log('CHECK '+id);
  await new Promise(resolve=>{
    let child,timer,killTimer,done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);resolve();};
    try{
      child=spawn(executable,args,{cwd:ROOT,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
      for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
        const stream=capture[name];stream.hash.update(chunk);stream.bytes+=chunk.length;
        stream.tail=(stream.tail+chunk.toString()).slice(-12000);
      });
      child.once('error',e=>{row.error=String(e);finish();});
      child.once('close',(code,signal)=>{row.exit_code=code;row.signal=signal;row.status=code===0&&!row.timed_out?'pass':'fail';finish();});
      const stop=signal=>{try{process.kill(process.platform==='win32'?child.pid:-child.pid,signal);}catch(e){if(e.code!=='ESRCH')row.kill_error=String(e);}};
      timer=setTimeout(()=>{row.timed_out=true;stop('SIGTERM');killTimer=setTimeout(()=>stop('SIGKILL'),1000);},timeout);
    }catch(e){row.error=String(e);finish();}
  });
  row.elapsed_ms=Math.round((performance.now()-started)*1000)/1000;
  for(const name of ['stdout','stderr'])row[name]={bytes:capture[name].bytes,sha256:capture[name].hash.digest('hex'),tail:capture[name].tail};
  report.checks.push(row);
  console.log(row.status.toUpperCase()+' '+id+' ('+row.elapsed_ms+' ms)');
  if(row.status!=='pass')console.error((row.stderr.tail||row.stdout.tail||row.error||'No child output').slice(-4000));
  return row;
}

async function internal(id,fn){
  const row={id,kind:'internal',status:'fail',started_utc:new Date().toISOString()},start=performance.now();
  try{row.result=await fn();row.status='pass';}catch(e){row.error=String(e.stack||e);}
  row.elapsed_ms=Math.round((performance.now()-start)*1000)/1000;report.checks.push(row);
  console.log(row.status.toUpperCase()+' '+id);return row;
}

async function verifyReceipt(file,expectedStatus){
  const receipt=await jsonFile(file);
  need(receipt.status===expectedStatus,file+' status is '+receipt.status);
  for(const [name,digest] of Object.entries(receipt.source_sha256||{}))need(await hashFile(path.join(ROOT,name))===digest,file+' has stale source '+name);
  report.receipts[file]={schema:receipt.schema,status:receipt.status,sha256:await hashFile(path.join(ROOT,file))};
  return receipt;
}

try{
  report.sources_before=await snapshotSources();
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'x3d-chess-check-'));
  const preflight=await command('python-dependencies',python,['-c',
    'import sys,json,importlib.metadata as m; import chess,pytest,aiohttp,numpy,lxml,jsonschema; print(json.dumps({"python":sys.version,"executable":sys.executable,"packages":{k:m.version(k) for k in ["python-chess","pytest","aiohttp","numpy","lxml","jsonschema"]}}))']);
  need(preflight.status==='pass','Python dependency preflight failed. Install server/requirements-dev.txt and tools/requirements-validation.txt into CHESS_TEST_PYTHON, or supply their location through PYTHONPATH. No tests were silently skipped.');

  await internal('study-producer-identity',async()=>{
    const catalog=await jsonFile('viewer/data/studies.json'),manifest=await jsonFile('viewer/data/studies.manifest.json');
    const actual=await hashFile(path.join(ROOT,'tools/build_studies.py'));
    need(catalog.producer_sha256===actual&&manifest.producer_sha256===actual,'STALE_STUDY_CATALOG: regenerate with tools/build_studies.py');
    need(manifest.sha256===await hashFile(path.join(ROOT,'viewer/data/studies.json')),'Study catalog differs from manifest');
    return {producer_sha256:actual,catalog_sha256:manifest.sha256};
  });
  // Parity is intentionally not regenerated: stale Python/JS producer hashes fail.
  const suites=[['analysis','tools/analysis.test.mjs'],['renderer','tools/renderer-tests.mjs'],
    ['transport','tools/transport-tests.mjs'],['study','tools/study-test.mjs'],
    ['panel','tools/panel-test.mjs'],['export','tools/export-test.mjs'],['parity','tools/parity.mjs'],
    ['terrain','tools/terrain-test.mjs'],['branches','tools/branches-test.mjs'],['inspector','tools/inspector-test.mjs'],
    ['concepts','tools/concepts-test.mjs'],['skyline','tools/skyline-test.mjs']];
  for(const [id,file] of suites)await command(id,process.execPath,[file]);
  await command('runtime-fragments',process.execPath,['tools/runtime-fragments.mjs']);
  // This is the same adapter as tools/validate.sh, using the selected interpreter.
  await command('full-x3d-validation',python,['tools/validate_x3d.py']);
  await command('actual-wasm-runtime',process.execPath,['tools/check-runtime.mjs']);
  // Refuse a stale success if an unsuccessful child never writes its output.
  await fs.rm(path.join(ROOT,'evidence/transport-engine-check.json'),{force:true});
  await command('actual-wasm-transport',process.execPath,['tools/transport-engine-smoke.mjs','evidence/transport-engine-check.json']);

  for(const optimized of [false,true]){
    const id=optimized?'python-tests-optimized':'python-tests',xml=path.join(temporary,id+'.xml');
    const result=await command(id,python,[...(optimized?['-O']:[]),'-m','pytest','-q','-ra','-o','addopts=','--strict-config','--strict-markers',
      '--junitxml',xml,'server/tests']);
    if(result.status==='pass')await internal(id+'-no-skips',async()=>{
      const raw=await fs.readFile(xml,'utf8'),suites=[...raw.matchAll(/<testsuite\b([^>]*)>/g)];
      need(suites.length>0,'Pytest produced no test-suite results');
      const count=name=>suites.reduce((n,m)=>n+Number(new RegExp('\\b'+name+'="([0-9]+)"').exec(m[1])?.[1]||0),0);
      const totals=Object.fromEntries(['tests','failures','errors','skipped'].map(k=>[k,count(k)]));
      need(totals.tests>0&&totals.failures===0&&totals.errors===0&&totals.skipped===0,'Python suite did not execute every collected control: '+JSON.stringify(totals));
      return {...totals,junit_sha256:hash(raw)};
    });
  }

  await internal('child-receipt-integrity',async()=>{
    const fragments=await verifyReceipt('evidence/runtime-fragments.json','generated');
    need(fragments.tool_sha256===await hashFile(path.join(ROOT,'tools/runtime-fragments.mjs')),'Stale fragment capture tool');
    for(const fixture of fragments.fixtures)need(fixture.sha256===await hashFile(path.join(ROOT,fixture.file)),'Stale fragment '+fixture.file);
    const validation=await verifyReceipt('evidence/x3d-validation.json','pass');
    need(validation.instrument.adapter_sha256===await hashFile(path.join(ROOT,'tools/validate_x3d.py')),'Stale validation adapter');
    need(validation.controls.length>=2&&validation.controls.every(c=>c.caught),'Validator negative controls missing');
    for(const file of validation.files)need(file.status==='pass'&&file.candidate_sha256===await hashFile(path.join(ROOT,file.path)),'Stale/nonpassing validation input '+file.path);
    for(const fixture of fragments.fixtures)need(validation.files.some(f=>f.path===fixture.file),'Runtime fixture escaped validation: '+fixture.file);
    const runtime=await verifyReceipt('evidence/runtime-check.json','pass');
    need(runtime.tool_sha256===await hashFile(path.join(ROOT,'tools/check-runtime.mjs')),'Stale WASM runtime tool');
    const transport=await verifyReceipt('evidence/transport-engine-check.json','pass');
    need(transport.cases.length>=3,'Actual UCI pool controls incomplete');
    return {x3d_documents:validation.files.length,runtime_fixtures:fragments.fixtures.length,
      validator_negative_controls:validation.controls.length,real_engine_controls:runtime.checks.length,real_pool_controls:transport.cases.length};
  });
  report.sources_after=await snapshotSources();
  await internal('source-stability',async()=>{
    const before=report.sources_before.files_sha256,after=report.sources_after.files_sha256;
    const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>before[k]!==after[k]).sort();
    need(changed.length===0,'Sources changed during execution; rerun after edits finish: '+changed.join(', '));
    return {files:Object.keys(after).length,inventory_sha256:report.sources_after.inventory_sha256};
  });
  report.status=report.checks.every(c=>c.status==='pass')?'pass':'fail';
}catch(e){report.error=String(e.stack||e);console.error(report.error);}
finally{
  try{
    const native=await jsonFile('evidence/browser-smoke.json');
    report.native_browser={status:native.status,receipt_sha256:await hashFile(path.join(ROOT,'evidence/browser-smoke.json')),
      created_utc:native.started_utc,tool_matches_current:native.tool_sha256===await hashFile(path.join(ROOT,'tools/smoke.mjs')),
      included_in_aggregate:false,note:'Historical independent receipt; this aggregate does not launch a browser. not_run does not count as native success.'};
  }catch(e){report.native_browser={status:'not_run',included_in_aggregate:false,note:'No readable independent browser receipt.'};}
  if(temporary)await fs.rm(temporary,{recursive:true,force:true});
  report.finished_utc=new Date().toISOString();report.tool_sha256=await hashFile(fileURLToPath(import.meta.url));
  // The receipt does not hash itself. Its digest covers this exact content minus this field.
  report.report_sha256=hash(JSON.stringify(report));
  await fs.mkdir(path.dirname(OUTPUT),{recursive:true});await fs.writeFile(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status!=='pass').map(c=>c.id),receipt:relative(OUTPUT),native_browser:report.native_browser.status}));
  if(report.status!=='pass')process.exitCode=1;
}
