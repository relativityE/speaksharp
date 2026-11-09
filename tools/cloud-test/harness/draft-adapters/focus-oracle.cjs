'use strict';
// r14 Focus live-rail oracles. Pure: no browser, network, filesystem, credentials or clock.
//
// R5 correction (2026-10-28): the r13 row `focus-next-point-marked` demanded that the "Still to cover" marker MOVE at least once. The product keeps
// the marker on the FIRST UNCOVERED point (frontend/src/utils/focusCoverage.ts: nextIndex = first row whose covered flag is false; a live `partial`
// row counts as covered). When point 0 stays pending while later points change, the marker correctly stays on point 0, so "must move" failed a
// correct product and conflated two questions. They are separate here:
//   1. markerVerdict       - is the marker ALWAYS on the first uncovered (pending) point, and absent only when every point is covered? (row `focus-next-point-marked`)
//   2. recognitionProgress - did the points leave `pending` as their audio played, and which did not? (DIAGNOSTIC facts only; never a requirement row and never a product verdict by itself)
// Timeline entries are [msSinceObserverStart, markerIndexOrNull, [statusPerPoint...]] and are written only when the (marker, statuses) pair changes.
const CONCLUSIVE=new Set(['pending','partial','covered']);
const finite=n=>Number.isFinite(n)?n:null;
const isEntry=e=>Array.isArray(e)&&e.length===3&&Number.isFinite(e[0])&&(e[1]===null||Number.isInteger(e[1]))&&Array.isArray(e[2]);
const conclusive=e=>isEntry(e)&&e[2].length>0&&e[2].every(s=>CONCLUSIVE.has(s));
// First point still uncovered: the first `pending` row. `partial` and `covered` are detected, so they never carry the marker.
const expectedNext=statuses=>{const i=statuses.indexOf('pending');return i===-1?null:i;};
function known(o){return !!o&&o.frozen===true&&Number.isInteger(o.samples)&&o.samples>0&&o.unreadable===0&&Array.isArray(o.timeline)&&o.timeline.length>0&&o.timeline.length<200;}
const RANK={pending:0,partial:1,covered:2};
// Contradictions are observations that cannot all be true of one correct rail: a point's status moving backwards (the product only ever strengthens a live status), timestamps that go
// backwards, or a marker index outside the rail. They are never turned into a PASS or a product FAIL by themselves; the marker row is NOT RUN (inconclusive) unless a real marker defect is also present.
function contradictions(entries,n){
  const kinds=new Set();let regress=0;
  for(let k=1;k<entries.length;k++){
    if(entries[k][0]<entries[k-1][0])kinds.add('timestamps-went-backwards');
    const a=entries[k-1][2],b=entries[k][2];
    for(let i=0;i<Math.min(a.length,b.length);i++)if(RANK[a[i]]!==undefined&&RANK[b[i]]!==undefined&&RANK[b[i]]<RANK[a[i]]){kinds.add('status-went-backwards');regress++;}
    if(a.length!==b.length)kinds.add('point-count-changed');
  }
  if(entries.some(e=>Number.isInteger(e[1])&&(e[1]<0||e[1]>=e[2].length)))kinds.add('marker-out-of-range');
  return {kinds:[...kinds].sort(),regress};
}
function markerVerdict(o){
  const ok=known(o);const entries=ok?o.timeline.filter(isEntry):[];const good=entries.filter(conclusive);
  const wrong=good.filter(e=>e[1]!==expectedNext(e[2]));
  const duplicates=ok&&Array.isArray(o.multiMarker)?o.multiMarker.filter(m=>Array.isArray(m)&&Number.isInteger(m[1])&&m[1]>1):[];
  const withPending=good.filter(e=>expectedNext(e[2])!==null);
  const onFirstPending=withPending.filter(e=>e[1]===expectedNext(e[2])).length;
  const allCoveredStates=good.filter(e=>expectedNext(e[2])===null);
  const lastGood=good.length?good[good.length-1]:null;
  const con=ok?contradictions(good,good.length?good[0][2].length:0):{kinds:[],regress:0};
  let result='NOT RUN',basis='unobserved';
  if(ok&&good.length>0){
    if(wrong.length>0){result='FAIL';basis='marker-wrong';}
    else if(duplicates.length>0){result='FAIL';basis='duplicate-marker';}
    else if(con.kinds.length>0){result='NOT RUN';basis='contradictory-state';}
    else if(withPending.length>0){result='PASS';basis='marker-consistent';}
  }
  return {result,facts:{
    oracle:'marker-on-first-uncovered-point',resultBasis:basis,
    samples:finite(o?.samples),unreadable:finite(o?.unreadable),
    states:ok?entries.length:null,conclusiveStates:ok?good.length:null,inconclusiveStates:ok?entries.length-good.length:null,
    statesWithPendingPoint:ok?withPending.length:null,markerOnFirstPendingStates:ok?onFirstPending:null,
    inconsistentStates:ok?wrong.length:null,firstInconsistentMs:wrong.length?finite(wrong[0][0]):null,
    duplicateMarkerSamples:ok?duplicates.length:null,maxMarkersInASample:ok?duplicates.reduce((m,d)=>Math.max(m,d[1]),1):null,firstDuplicateMarkerMs:duplicates.length?finite(duplicates[0][0]):null,
    contradictionKinds:ok?con.kinds:null,statusRegressions:ok?con.regress:null,
    allCoveredStates:ok?allCoveredStates.length:null,markerShownWhileAllCovered:ok?allCoveredStates.some(e=>e[1]!==null):null,
    finalMarker:lastGood?lastGood[1]:null,expectedFinalMarker:lastGood?expectedNext(lastGood[2]):null,
    movementRequired:false,timeline:ok?entries.slice(0,60):null}};
}
// windows: pointAudioWindows in fixture seconds [[start,end],...]; optional audio.recordingAudioSec = estimated fixture position when the recorder entered RECORDING.
function recognitionProgress(o,windows){
  if(!known(o))return {verdict:'unobserved',diagnosticOnly:true,facts:{observed:false,diagnosticOnly:true}};
  const entries=o.timeline.filter(conclusive);
  if(!entries.length)return {verdict:'unobserved',diagnosticOnly:true,facts:{observed:false,diagnosticOnly:true}};
  const n=entries[0][2].length;
  const firstLeftPendingMs=Array.from({length:n},(_,i)=>{const e=entries.find(x=>x[2][i]!=='pending');return e?finite(e[0]):null;});
  const last=entries[entries.length-1][2];
  const leftPending=last.map(s=>s!=='pending');
  const lastIdx=leftPending.lastIndexOf(true);
  const earliestPendingWhileLaterMoved=lastIdx>0?leftPending.slice(0,lastIdx).findIndex(v=>!v):-1;
  const openingPending=leftPending[0]===false;
  const laterMoved=leftPending.slice(1).some(Boolean);
  let verdict='all-points-progressed';
  if(!leftPending.some(Boolean))verdict='no-progress';
  else if(!leftPending.every(Boolean))verdict=openingPending&&laterMoved?'opening-pending-later-progressed':'some-points-pending';
  const w=Array.isArray(windows)?windows:[];
  return {verdict,diagnosticOnly:true,facts:{
    observed:true,diagnosticOnly:true,verdict,points:n,pointsLeftPending:leftPending.filter(Boolean).length,
    leftPendingByPoint:leftPending,firstLeftPendingMsByPoint:firstLeftPendingMs,
    statusRegressions:contradictions(entries,n).regress,openingPointStillPending:openingPending,laterPointsProgressedWhileOpeningPending:openingPending&&laterMoved,
    firstUncoveredPointAtEnd:earliestPendingWhileLaterMoved===-1?(leftPending.every(Boolean)?null:leftPending.indexOf(false)):earliestPendingWhileLaterMoved,
    audioWindowStartSecByPoint:w.map(x=>Array.isArray(x)?finite(x[0]):null),audioWindowEndSecByPoint:w.map(x=>Array.isArray(x)?finite(x[1]):null)}};
}
module.exports={expectedNext,markerVerdict,recognitionProgress,known,conclusive};
