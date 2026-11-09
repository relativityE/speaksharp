'use strict';
// Source rwtJourney.ts:1343–1385,1581–1718,1767–1835 (main70e).
// Real browser actions only when called by an admitted runner. No launch/transport/admin interface.
const ui=require('./browser-actions.cjs');
const mic=require('./browser-observers.cjs');
const {repeatStartVerdict,sameOrderedPendingSet}=require('./oracles/pure/extendedJourney.cjs');
const row=(id,result,facts)=>({id,result,facts});
const verdict=ok=>ok?'PASS':'FAIL';
async function pendingSameSet(page,points){const labels=await Promise.all(points.map((_,i)=>page.getByTestId('focus-point-'+i).locator('p').first().innerText()));const statuses=await Promise.all(points.map((_,i)=>page.getByTestId('focus-point-'+i).getAttribute('data-status')));const count=await page.getByTestId('focus-points-rail').getByTestId(/^focus-point-\d+$/).count();return count===points.length&&sameOrderedPendingSet(labels,statuses,points);}
function startGateWatch(page,buttonId){
 // Match the source's 250ms observation granularity; unavailable samples stay unknown, never zero activity.
 let active=true,inFlight=null,holdSeen=false,enabledWhileHolding=false,unreadable=false,samples=0;
 const sample=async()=>{let timer;try{const read=page.evaluate(id=>{const button=document.querySelector('[data-testid="'+id+'"]');return {hold:/Finishing up your last session/.test(document.body?.textContent||''),enabled:!!button&&!button.disabled&&button.getClientRects().length>0};},buttonId);const value=await Promise.race([read,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('bounded-gate-read')),5000);})]);if(active){samples++;holdSeen ||= value.hold;enabledWhileHolding ||= value.hold&&value.enabled;}}catch{if(active)unreadable=true;}finally{clearTimeout(timer);}};
 const poll=()=>{if(!active||inFlight)return;inFlight=sample().finally(()=>{inFlight=null;});};poll();const timer=setInterval(poll,250);
 let frozen=null;return {deactivate(){if(!frozen){clearInterval(timer);active=false;frozen={holdSeen,enabledWhileHolding,unreadable:unreadable||!!inFlight,samples};}return frozen;},async drain(){if(inFlight)await inFlight;},async close(){const value=this.deactivate();await this.drain();return value;}};
}
async function off(page){try{await page.waitForFunction(()=>{const o=window.__rwtGuardedMicObservation__;return !!o?.installed&&o.streams.flatMap(s=>s.getAudioTracks()).every(t=>t.readyState!=='live');},undefined,{timeout:10000});return (await mic.mic(page))?.liveTracks??null;}catch{return (await mic.mic(page).catch(()=>null))?.liveTracks??null;}}
function beginRapidRepeat(page,focus,timing={}){const id=focus?'focus-points-retry':'verdict-practice-again';return {id,reviewObservedAt:timing.savedAt??Date.now(),stopClickedAt:timing.stopClickedAt??null,savedAt:timing.savedAt??null,watch:startGateWatch(page,id)};}
async function cancelRapidWindow(window){window.watch.deactivate();await window.watch.drain();}
async function rapidRepeat(page,focus,window=beginRapidRepeat(page,focus)){
 const id=window.id,button=page.getByTestId(id),watch=window.watch;let afterActionEnabledMs=null,afterStartMs=null,stopped=false,stopAttempted=false,observation,tracks=null,pressFailure=null;
 try{const offeredAt=window.reviewObservedAt;await page.waitForFunction(id=>{const e=document.querySelector('[data-testid="'+id+'"]');return !!e&&!e.disabled&&e.getClientRects().length>0;},id,{timeout:15000});afterActionEnabledMs=Date.now()-offeredAt;if(afterActionEnabledMs>=15000)throw Error('gate budget exhausted before press');const pressed=Date.now();await ui.pressStart(page,id,{timeout:15000});await ui.recording(page,15000);afterStartMs=Date.now()-pressed;}catch(error){if(['START_PRESS_CAP','NOT_RUN'].includes(error?.code))pressFailure=error;/* Expected gate/start boundaries are adjudicated after one bounded Stop, never retried. */}
 finally{observation=watch.deactivate();try{if(await page.getByTestId('recorder-stop').isVisible()){stopAttempted=true;await ui.stop(page);stopped=true;}}catch{}tracks=await off(page);await watch.drain();}
 if(pressFailure)throw pressFailure;
 const gate=repeatStartVerdict({afterActionEnabledMs,afterStartMs,holdSeen:observation.holdSeen,enabledWhileHolding:observation.enabledWhileHolding,reason:null});const gateResult=gate.status==='FAIL'?'FAIL':observation.unreadable||observation.samples===0?'NOT RUN':'PASS';
 return [row('rapid-repeat-gate',gateResult,{afterActionEnabledMs,afterStartMs,stopToSaveMs:window.savedAt!==null&&window.stopClickedAt!==null?Math.max(0,window.savedAt-window.stopClickedAt):null,saveToGateClearMs:window.savedAt!==null?afterActionEnabledMs:null,pressToWarmupDoneMs:null,pressToRecordingMs:afterStartMs,holdSeen:observation.holdSeen,enabledWhileHolding:observation.enabledWhileHolding,observerSamples:observation.samples,observerUnreadable:observation.unreadable}),row('rapid-repeat-release',!stopped?'FAIL':tracks===null?'NOT RUN':verdict(tracks===0),{stopAttempted,stopped,liveTracks:tracks})];
}
async function nextStart(page,c){
 await page.goto(c.targetUrl+'/session',{waitUntil:'domcontentloaded',timeout:45000});let ready=false;try{await page.waitForFunction(()=>document.querySelector('[data-testid="mic-status"]')?.textContent?.includes('Mic ready on this device'),undefined,{timeout:60000});ready=true;}catch{}
 const watch=startGateWatch(page,'mic-start');let nextStartMs=null,stopped=false,stopAttempted=false,tracks=null,observation,pressFailure=null;
 try{if(ready){const start=Date.now();await ui.pressStart(page,'mic-start',{timeout:15000});await ui.recording(page,15000);nextStartMs=Date.now()-start;}}catch(error){if(['START_PRESS_CAP','NOT_RUN'].includes(error?.code))pressFailure=error;}
 finally{observation=watch.deactivate();try{if(await page.getByTestId('recorder-stop').isVisible()){stopAttempted=true;await ui.stop(page);stopped=true;}}catch{}tracks=await off(page);await watch.drain();}
 if(pressFailure)throw pressFailure;
 const positive=ready&&nextStartMs!==null&&nextStartMs<15000&&!observation.holdSeen;
 return [row('next-start',positive?(observation.unreadable||observation.samples===0?'NOT RUN':'PASS'):'FAIL',{ready,nextStartMs,holdSeen:observation.holdSeen,observerUnreadable:observation.unreadable,observerSamples:observation.samples}),row('next-start-release',!stopped?'FAIL':tracks===null?'NOT RUN':verdict(tracks===0),{stopAttempted,stopped,liveTracks:tracks})];
}
module.exports={pendingSameSet,startGateWatch,beginRapidRepeat,cancelRapidWindow,rapidRepeat,nextStart};
