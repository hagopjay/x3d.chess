export function readConfig(search) {
  const q=new URLSearchParams(search), engine=q.get('engine')||'wasm';
  if(!['wasm','sse','replay','study'].includes(engine))throw new Error('Choose engine=wasm, sse, replay or study');
  const integer=(key,fallback,min,max)=>{const v=q.has(key)?Number(q.get(key)):fallback;if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error(`${key} must be an integer from ${min} to ${max}`);return v;};
  const variant=q.get('variant')||'standard';
  if(!['standard','960'].includes(variant))throw new Error('Choose variant=standard or variant=960');
  const pos=q.get('pos');
  if(pos!==null&&pos!=='random'&&variant!=='960')throw new Error('pos= needs variant=960');
  const position=variant==='960'&&pos!==null&&pos!=='random'?integer('pos',518,0,959):undefined;
  const requested=integer('boards',20,1,64), server=q.get('server')||undefined;
  if(server&&!['http:','https:'].includes(new URL(server).protocol))throw new Error('The SSE server must use HTTP or HTTPS');
  return {engine,boards:engine==='study'?1:requested,seed:integer('seed',1,-2147483648,4294967295),
    intervalMs:integer('interval',700,16,60000),depth:integer('depth',12,1,30),
    poolSize:q.has('pool')?integer('pool',3,1,8):undefined,url:server,
    variant,position,theme:q.get('theme')||'moss',heat:q.get('heat')==='1',lesson:q.get('lesson')||undefined};
}
