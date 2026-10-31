/** Serve approved pinned cache bytes only; never fetch a model or implement decoding. */
import { constants } from 'node:fs';
import { readFile, open, lstat, realpath, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { CANDIDATES, type Candidate } from '../../frontend/src/services/transcription/candidateRegistry';
import { MODELS } from './comparisonBounds';
import type { Page } from 'playwright';
type Pin = { url: string; bytes: number; sha256: string };
export type CachedAsset = Pin & { file: string };
type VerifiedAsset=CachedAsset&{handle:FileHandle;canonicalPath:string;fingerprint:string;chunkHashes:string[]};
export const CACHE_CHUNK_BYTES = 32 * 1024 * 1024;
export const CACHE_DIRECT_MAX_BYTES = 256 * 1024 * 1024;
const fingerprint=(info:{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint})=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function binding(entry:VerifiedAsset){
  const pathInfo=await lstat(entry.file,{bigint:true});const fdInfo=await entry.handle.stat({bigint:true});
  if(!pathInfo.isFile()||await realpath(entry.file)!==entry.canonicalPath||fingerprint(pathInfo)!==entry.fingerprint||fingerprint(fdInfo)!==entry.fingerprint)throw Error('cached_file_changed_after_verification');
}
async function readAt(handle:FileHandle,start:number,length:number){
  const bytes=Buffer.allocUnsafe(length);let filled=0;
  while(filled<length){const result=await handle.read(bytes,filled,length-filled,start+filled);if(!result.bytesRead)throw Error('cached_short_read');filled+=result.bytesRead;}
  return bytes;
}
export type { VerifiedAsset };
export async function closeVerifiedAssetIndex(index:Map<string,VerifiedAsset>){await Promise.all([...new Set([...index.values()].map(e=>e.handle))].map(handle=>handle.close()));}
async function verifiedResponse(entry:VerifiedAsset,start:number,end:number){
  await binding(entry);const parts:Buffer[]=[];
  for(let offset=Math.floor(start/CACHE_CHUNK_BYTES)*CACHE_CHUNK_BYTES;offset<=end;offset+=CACHE_CHUNK_BYTES){
    const bytes=await readAt(entry.handle,offset,Math.min(CACHE_CHUNK_BYTES,entry.bytes-offset));
    if(hash(bytes)!==entry.chunkHashes[offset/CACHE_CHUNK_BYTES])throw Error('cached_chunk_changed_after_verification');
    parts.push(bytes.subarray(Math.max(0,start-offset),Math.min(bytes.length,end-offset+1)));
  }
  await binding(entry);return Buffer.concat(parts,end-start+1);
}
/** Locked tsx keeps function names with __name. Playwright serializes functions without module closures.
 * Prefix each authored init callback with that exact naming helper; fixture and range callbacks remain unchanged. */
export function comparisonInitPage(page:Page):Page {
  return new Proxy(page,{get(target,property){
    if(property==='addInitScript')return async(script:unknown,arg?:unknown)=>{
      if(typeof script==='function')return target.addInitScript({content:
        `Object.defineProperty(globalThis,"__name",{configurable:true,value:(target,value)=>Object.defineProperty(target,"name",{value,configurable:true})});(${script.toString()})(${JSON.stringify(arg)});`});
      return target.addInitScript(script as Parameters<Page['addInitScript']>[0],arg);
    };
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }});
}
export function registeredAssetPins(appOrigin: string, candidates: readonly Candidate[] = MODELS.map(id=>CANDIDATES[id])): Pin[] {
  const pins = candidates.flatMap(candidate => {
    const assets = candidate.assets;
    return (assets.files ?? []).map(file => ({bytes:file.bytes,sha256:file.sha256,
      url:new URL(('url' in file && typeof file.url === 'string') ? file.url : `${'servedFrom' in assets ? assets.servedFrom : ''}/${file.path}`,appOrigin).href}));
  });
  const unique = new Map<string,Pin>();
  for(const pin of pins){const prior=unique.get(pin.url);if(prior&&(prior.sha256!==pin.sha256||prior.bytes!==pin.bytes))throw Error('cached_conflicting_inventory');unique.set(pin.url,pin);}
  return [...unique.values()];
}
export async function indexCachedAssets(pins: Pin[], entries: CachedAsset[]) {
  if (entries.length !== pins.length || new Set(entries.map(x=>x.url)).size !== entries.length) throw Error('cached_inventory_incomplete_or_duplicate');
  const index = new Map<string,VerifiedAsset>();let pending:FileHandle|undefined;
  try{
  for(const pin of pins) {
    const entry = entries.find(x=>x.url===pin.url);
    if(!entry || entry.bytes!==pin.bytes || entry.sha256!==pin.sha256) throw Error('cached_pin_mismatch');
    const pathInfo=await lstat(entry.file,{bigint:true});
    if(!pathInfo.isFile()||pathInfo.size!==BigInt(pin.bytes))throw Error('cached_size_mismatch');
    const canonicalPath=await realpath(entry.file);pending=await open(canonicalPath,constants.O_RDONLY|constants.O_NOFOLLOW);
    const verified:VerifiedAsset={...entry,handle:pending,canonicalPath,fingerprint:fingerprint(pathInfo),chunkHashes:[]};
    await binding(verified);const whole=createHash('sha256');
    for(let offset=0;offset<pin.bytes;offset+=CACHE_CHUNK_BYTES){const bytes=await readAt(pending,offset,Math.min(CACHE_CHUNK_BYTES,pin.bytes-offset));whole.update(bytes);verified.chunkHashes.push(hash(bytes));}
    if(whole.digest('hex')!==pin.sha256)throw Error('cached_hash_mismatch');await binding(verified);
    index.set(pin.url,verified);pending=undefined;
  }
  return index;
  }catch(error){await pending?.close();await closeVerifiedAssetIndex(index);throw error;}
}
export async function startCachedModelServer(receiptPath: string, expectedReceiptSha256: string, appOrigin: string, candidates?: readonly Candidate[]) {
  const bytes=await readFile(receiptPath);
  if(createHash('sha256').update(bytes).digest('hex')!==expectedReceiptSha256)throw Error('cached_receipt_binding_mismatch');
  const receipt=JSON.parse(bytes.toString()) as {assets:CachedAsset[]};
  const entries=receipt.assets.map(entry=>({...entry,url:new URL(entry.url,appOrigin).href}));
  const index=await indexCachedAssets(registeredAssetPins(appOrigin,candidates),entries);
  return startVerifiedAssetHttpServer(index,appOrigin);
}
/** Input has crossed indexCachedAssets; this server never proxies, redirects, or opens an unlisted file. */
export async function startVerifiedAssetHttpServer(index: Map<string,VerifiedAsset>, appOrigin:string) {
  const files=new Map([...index.values()].map(entry=>['/'+entry.sha256,entry]));
  let requests=0; let deliveredBytes=0;
  const server=createServer(async(request,response)=>{
    try{
    const entry=files.get(request.url??'');
    if(request.method!=='GET'||!entry){response.writeHead(403);response.end();return;}
    // Each permitted browser request has already passed the per-take and whole-run asset budget.
    let start=0;let end=entry.bytes-1;const range=request.headers.range;
    if(range){const match=/^bytes=(\d+)-(\d+)$/.exec(range);start=Number(match?.[1]);end=Number(match?.[2]);
      if(!match||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=entry.bytes||end-start+1>CACHE_CHUNK_BYTES){response.writeHead(416);response.end();return;}}
    else if(entry.bytes>CACHE_DIRECT_MAX_BYTES){response.writeHead(413);response.end();return;}
    const body=await verifiedResponse(entry,start,end);
    requests++;deliveredBytes+=body.length;
    const mime=entry.file.endsWith('.mjs')?'text/javascript':entry.file.endsWith('.wasm')?'application/wasm':'application/octet-stream';
    response.writeHead(range?206:200,{'Access-Control-Allow-Origin':appOrigin,'Access-Control-Expose-Headers':'Content-Range, Content-Length',
      'Content-Type':mime,'Content-Length':String(end-start+1),'Cross-Origin-Resource-Policy':'cross-origin',
      ...(range?{'Content-Range':`bytes ${start}-${end}/${entry.bytes}`}:{})});
    response.end(body);
    }catch{if(!response.headersSent)response.writeHead(409);response.end();}
  });
  // The verified handles are owned from here: a failed bind closes them instead of leaking open descriptors.
  try{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const bound=server.address(); if(!bound||typeof bound==='string')throw Error('cached_server_bind_failed');
  }catch(error){server.close();await closeVerifiedAssetIndex(index);throw error;}
  const address=server.address() as import('node:net').AddressInfo;
  const origin=`http://127.0.0.1:${address.port}`;
  return {lookup:(url:string)=>index.has(url)?origin+'/'+index.get(url)!.sha256:null,
    rangeOptions:()=>({assets:[...index.values()].filter(e=>e.bytes>CACHE_DIRECT_MAX_BYTES).map(e=>({url:e.url,bytes:e.bytes})),chunkBytes:CACHE_CHUNK_BYTES}),
    permits:(url:string)=>{const u=new URL(url);return u.origin===origin&&files.has(u.pathname)&&!u.search;},
    snapshot:()=>({verifiedAssetCount:index.size,cacheResponseCount:requests,scheduledResponseBytes:deliveredBytes,
      externalModelRequestsForwarded:0,delivery:'verified_cached_files_not_cold_network'}),
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await closeVerifiedAssetIndex(index);}};
}

/** Only fixture delivery changes. Product preprocessing/streaming/decoder/finalization stay untouched.
 * Playwright encodes fulfilled bodies as base64; large main-thread pinned fetches must cross it in bounded chunks.
 * Each actual chunk still crosses fetchAdmittedResponse(maxRedirects:0) and the original per-take/whole-run budget. */
export function installChunkedCachedModelFetch(options:{assets:Array<{url:string;bytes:number}>;chunkBytes:number}) {
  const nativeFetch=window.fetch.bind(window);const sizes=new Map(options.assets.map(e=>[e.url,e.bytes]));
  if(!Number.isSafeInteger(options.chunkBytes)||options.chunkBytes<1||options.chunkBytes>32*1024*1024)throw Error('cached_chunk_bound_invalid');
  window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href).href;const total=sizes.get(url);
    if(!total)return nativeFetch(input,init);
    if((init?.method??(input instanceof Request?input.method:'GET'))!=='GET')throw Error('cached_chunk_method_invalid');
    const upstreamSignal=init?.signal??(input instanceof Request?input.signal:null);const abort=new AbortController();
    const cancel=()=>abort.abort();if(upstreamSignal?.aborted)cancel();else upstreamSignal?.addEventListener('abort',cancel,{once:true});
    let offset=0;
    const body=new ReadableStream<Uint8Array>({async pull(controller){
      try{
        if(offset===total){upstreamSignal?.removeEventListener('abort',cancel);controller.close();return;}
        const end=Math.min(total-1,offset+options.chunkBytes-1);
        const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));headers.set('Range',`bytes=${offset}-${end}`);
        const response=await nativeFetch(input,{...init,method:'GET',headers,signal:abort.signal});
        if(response.status!==206||response.headers.get('Content-Range')!==`bytes ${offset}-${end}/${total}`)throw Error('cached_chunk_response_invalid');
        const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==end-offset+1)throw Error('cached_chunk_length_invalid');
        offset=end+1;controller.enqueue(bytes);
      }catch(error){upstreamSignal?.removeEventListener('abort',cancel);abort.abort();controller.error(error);}
    },cancel(){upstreamSignal?.removeEventListener('abort',cancel);abort.abort();}});
    const response=new Response(body,{headers:{'Content-Length':String(total),'Content-Type':'application/octet-stream'}});
    Object.defineProperty(response,'url',{value:url});return response;
  };
}
