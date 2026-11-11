'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const timing=require('../oracles/pure/smokeTiming.cjs');
const ui=require('../browser-actions.cjs');
const focus=require('../focus-controls.cjs');
const adapters=require('../source-adapters.cjs');

test('smoke windows preserve AHT-01 eligibility and AHT-03 fixture truth while bounding the other cases',()=>{
 const fixture={"AHT-01":45700,"AHT-02":46200,"AHT-03":22000};
 for(let i=1;i<=15;i++){
  const id='AHT-'+String(i).padStart(2,'0'),fixtureDurationMs=fixture[id]??45700,requestedMs=timing.WINDOWS[id];
  assert.equal(timing.recordingWindowMs(id,{sampleMode:'smoke',fixtureDurationMs,requestedMs}),requestedMs);
  assert.equal(timing.recordingWindowMs(id,{sampleMode:'full',fixtureDurationMs,requestedMs}),fixtureDurationMs);
  assert.ok(requestedMs>=5000);
 }
 assert.equal(timing.WINDOWS['AHT-03'],22000);
 assert.ok(timing.WINDOWS['AHT-01']>=30000,'Open Mic must cross the unchanged duration gate');
 assert.ok(Math.floor(129*timing.WINDOWS['AHT-01']/45700)>=75,'the reviewed fixture window must retain at least 75 reference words');
 assert.throws(()=>timing.recordingWindowMs('AHT-02',{sampleMode:'smoke',fixtureDurationMs:46200,requestedMs:23101}),/differs/);
 assert.throws(()=>timing.recordingWindowMs('AHT-03',{sampleMode:'smoke',fixtureDurationMs:23000,requestedMs:22000}),/retain/);
});

test('browser speak consumes recordingWindowMs while semantic speechDurationMs stays intact',async()=>{
 const waits=[],c={recordingWindowMs:22850,fixture:{speechDurationMs:45700}};
 await ui.speak({waitForTimeout:async ms=>waits.push(ms)},c);
 assert.deepEqual(waits,[22850]);
 assert.equal(c.fixture.speechDurationMs,45700);
});

test('AHT-01 repeat crosses the same product duration gate while other repeats keep their bounded policy',()=>{
 assert.equal(timing.repeatRecordingWindowMs('AHT-01',{sampleMode:'smoke',recordingWindowMs:35000,fullRepeatMs:49700,savedRepeatMs:7000}),35000);
 assert.equal(timing.repeatRecordingWindowMs('AHT-01',{fullRepeatMs:49700,savedRepeatMs:7000}),49700);
 assert.equal(timing.repeatRecordingWindowMs('AHT-02',{recordingWindowMs:23100,savedRepeatMs:7000}),7000);
 assert.throws(()=>timing.repeatRecordingWindowMs('AHT-01',{sampleMode:'smoke',recordingWindowMs:29999,fullRepeatMs:49700,savedRepeatMs:7000}),/product duration gate/);
 assert.throws(()=>timing.repeatRecordingWindowMs('AHT-01',{savedRepeatMs:7000}),/product duration gate/);
});

test('fault timing uses a bounded browser-to-runner bridge and rejects uncertain or reversed evidence',()=>{
 const before=timing.epochBridge({nodeBeforeEpochMs:1000,browserEpochMs:1010,nodeAfterEpochMs:1002});
 const after=timing.epochBridge({nodeBeforeEpochMs:1100,browserEpochMs:1110,nodeAfterEpochMs:1102});
 assert.deepEqual(before,{offsetMinMs:8,offsetMaxMs:10,roundTripMs:2});
 const ok=timing.comparableFaultTimeline({beforeBridge:before,afterBridge:after,faultNodeEpochMs:1020,errorBrowserEpochMs:1040,retryBrowserEpochMs:1050});
 assert.equal(ok.comparable,true);assert.deepEqual([ok.faultToErrorMinMs,ok.faultToErrorMaxMs,ok.errorToRetryMinMs,ok.errorToRetryMaxMs],[10,12,0,10]);
 assert.equal(ok.retryTimingKind,'visibility-observed-no-later-than-upper-bound');
 const delayed=timing.comparableFaultTimeline({beforeBridge:before,afterBridge:after,faultNodeEpochMs:1020,errorBrowserEpochMs:1040,retryBrowserEpochMs:6040});
 assert.deepEqual([delayed.errorToRetryMinMs,delayed.errorToRetryMaxMs],[0,5000]);
 assert.equal(timing.comparableFaultTimeline({beforeBridge:before,afterBridge:after,faultNodeMinEpochMs:1019,faultNodeMaxEpochMs:1031,errorBrowserEpochMs:1040,retryBrowserEpochMs:1050}).reason,'timeline-order-ambiguous');
 assert.equal(timing.comparableFaultTimeline({beforeBridge:before,afterBridge:{offsetMinMs:-500,offsetMaxMs:500},faultNodeEpochMs:1020,errorBrowserEpochMs:1040,retryBrowserEpochMs:1050}).reason,'clock-bridge-uncertain');
 assert.equal(timing.comparableFaultTimeline({beforeBridge:before,afterBridge:after,faultNodeEpochMs:1020,errorBrowserEpochMs:1040,retryBrowserEpochMs:1039}).reason,'timeline-order-invalid');
});

test('Focus smoke plan uses the reviewed recording window, not full semantic duration',()=>{
 const manifest=require('../oracles/pure/fixture-manifest.json'),fixture=manifest.fixtures.focus_points_tts;
 const c={caseId:'AHT-02',sampleMode:'smoke',recordingWindowMs:23100,fixture:{name:'focus_points_tts',sha256:fixture.sha256}};
 assert.equal(focus.plan(c).fullMs,23100);
 assert.ok(Math.round(fixture.speechSeconds*1000)>focus.plan(c).fullMs);
});

test('Focus smoke preflight accepts its reviewed one-take cap without weakening full mode',()=>{
 const manifest=require('../oracles/pure/fixture-manifest.json'),fixture=manifest.fixtures.focus_points_tts;
 const points=['First approved point','Second approved point','Third approved point','Unspoken point'];
 const base={caseId:'AHT-02',recordingWindowMs:23100,fixture:{name:'focus_points_tts',sha256:fixture.sha256},takeCap:1,focus:{points,expectedFinal:['covered','covered','covered','pending'],newPoints:[points[0],points[1],'A closing promise we never make'],editedPoints:points.slice(0,3),speechWindows:fixture.pointAudioWindows}};
 assert.equal(focus.preflight({...base,sampleMode:'smoke'}).ready,true);
 assert.throws(()=>focus.preflight({...base,sampleMode:'full'}),/take cap/);
});

test('lease boundary passes only a fresh empty owner read plus an independently idle local engine',()=>{
 const idle={liveTracks:0,recording:false,recorderVisible:false};
 assert.deepEqual(timing.leaseBoundary({leaseRows:[],mic:idle}),{ready:true,code:'LEASE_ABSENT_ENGINE_IDLE',reads:1,leaseRows:0,liveTracks:0,recording:false,recorderVisible:false});
 assert.equal(timing.leaseBoundary({leaseRows:[{state:'active'}],mic:idle}).code,'LEASE_LIVE');
 assert.equal(timing.leaseBoundary({leaseRows:null,mic:idle}).code,'LEASE_READ_UNAVAILABLE');
 assert.equal(timing.leaseBoundary({leaseRows:[],mic:{...idle,liveTracks:1,recording:true}}).code,'LOCAL_ENGINE_LIVE');
 assert.equal(timing.leaseBoundary({leaseRows:[],mic:null}).code,'MIC_STATE_UNAVAILABLE');
});

test('smoke fails closed on a short diagnostic ceiling while full acceptance preserves its separate envelope',()=>{
 assert.equal(timing.modelFailureDeadlineMs({sampleMode:'smoke'}),30000);
 assert.equal(timing.modelFailureDeadlineMs({sampleMode:'full'}),300000);
});

test('model failure wait is event-driven and reports transition latency',async()=>{
 const calls=[];
 const page={evaluate:async(fn,arg)=>{calls.push({source:String(fn),arg});return {state:'init-failed',startedAtEpochMs:1000,observedAtEpochMs:1037,elapsedMs:37};}};
 const observed=await adapters.waitForModelFailure(page,{sampleMode:'smoke'});
 assert.deepEqual(observed,{state:'init-failed',startedAtEpochMs:1000,observedAtEpochMs:1037,elapsedMs:37});
 assert.equal(calls[0].arg.deadlineMs,30000);
 assert.match(calls[0].source,/MutationObserver/);
 assert.match(calls[0].source,/attributeFilter:\['data-model-status'\]/);
 assert.match(calls[0].source,/sawNonTerminal/);
});

test('AHT-04 settlement wait is bounded inside the smoke case and preserves an honest timeout',async()=>{
 const calls=[];const page={evaluate:async(fn,arg)=>{calls.push({source:String(fn),arg});return {state:'loading',settled:false,elapsedMs:arg.deadlineMs};}};
 assert.deepEqual(await adapters.waitForModelSettlement(page,{sampleMode:'smoke'}),{state:'loading',settled:false,elapsedMs:20000});
 assert.equal(calls[0].arg.deadlineMs,20000);assert.match(calls[0].source,/MutationObserver/);
});

test('AHT-04 timeout preserves completed partial rows without duplicating the pending assertion',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../source-adapters.cjs'),'utf8');
 const section=source.slice(source.indexOf("}else if(caseId==='AHT-04'){"),source.indexOf("}else if(['AHT-05','AHT-06'].includes(caseId)){"));
 assert.equal((section.match(/assertion\('cold-pending-observed'/g)||[]).length,1,'only the pre-stimulus NOT RUN path may write this row directly');
 assert.match(section,/executionSignals\.aht04ModelSettlement=\{settled:false,waitedMs:settlement\.elapsedMs\}/);
 assert.match(section,/notRun\('model settlement not observed inside AHT-04 case deadline'\)/);
});

test('runtime smoke lease path waits from a live lease to an authenticated idle owner-table boundary',async()=>{
 const calls=[],db={owner:true},idle={liveTracks:0,recording:false,recorderVisible:false};let clock=0;
 const leaseSequence=[[{state:'active'}],[],[]],micSequence=[{...idle,liveTracks:1,recording:true},idle,idle];
 const result=await adapters.smokeLeaseBoundary({page:true},{caseId:'AHT-01'}, {
  createDb:(page,c)=>{assert.equal(page.page,true);assert.equal(c.caseId,'AHT-01');return db;},
  read:async(actual,table,columns)=>{calls.push({actual,table,columns});return leaseSequence.shift();},
  readMic:async()=>micSequence.shift(),
  wait:async ms=>{clock+=ms;},deadlineWait:()=>new Promise(()=>{}),now:()=>clock,deadlineMs:1000,pollMs:250,
 });
 assert.equal(result.ready,true);
 assert.equal(result.reads,3);assert.equal(result.elapsedMs,500);assert.equal(result.code,'LEASE_ABSENT_ENGINE_IDLE_CONFIRMED');
 assert.deepEqual(calls,[{actual:db,table:'active_recording_lease',columns:'user_id,lease_id,state'},{actual:db,table:'active_recording_lease',columns:'user_id,lease_id,state'},{actual:db,table:'active_recording_lease',columns:'user_id,lease_id,state'}]);
 const unavailable=await adapters.smokeLeaseBoundary({}, {}, {createDb:()=>db,read:async()=>{throw Error('denied');},readMic:async()=>idle,deadlineWait:()=>new Promise(()=>{}),now:()=>0});
 assert.equal(unavailable.code,'LEASE_READ_UNAVAILABLE');
});

test('late authoritative lease heartbeat defeats an earlier empty snapshot without forced release',async()=>{
 const idle={liveTracks:0,recording:false,recorderVisible:false};let clock=0,index=0;
 const sequence=[[],[{state:'active',lease_id:'late-heartbeat'}],[{state:'active',lease_id:'late-heartbeat'}]];
 const result=await adapters.smokeLeaseBoundary({},{},{
  createDb:()=>({owner:true}),read:async()=>sequence[Math.min(index++,sequence.length-1)],readMic:async()=>idle,
  wait:async ms=>{clock+=ms;},deadlineWait:()=>new Promise(()=>{}),now:()=>clock,deadlineMs:500,pollMs:250,
 });
 assert.equal(result.ready,false);assert.equal(result.code,'LEASE_WAIT_TIMEOUT');assert.equal(result.lastCode,'LEASE_LIVE');
 assert.equal(index,2,'the late heartbeat is read before any idle decision can be returned');
});

test('runtime smoke lease path stops at its bound without inferring expiry or forcing release',async()=>{
 const db={owner:true},idle={liveTracks:0,recording:false,recorderVisible:false};let clock=0,reads=0;
 const result=await adapters.smokeLeaseBoundary({},{}, {
  createDb:()=>db,read:async()=>{reads++;return [{state:'active'}];},readMic:async()=>idle,
  wait:async ms=>{clock+=ms;},deadlineWait:()=>new Promise(()=>{}),now:()=>clock,deadlineMs:500,pollMs:200,
 });
 assert.deepEqual(result,{ready:false,code:'LEASE_WAIT_TIMEOUT',lastCode:'LEASE_LIVE',reads:3,elapsedMs:500});
 assert.equal(reads,3,'the deadline is checked before a fourth owner query begins');
});

test('production smoke lease path refuses an idle owner read that completes after the overall deadline',async()=>{
 const db={owner:true},idle={liveTracks:0,recording:false,recorderVisible:false};let clock=0,micReads=0;
 const result=await adapters.smokeLeaseBoundary({},{}, {
  createDb:()=>db,
  read:async()=>{clock=501;return [];},
  readMic:async()=>{micReads++;return idle;},
  wait:async ms=>{clock+=ms;},deadlineWait:()=>new Promise(()=>{}),now:()=>clock,deadlineMs:500,pollMs:100,
 });
 assert.deepEqual(result,{ready:false,code:'LEASE_WAIT_TIMEOUT',lastCode:'LEASE_READ_DEADLINE',reads:0,elapsedMs:501});
 assert.equal(micReads,0,'an owner read that outlives the campaign deadline cannot be followed by a mic read or accepted as idle');
});

test('production smoke lease path bounds a never-resolving owner query and ignores its late settlement',async()=>{
 let clock=0,micReads=0,resolveOwner;
 const ownerPending=new Promise(resolve=>{resolveOwner=resolve;});
 const result=await adapters.smokeLeaseBoundary({},{}, {
  createDb:()=>({owner:true}),read:()=>ownerPending,readMic:async()=>{micReads++;return {liveTracks:0,recording:false,recorderVisible:false};},
  deadlineWait:async ms=>{clock+=ms;},wait:async()=>{},now:()=>clock,deadlineMs:500,pollMs:100,
 });
 assert.deepEqual(result,{ready:false,code:'LEASE_WAIT_TIMEOUT',lastCode:'LEASE_READ_DEADLINE',reads:0,elapsedMs:500});
 resolveOwner([]);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(micReads,0,'a late owner settlement cannot resume the completed boundary or reach the mic/recording path');
 assert.equal(result.ready,false);
});

test('production smoke lease path bounds a never-resolving mic read without an unhandled late rejection',async()=>{
 let clock=0,deadlineCalls=0,rejectMic,unhandled=null;
 const micPending=new Promise((_,reject)=>{rejectMic=reject;});
 const result=await adapters.smokeLeaseBoundary({},{}, {
  createDb:()=>({owner:true}),read:async()=>[],readMic:()=>micPending,
  deadlineWait:ms=>{deadlineCalls++;if(deadlineCalls===1)return new Promise(()=>{});clock+=ms;return Promise.resolve();},
  wait:async()=>{},now:()=>clock,deadlineMs:500,pollMs:100,
 });
 assert.deepEqual(result,{ready:false,code:'LEASE_WAIT_TIMEOUT',lastCode:'MIC_READ_DEADLINE',reads:0,elapsedMs:500});
 const listener=reason=>{unhandled=reason;};process.once('unhandledRejection',listener);
 rejectMic(Error('late mic rejection'));await new Promise(resolve=>setImmediate(resolve));process.removeListener('unhandledRejection',listener);
 assert.equal(unhandled,null,'the losing in-flight read has a rejection handler before the deadline race begins');
 assert.equal(result.ready,false);
});

test('Focus smoke scores only point windows fully heard before Stop',()=>{
 const windows=[[2.91,6.21],[11.98,16.16],[21.64,25.16],[32.22,36.91]],expected=['covered','covered','covered','covered'];
 assert.deepEqual(timing.focusWindowVerdict({windows,expected,statuses:['covered','covered','pending','pending'],recordingWindowMs:23100}),{result:'PASS',facts:{recordingWindowMs:23100,eligiblePoints:2,matchingPoints:2,unscoredPoints:2}});
 assert.equal(timing.focusWindowVerdict({windows,expected,statuses:['covered','pending','pending','pending'],recordingWindowMs:23100}).result,'FAIL');
 assert.equal(timing.focusWindowVerdict({windows:null,expected,statuses:[],recordingWindowMs:23100}).result,'NOT RUN');
});

test('smoke denominator is distinct, complete, and never mutates the full contracts',()=>{
 const catalog=require('../../../config/smoke-assertion-catalog.json');
 let total=0;
 for(const [caseId,contract] of Object.entries(adapters.SMOKE_CONTRACTS)){
  assert.deepEqual(contract.rows,catalog.cases[caseId].requiredAssertions);
  assert.notDeepEqual(contract.rows,adapters.CONTRACTS[caseId].rows);
  total+=contract.rows.length;
 }
 assert.equal(total,catalog.totalAssertions);
 assert.equal(adapters.CONTRACTS['AHT-02'].rows.includes('smoke-focus-window'),false);
});

test('source increment gives smoke an owner-read condition while preserving the unselected full path',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../source-adapters.cjs'),'utf8');
 assert.ok(source.includes("c.sampleMode==='smoke'"));
 assert.ok(source.includes('leaseFacts=await smokeLeaseBoundary(page,c)'));
 assert.ok(source.includes('waitForModelFailure(page,c)'));
});
