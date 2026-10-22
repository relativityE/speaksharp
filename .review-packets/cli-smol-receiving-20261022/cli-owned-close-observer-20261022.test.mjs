import test from 'node:test';
import assert from 'node:assert/strict';
import {observeOwnedClose} from './cli-owned-close-observer-20261022.mjs';
import {pathToFileURL} from 'node:url';
const {evaluatorContext}=await import(pathToFileURL(process.cwd()+'/scripts/model-evaluator/cdp-browser.ts').href);

const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const advance=async(t,ms)=>{for(let n=0;n<ms;n+=10){t.mock.timers.tick(Math.min(10,ms-n));await flush();}};

for(const failureEvent of ['ACTUAL_CLOSE_STARTED','ACTUAL_CLOSE_RESOLVED']){
  test(`retention failure at ${failureEvent} cannot suppress or reject real close`,async t=>{
    t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
    try{
      let calls=0,closeValue;
      const target={close:async()=>{calls++;return 'original-close-value';}},original=target.close;
      const work=observeOwnedClose({target,close:async()=>{closeValue=await target.close();},evidence:()=>({}),
        scanOwned:async()=>({complete:true,pids:[],profileMatches:[]}),verifyBorrowed:async()=>({status:'UNCHANGED'}),
        monotonic:()=>Date.now(),observerMs:30,pollMs:10,
        retain:snapshot=>{if(snapshot.events.at(-1)?.type===failureEvent)throw Error(`disk write failed at ${failureEvent}`);}});
      await flush();await advance(t,40);const r=await work;
      assert.equal(calls,1,'retention must not prevent the original close call');
      assert.equal(closeValue,'original-close-value','retention must not change original resolution');
      assert.equal(r.actualClose.status,'RESOLVED');assert.equal(r.deadline.status,'PASS');
      assert.equal(r.observer.status,'COMPLETE');assert.equal(target.close,original);
      assert.ok(r.retentionErrors.some(x=>x.error.includes(failureEvent)),'retention failure must remain observable');
    }finally{t.mock.timers.reset();}
  });
}

test('a prior absent scan cannot certify exit when close resolves during a failed current scan',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const pending=deferred();let scans=0;
    const target={close:()=>pending.promise};
    const owner=evaluatorContext({retain:()=>{},exitEvaluator:()=>{}});await owner.acquire(async()=>target,10000);
    const work=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({}),
      scanOwned:async()=>{
        if(++scans===1)return {complete:true,pids:[],profileMatches:[]};
        pending.resolve();await flush();throw Error('current ps sample failed');
      },verifyBorrowed:async()=>({status:'UNCHANGED'}),monotonic:()=>Date.now(),observerMs:50,pollMs:10});
    await flush();t.mock.timers.tick(2000);await flush();await advance(t,60);const r=await work;
    assert.equal(r.actualClose.status,'RESOLVED');assert.equal(r.deadline.status,'FAIL');
    assert.ok(scans>=2);assert.equal(r.observer.status,'LIMIT_REACHED','stale absence cannot establish current completion');
    assert.equal(r.ownedExit.status,'UNKNOWN');assert.match(r.samplingErrors[0].error,/current ps sample failed/);
  }finally{t.mock.timers.reset();}
});

test('records real close start, preserves the actual 2000ms failure, then separately observes late resolution and exit',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const pending=deferred();let calls=0,exited=false;
    const target={close(){calls++;return pending.promise;}};
    let state='NOT_CREATED';
    const owner=evaluatorContext({retain:s=>{state=s;},exitEvaluator:()=>{throw Error('unexpected emergency exit');}});
    await owner.acquire(async()=>target,10000);
    const original=target.close;
    const result=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({ownedContextState:state}),
      scanOwned:async()=>({complete:true,pids:exited?[]:[17],profileMatches:exited?[]:[17]}),
      verifyBorrowed:async()=>({status:'UNCHANGED'}),monotonic:()=>Date.now(),observerMs:100,pollMs:10});
    await flush();
    t.mock.timers.tick(2000);await flush();
    assert.equal(state,'UNKNOWN');assert.equal(calls,1);
    t.mock.timers.tick(20);await flush();pending.resolve();await flush();
    assert.equal(state,'CLOSED');exited=true;
    t.mock.timers.tick(10);await flush();
    const receipt=await result;
    assert.equal(receipt.events.filter(x=>x.type==='ACTUAL_CLOSE_STARTED').length,1,'semantic oracle: actual consumed context.close start is retained');
    assert.equal(receipt.deadline.status,'FAIL');assert.match(receipt.deadline.error,/TIMEOUT_OWNED_CONTEXT_CLOSE/);
    assert.equal(receipt.deadline.expectedMonoMs,2000);
    assert.equal(receipt.actualClose.status,'RESOLVED');
    assert.ok(receipt.actualClose.resolvedMonoMs>=receipt.deadline.observedMonoMs);
    assert.equal(receipt.ownedExit.status,'ABSENT');assert.equal(receipt.borrowedOwner.status,'UNCHANGED');
    assert.equal(receipt.observer.status,'COMPLETE');assert.equal(calls,1);assert.equal(target.close,original);
  }finally{t.mock.timers.reset();}
});

test('never-resolving actual close terminates observation and retains UNKNOWN without a false CLOSED',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const pending=deferred();let state='NOT_CREATED',calls=0,saves=0;
    const target={close(){calls++;return pending.promise;}};const original=target.close;
    const owner=evaluatorContext({retain:s=>{state=s;},exitEvaluator:()=>{throw Error('unexpected exit');}});
    await owner.acquire(async()=>target,10000);
    const work=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({ownedContextState:state}),
      scanOwned:async()=>({complete:true,pids:[17],profileMatches:[17]}),verifyBorrowed:async()=>({status:'UNCHANGED'}),
      monotonic:()=>Date.now(),observerMs:50,pollMs:10,retain:()=>{saves++;}});
    await flush();t.mock.timers.tick(2000);await flush();await advance(t,60);
    const receipt=await work;
    assert.equal(receipt.deadline.status,'FAIL');assert.equal(receipt.observer.status,'LIMIT_REACHED','semantic oracle: hanging close cannot become a complete observation');
    assert.equal(receipt.actualClose.status,'PENDING');assert.equal(state,'UNKNOWN');assert.equal(receipt.ownedExit.status,'PRESENT');
    assert.equal(target.close,original);assert.equal(calls,1);
    const saved=saves,bytes=JSON.stringify(receipt);pending.resolve();await flush();
    assert.equal(saves,saved);assert.equal(JSON.stringify(receipt),bytes,'observer cannot mutate retained output after its lifetime');
  }finally{t.mock.timers.reset();}
});

test('a resolved close with live owned processes is not verified exit',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const target={close:async()=>{}};let state='NOT_CREATED';
    const owner=evaluatorContext({retain:s=>{state=s;},exitEvaluator:()=>{}});await owner.acquire(async()=>target,10000);
    const work=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({ownedContextState:state}),
      scanOwned:async()=>({complete:true,pids:[17],profileMatches:[]}),verifyBorrowed:async()=>({status:'UNCHANGED'}),
      monotonic:()=>Date.now(),observerMs:30,pollMs:10});
    await flush();await advance(t,40);const r=await work;
    assert.equal(r.actualClose.status,'RESOLVED');assert.equal(r.ownedExit.status,'PRESENT');assert.equal(r.observer.status,'LIMIT_REACHED');
  }finally{t.mock.timers.reset();}
});

test('incomplete process scans cannot prove absence and borrowed-owner errors are retained',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const target={close:async()=>{}};const owner=evaluatorContext({retain:()=>{},exitEvaluator:()=>{}});await owner.acquire(async()=>target,10000);
    const work=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({}),
      scanOwned:async()=>({complete:false,pids:[],profileMatches:[]}),verifyBorrowed:async()=>{throw Error('borrowed owner changed');},
      monotonic:()=>Date.now(),observerMs:30,pollMs:10});
    await flush();await advance(t,40);const r=await work;
    assert.equal(r.ownedExit.status,'UNKNOWN','semantic oracle: incomplete scan cannot certify owned process absence');
    assert.match(r.samplingErrors[0].error,/Incomplete owned-process scan/);
    assert.equal(r.borrowedOwner.status,'UNKNOWN');assert.match(r.borrowedOwner.error,/borrowed owner changed/);
  }finally{t.mock.timers.reset();}
});

test('hanging metadata hooks have a bounded observer and separate borrowed-check deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const target={close:async()=>{}};const owner=evaluatorContext({retain:()=>{},exitEvaluator:()=>{}});await owner.acquire(async()=>target,10000);
    const work=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({}),scanOwned:()=>new Promise(()=>{}),
      verifyBorrowed:()=>new Promise(()=>{}),monotonic:()=>Date.now(),observerMs:50,pollMs:10,checkMs:20});
    await flush();await advance(t,100);const r=await work;
    assert.equal(r.observer.status,'LIMIT_REACHED');assert.equal(r.ownedExit.status,'UNKNOWN');
    assert.match(r.samplingErrors[0].error,/TIMEOUT_OWNED_PROCESS_SCAN/);
    assert.match(r.borrowedOwner.error,/TIMEOUT_BORROWED_OWNER_CHECK/);assert.ok(r.finishedMonoMs<=70);
  }finally{t.mock.timers.reset();}
});

test('actual close rejection remains a failure and original property shape is restored',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  try{
    const prototype={close:async()=>{throw Error('real close refused');}};const target=Object.create(prototype);
    const owner=evaluatorContext({retain:()=>{},exitEvaluator:()=>{}});await owner.acquire(async()=>target,10000);
    const work=observeOwnedClose({target,close:()=>owner.close(),evidence:()=>({}),
      scanOwned:async()=>({complete:true,pids:[],profileMatches:[]}),verifyBorrowed:async()=>({status:'UNCHANGED'}),
      monotonic:()=>Date.now(),observerMs:20,pollMs:10});
    await flush();await advance(t,30);const r=await work;
    assert.equal(r.actualClose.status,'REJECTED');assert.match(r.actualClose.error,/real close refused/);
    assert.equal(r.deadline.status,'FAIL');assert.equal(Object.hasOwn(target,'close'),false);
  }finally{t.mock.timers.reset();}
});
