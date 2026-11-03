'use strict';

// Content-free timing policy for the bounded all-area smoke. Fixture duration remains
// semantic truth; recordingWindowMs only controls how long the browser records.
const WINDOWS=Object.freeze({
  // Open Mic is eligible for coaching only after both the 30 second and
  // 75-word product gates.  Thirty-five seconds keeps the bounded smoke
  // below the full fixture while leaving real margin over both gates.
  'AHT-01':35000,
  'AHT-02':23100,
  'AHT-03':22000,
  'AHT-04':22850,
  'AHT-05':22850,
  'AHT-06':22850,
  'AHT-07':22850,
  'AHT-08':22850,
  'AHT-09':22850,
  'AHT-10':22850,
  'AHT-11':22850,
  'AHT-12':22850,
  'AHT-13':22850,
  'AHT-14':22850,
  'AHT-15':22850,
});

// The smoke path measures the real model-fault-to-visible-error transition. It
// exits on the state mutation and fails closed after 30 seconds; it never waits
// out the old five-minute production envelope merely to collect a diagnostic.
// Full acceptance retains its existing ceiling until smoke telemetry justifies
// a separately reviewed reduction.
const MODEL_FAILURE_SMOKE_DEADLINE_MS=30000;
const MODEL_FAILURE_FULL_DEADLINE_MS=300000;
const MODEL_SETTLEMENT_SMOKE_DEADLINE_MS=20000;
const LEASE_WAIT_DEADLINE_MS=20000;
const LEASE_POLL_MS=250;

function recordingWindowMs(caseId,{sampleMode,fixtureDurationMs,requestedMs}={}){
  if(sampleMode!=='smoke')return fixtureDurationMs;
  const expected=WINDOWS[caseId];
  if(!Number.isInteger(expected)||expected<5000)throw new Error('smoke recording window is not reviewed');
  if(requestedMs!==expected)throw new Error('smoke recording window differs from reviewed policy');
  if(caseId==='AHT-03'&&requestedMs!==fixtureDurationMs)throw new Error('AHT-03 smoke must retain the fixture duration');
  return requestedMs;
}

function repeatRecordingWindowMs(caseId,{recordingWindowMs:requestedMs,savedRepeatMs}={}){
  if(caseId==='AHT-01'){
    if(!Number.isInteger(requestedMs)||requestedMs<30000)throw new Error('AHT-01 repeat must retain the product duration gate');
    return requestedMs;
  }
  if(!Number.isInteger(savedRepeatMs)||savedRepeatMs<1)throw new Error('repeat recording window unavailable');
  return savedRepeatMs;
}

function epochBridge({nodeBeforeEpochMs,browserEpochMs,nodeAfterEpochMs}={}){
  if(![nodeBeforeEpochMs,browserEpochMs,nodeAfterEpochMs].every(Number.isSafeInteger)||nodeBeforeEpochMs>nodeAfterEpochMs)return null;
  return {offsetMinMs:browserEpochMs-nodeAfterEpochMs,offsetMaxMs:browserEpochMs-nodeBeforeEpochMs,
    roundTripMs:nodeAfterEpochMs-nodeBeforeEpochMs};
}

function comparableFaultTimeline({beforeBridge,afterBridge,faultNodeEpochMs,errorBrowserEpochMs,retryBrowserEpochMs}={}){
  if(!beforeBridge||!afterBridge||![faultNodeEpochMs,errorBrowserEpochMs,retryBrowserEpochMs].every(Number.isSafeInteger))return {comparable:false,reason:'timeline-input-unavailable'};
  const offsetMinMs=Math.min(beforeBridge.offsetMinMs,afterBridge.offsetMinMs),offsetMaxMs=Math.max(beforeBridge.offsetMaxMs,afterBridge.offsetMaxMs);
  if(![offsetMinMs,offsetMaxMs].every(Number.isSafeInteger)||offsetMinMs>offsetMaxMs||offsetMaxMs-offsetMinMs>250)return {comparable:false,reason:'clock-bridge-uncertain',offsetRangeMs:offsetMaxMs-offsetMinMs};
  const faultBrowserMinMs=faultNodeEpochMs+offsetMinMs,faultBrowserMaxMs=faultNodeEpochMs+offsetMaxMs;
  const faultToErrorMinMs=errorBrowserEpochMs-faultBrowserMaxMs,faultToErrorMaxMs=errorBrowserEpochMs-faultBrowserMinMs;
  const errorToRetryMs=retryBrowserEpochMs-errorBrowserEpochMs;
  if(faultToErrorMaxMs<0||errorToRetryMs<0)return {comparable:false,reason:'timeline-order-invalid',faultToErrorMinMs,faultToErrorMaxMs,errorToRetryMs};
  return {comparable:true,offsetRangeMs:offsetMaxMs-offsetMinMs,faultBrowserMinMs,faultBrowserMaxMs,
    faultToErrorMinMs,faultToErrorMaxMs,errorToRetryMs};
}

function modelFailureDeadlineMs({sampleMode}={}){
  return sampleMode==='smoke'?MODEL_FAILURE_SMOKE_DEADLINE_MS:MODEL_FAILURE_FULL_DEADLINE_MS;
}

function modelSettlementDeadlineMs({sampleMode}={}){
  return sampleMode==='smoke'?MODEL_SETTLEMENT_SMOKE_DEADLINE_MS:MODEL_FAILURE_FULL_DEADLINE_MS;
}

function leaseBoundary({leaseRows,mic}){
  if(!Array.isArray(leaseRows))return {ready:false,code:'LEASE_READ_UNAVAILABLE',reads:1};
  if(leaseRows.length!==0)return {ready:false,code:'LEASE_LIVE',reads:1,leaseRows:leaseRows.length};
  if(!mic||!Number.isInteger(mic.liveTracks)||typeof mic.recording!=='boolean'||typeof mic.recorderVisible!=='boolean')return {ready:false,code:'MIC_STATE_UNAVAILABLE',reads:1};
  if(mic.liveTracks!==0||mic.recording||mic.recorderVisible)return {ready:false,code:'LOCAL_ENGINE_LIVE',reads:1,liveTracks:mic.liveTracks,recording:mic.recording,recorderVisible:mic.recorderVisible};
  return {ready:true,code:'LEASE_ABSENT_ENGINE_IDLE',reads:1,leaseRows:0,liveTracks:0,recording:false,recorderVisible:false};
}

function focusWindowVerdict({windows,expected,statuses,recordingWindowMs}){
  if(!Array.isArray(windows)||!Array.isArray(expected)||!Array.isArray(statuses)||windows.length!==expected.length||statuses.length!==expected.length||!Number.isInteger(recordingWindowMs))return {result:'NOT RUN',facts:{reason:'focus-window-input-unavailable'}};
  const eligible=[];
  for(let i=0;i<windows.length;i++)if(Array.isArray(windows[i])&&Number.isFinite(windows[i][1])&&Math.ceil(windows[i][1]*1000)<=recordingWindowMs)eligible.push(i);
  if(!eligible.length)return {result:'NOT RUN',facts:{reason:'no-complete-point-window',recordingWindowMs}};
  const matching=eligible.filter(i=>statuses[i]===expected[i]).length;
  return {result:matching===eligible.length?'PASS':'FAIL',facts:{recordingWindowMs,eligiblePoints:eligible.length,matchingPoints:matching,unscoredPoints:windows.length-eligible.length}};
}

module.exports={WINDOWS,MODEL_FAILURE_SMOKE_DEADLINE_MS,MODEL_FAILURE_FULL_DEADLINE_MS,MODEL_SETTLEMENT_SMOKE_DEADLINE_MS,LEASE_WAIT_DEADLINE_MS,LEASE_POLL_MS,recordingWindowMs,repeatRecordingWindowMs,epochBridge,comparableFaultTimeline,modelFailureDeadlineMs,modelSettlementDeadlineMs,leaseBoundary,focusWindowVerdict};
