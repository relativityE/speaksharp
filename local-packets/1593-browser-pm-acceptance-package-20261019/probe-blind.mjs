// Actual pinned watchdog/provenance, deterministic CDP/Page/tap doubles. No browser or network.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),ts=require('typescript');
const head='401da0f3e3d13795f2b8acaf36ce7bcc45eb65fa', hashes={};
function moduleAt(path,dependencies={}){
 const source=execFileSync('git',['show',head+':'+path],{encoding:'utf8'});
 hashes[path]=createHash('sha256').update(source).digest('hex');
 const m={exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {module:m,exports:m.exports,require:id=>id in dependencies?dependencies[id]:require(id),Buffer,URL,process,console,Date,setTimeout,clearTimeout,setInterval,clearInterval});
 return m.exports;
}
const identity=moduleAt('tests/live/helpers/rwtDocumentIdentity.ts');
// Unused by JourneyWatchdog; finalizer's unrelated exported bound dependency is a declared double.
const watchdog=moduleAt('tests/live/helpers/rwtWatchdog.ts',{'./rwtDocumentIdentity':identity,'./rwtCoachingEvidence':{COACHING_SETTLE_BOUND_MS:60000}});
const controls=[];
for(const [name,blind,readable,loss,expected] of [
 ['clean readable page',false,true,false,'PASS'],
 ['opaque beacon in watched interval plus readable page',true,true,false,'PASS'],
 ['opaque beacon without any readable observation',true,false,false,'HOLD'],
 ['notified provenance loss plus readable page',false,true,true,'HOLD']]){
 const cdp=new EventEmitter();cdp.send=async m=>m==='Page.getFrameTree'?{frameTree:{frame:{id:'main',loaderId:'L1'}}}:{};
 const page=new EventEmitter();page.isClosed=()=>false;page.context=()=>({close:async()=>{}});
 page.evaluate=async()=>readable?{runtimeState:'IDLE',modelStatus:'ready',control:'mic-start',controlEnabled:true,progress:null}:null;
 await identity.trackDocuments(page,cdp);
 const tap={events:[],blindBeacons:blind?1:0,blindAt:blind?[Date.now()]:[]};
 const w=new watchdog.JourneyWatchdog({page,tap,profile:{},label:'offline-blind-control',log:()=>{}});
 if(blind)tap.blindAt[0]=Date.now();
 if(loss)cdp.emit('Inspector.detached',{});
 await w.tick();const rows=[];await w.record({row:(...args)=>rows.push(args)});
 assert.equal(rows.length,1);assert.equal(rows[0][1],expected);
 controls.push({name,blindCount:tap.blindBeacons,verdict:rows[0][1],observation:rows[0][3]});
}
const result={observedAtUtc:new Date().toISOString(),head,hashes,groupedControls:controls.length,controls,
 disposition:'Confirms existing P1 r4314310162: opaque-body uncertainty can coexist with watchdog PASS. No new finding credit claimed.',
 scope:'Actual pinned JourneyWatchdog and DocumentProvenance with deterministic Page/CDP/tap doubles. Opaque tap state supplied directly; actual Blob transport/CDP body unavailability frequency and received settlement were not executed. Unused finalizer bound dependency doubled. No historical/live causal attribution.'};
writeFileSync(new URL('blind-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
