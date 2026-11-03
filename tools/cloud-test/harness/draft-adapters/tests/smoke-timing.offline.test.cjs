'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const timing=require('../oracles/pure/smokeTiming.cjs');
const ui=require('../browser-actions.cjs');
const focus=require('../focus-controls.cjs');
const adapters=require('../source-adapters.cjs');

test('short smoke recording windows halve 01,02,04-15 and leave 03 unchanged without rewriting fixture truth',()=>{
 const fixture={"AHT-01":45700,"AHT-02":46200,"AHT-03":22000};
 for(let i=1;i<=15;i++){
  const id='AHT-'+String(i).padStart(2,'0'),fixtureDurationMs=fixture[id]??45700,requestedMs=timing.WINDOWS[id];
  assert.equal(timing.recordingWindowMs(id,{sampleMode:'smoke',fixtureDurationMs,requestedMs}),requestedMs);
  assert.equal(timing.recordingWindowMs(id,{sampleMode:'full',fixtureDurationMs,requestedMs}),fixtureDurationMs);
  assert.ok(requestedMs>=5000);
 }
 assert.equal(timing.WINDOWS['AHT-03'],22000);
 assert.throws(()=>timing.recordingWindowMs('AHT-02',{sampleMode:'smoke',fixtureDurationMs:46200,requestedMs:23101}),/differs/);
 assert.throws(()=>timing.recordingWindowMs('AHT-03',{sampleMode:'smoke',fixtureDurationMs:23000,requestedMs:22000}),/retain/);
});

test('browser speak consumes recordingWindowMs while semantic speechDurationMs stays intact',async()=>{
 const waits=[],c={recordingWindowMs:22850,fixture:{speechDurationMs:45700}};
 await ui.speak({waitForTimeout:async ms=>waits.push(ms)},c);
 assert.deepEqual(waits,[22850]);
 assert.equal(c.fixture.speechDurationMs,45700);
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

test('the unsupported short failure deadline is refused and production envelope is preserved',()=>{
 assert.equal(timing.modelFailureDeadlineMs({sampleMode:'smoke'}),300000);
 assert.equal(timing.modelFailureDeadlineMs({sampleMode:'full'}),300000);
});

test('runtime smoke lease path waits from a live lease to an authenticated idle owner-table boundary',async()=>{
 const calls=[],db={owner:true},idle={liveTracks:0,recording:false,recorderVisible:false};let clock=0;
 const leaseSequence=[[{state:'active'}],[]],micSequence=[{...idle,liveTracks:1,recording:true},idle];
 const result=await adapters.smokeLeaseBoundary({page:true},{caseId:'AHT-01'}, {
  createDb:(page,c)=>{assert.equal(page.page,true);assert.equal(c.caseId,'AHT-01');return db;},
  read:async(actual,table,columns)=>{calls.push({actual,table,columns});return leaseSequence.shift();},
  readMic:async()=>micSequence.shift(),
  wait:async ms=>{clock+=ms;},now:()=>clock,deadlineMs:1000,pollMs:250,
 });
 assert.equal(result.ready,true);
 assert.equal(result.reads,2);assert.equal(result.elapsedMs,250);
 assert.deepEqual(calls,[{actual:db,table:'active_recording_lease',columns:'user_id,lease_id,state'},{actual:db,table:'active_recording_lease',columns:'user_id,lease_id,state'}]);
 const unavailable=await adapters.smokeLeaseBoundary({}, {}, {createDb:()=>db,read:async()=>{throw Error('denied');},readMic:async()=>idle,now:()=>0});
 assert.equal(unavailable.code,'LEASE_READ_UNAVAILABLE');
});

test('runtime smoke lease path stops at its bound without inferring expiry or forcing release',async()=>{
 const db={owner:true},idle={liveTracks:0,recording:false,recorderVisible:false};let clock=0,reads=0;
 const result=await adapters.smokeLeaseBoundary({},{}, {
  createDb:()=>db,read:async()=>{reads++;return [{state:'active'}];},readMic:async()=>idle,
  wait:async ms=>{clock+=ms;},now:()=>clock,deadlineMs:500,pollMs:200,
 });
 assert.deepEqual(result,{ready:false,code:'LEASE_WAIT_TIMEOUT',lastCode:'LEASE_LIVE',reads:4,elapsedMs:500});
 assert.equal(reads,4);
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
 assert.ok(source.includes('smokeTiming.modelFailureDeadlineMs(c)'));
});
