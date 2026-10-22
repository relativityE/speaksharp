import {execFileSync} from 'node:child_process';
import {readlinkSync} from 'node:fs';
import {deadline} from './investigation-supervision';

export const LOCAL_CDP_ENDPOINT='http://127.0.0.1:9222';
export type CdpOwner={pid:number;profile:string;listener:string};
export function parseCdpEndpoint(value:string):string|null {
  if(!value)return null;
  if(value!==LOCAL_CDP_ENDPOINT)throw new Error('Only the dedicated loopback CDP endpoint is approved');
  return value;
}
export function localCdpOwner():CdpOwner {
  const listing=execFileSync('lsof',['-nP','-iTCP:9222','-sTCP:LISTEN','-Fpn'],{encoding:'utf8',timeout:2000});
  const pids=[...new Set([...listing.matchAll(/^p(\d+)$/gm)].map(m=>m[1]))];
  const listeners=[...listing.matchAll(/^n(.+)$/gm)].map(m=>m[1]);
  if(pids.length!==1 || !listeners.length || listeners.some(x=>x!=='127.0.0.1:9222'))throw new Error('CDP listener ownership mismatch');
  const profile='/Users/fibonacci/speaksharp-eval-profile';
  const command=execFileSync('ps',['-p',pids[0],'-o','command='],{encoding:'utf8',timeout:2000}).trim();
  if(command!=='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir='+profile+' --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1' || !readlinkSync(profile+'/SingletonLock').endsWith('-'+pids[0]))
    throw new Error('CDP dedicated profile ownership mismatch');
  return {pid:Number(pids[0]),profile,listener:'127.0.0.1:9222'};
}
export async function connectLocalCdp<T extends {version():string}>(options:{
  endpoint:string;connect:(websocket:string)=>Promise<T>;owner:()=>CdpOwner;fetchVersion?:typeof fetch;
}):Promise<{browser:T;owner:CdpOwner;browserVersion:string}> {
  if(parseCdpEndpoint(options.endpoint)===null)throw new Error('CDP endpoint missing');
  const before=options.owner();
  const response=await (options.fetchVersion??fetch)(LOCAL_CDP_ENDPOINT+'/json/version',{redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('CDP discovery HTTP failure');
  const version=await response.json() as {Browser?:string;webSocketDebuggerUrl?:string};
  if(!/^Chrome\/156\./.test(version.Browser??''))throw new Error('CDP discovery version mismatch');
  const websocket=new URL(version.webSocketDebuggerUrl??'');
  if(websocket.protocol!=='ws:' || websocket.hostname!=='127.0.0.1' || websocket.port!=='9222' || websocket.username || websocket.password || websocket.search || websocket.hash || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(websocket.pathname))
    throw new Error('Nonlocal CDP websocket refused');
  const rechecked=options.owner();
  if(rechecked.pid!==before.pid || rechecked.profile!==before.profile || rechecked.listener!==before.listener)throw new Error('CDP owner changed before connection');
  // Connect to the already-validated URL, never trigger a second HTTP discovery.
  const browser=await options.connect(websocket.href);
  if(browser.version()!==version.Browser!.slice(7))throw new Error('Actual attached browser version mismatch');
  return {browser,owner:rechecked,browserVersion:browser.version()};
}
export async function closeOwnedContext(context:{close():Promise<void>}|undefined):Promise<void>{
  await context?.close();
}

export type OwnedContextState='NOT_CREATED'|'PENDING'|'OPEN'|'CLOSING'|'CLOSED'|'UNKNOWN';
/** Tracks pending creation as well as the context; never owns the borrowed browser. */
export function evaluatorContext<T extends {close():Promise<void>}>(options:{
  retain:(state:OwnedContextState)=>void;
  exitEvaluator:()=>void;
  closeMs?:number;
}) {
  let creation:Promise<T>|undefined;
  let closing:Promise<void>|undefined;
  let aborting:Promise<void>|undefined;
  let stopped=false;
  const closeMs=options.closeMs??2000;
  const assertSafe=()=>{if(stopped)throw new Error('HOLD_EVALUATOR_ABORTED');};
  const closeContext=(context:T):Promise<void>=>{
    if(!closing){
      options.retain('CLOSING');
      closing=Promise.resolve().then(()=>context.close()).then(()=>{options.retain('CLOSED');});
    }
    return closing;
  };
  const close=async()=>{
    stopped=true;
    if(!creation){options.retain('NOT_CREATED');return;}
    try {await deadline(creation.then(closeContext),closeMs,'OWNED_CONTEXT_CLOSE');}
    catch(error){options.retain('UNKNOWN');throw error;}
  };
  return {
    assertSafe,
    async acquire(create:()=>Promise<T>,ms:number):Promise<T>{
      assertSafe();
      if(creation)throw new Error('Owned context creation already requested');
      options.retain('PENDING');
      creation=Promise.resolve().then(create);
      // This handler survives an acquisition timeout. A late context is closed,
      // rather than lost because assignment after the deadline never ran.
      void creation.then(context=>{
        if(stopped)return closeContext(context);
        options.retain('OPEN');
      }).catch(()=>{options.retain('UNKNOWN');});
      const context=await deadline(creation,ms,'OWNED_CONTEXT');
      assertSafe();
      return context;
    },
    async run<R>(operation:()=>Promise<R>):Promise<R>{
      assertSafe();
      const result=await operation();
      assertSafe();
      return result;
    },
    close,
    abort():Promise<void>{
      stopped=true;
      if(!aborting)aborting=close().catch(()=>{}).finally(options.exitEvaluator);
      return aborting;
    },
  };
}
