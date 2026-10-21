import test from 'node:test';
import assert from 'node:assert/strict';
import {runAttachProbe,availableMemory,validateEndpoint,ENDPOINT,FLOOR} from './cli-cdp-attach-probe-20261021.mjs';
const memory='The system has 8589934592\nSystem-wide memory free percentage: 27%';
const version={Browser:'Chrome/156.0.8078.47',webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/owned'};
const good={available:true,fallback:false,f16:true};
function fixture() {
  const calls=[];
  const page={on(){},async goto(url){calls.push(['goto',url]);}};
  const context={async route(){},async newPage(){return page;},async close(){calls.push('owned-context-close');}};
  const browser={version:()=>version.Browser,async newContext(){calls.push('new-owned-context');return context;},
    contexts(){throw Error('PERSONAL_CONTEXT_ENUMERATION');},async close(){throw Error('OWNER_BROWSER_CLOSE');}};
  return {calls,args:{memory,version,origin:'http://127.0.0.1:12345',report:{pageErrors:[]},
    connect:async url=>{assert.equal(url,ENDPOINT);calls.push('connect');return browser;},
    inspect:async()=>({page:good,worker:good})}};
}
test('retains existing memory-pressure accounting and2GiB floor',()=>{
  assert.equal(FLOOR,2147483648);assert.equal(availableMemory(memory),8589934592*.27);
  assert.throws(()=>availableMemory('unknown'),/MEMORY_ACCOUNTING/);
});
test('memory hold happens before browser control',async()=>{
  const f=fixture();f.args.memory=memory.replace('27%','22%');
  await assert.rejects(runAttachProbe(f.args),/HOLD_RESOURCE/);assert.deepEqual(f.calls,[]);
});
test('refuses redirected remote/browser endpoint before control',async()=>{
  for(const webSocketDebuggerUrl of ['ws://example.com:9222/devtools/browser/x','ws://127.0.0.1:9223/devtools/browser/x','ws://127.0.0.1:9222/devtools/page/x']) {
    const f=fixture();f.args.version={...version,webSocketDebuggerUrl};
    await assert.rejects(runAttachProbe(f.args),/NONLOCAL/);assert.deepEqual(f.calls,[]);
  }
  assert.throws(()=>validateEndpoint({...version,Browser:'Other/156'}),/UNEXPECTED_OWNER/);
});
test('passing control closes only its own context',async()=>{
  const f=fixture();await runAttachProbe(f.args);
  assert.equal(f.args.report.stage,'MODEL_FREE_ATTACH_PASS');
  assert.equal(f.args.report.ownedContextClosed,true);
  assert.equal(f.args.report.ownerBrowserCloseOrKillAttempted,false);
  assert.equal(f.calls.filter(c=>c==='owned-context-close').length,1);
});
test('worker failure still cleans owned context',async()=>{
  const f=fixture();f.args.inspect=async()=>{throw Error('WORKER_FAILED');};
  await assert.rejects(runAttachProbe(f.args),/WORKER_FAILED/);
  assert.equal(f.args.report.ownedContextClosed,true);
});
test('fallback or missing f16 fails the relevant page/worker gate and cleans up',async()=>{
  for(const arm of ['page','worker'])for(const invalid of [{...good,fallback:true},{...good,f16:false},{available:false}]) {
    const f=fixture();f.args.inspect=async()=>({page:good,worker:good,[arm]:invalid});
    await assert.rejects(runAttachProbe(f.args),new RegExp('HARDWARE_F16_GATE_FAILED_'+arm));
    assert.equal(f.args.report.ownedContextClosed,true);
  }
});
test('cleanup failure cannot be reported as success',async()=>{
  const f=fixture();f.args.connect=async()=>({version:()=>version.Browser,newContext:async()=>({route:async()=>{},newPage:async()=>({on(){},goto:async()=>{}}),close:async()=>{throw Error('CONTEXT_CLOSE_FAILED');}})});
  await assert.rejects(runAttachProbe(f.args),/CONTEXT_CLOSE_FAILED/);
  assert.notEqual(f.args.report.ownedContextClosed,true);
});
