'use strict';
// Passive source-state polling only. No click, regeneration, producer retry or network API.
// Main70e Open Mic source waits up to180s for ready/error/blocked; identical selected spec at d100.
async function boundedRead(fn,remainingMs,isActive){
 let timer,watch;const pending=Promise.resolve().then(fn);const halted=new Promise(resolve=>{timer=setTimeout(()=>resolve({halt:'TIMEOUT'}),Math.max(1,Math.min(5000,remainingMs)));watch=setInterval(()=>{if(!isActive())resolve({halt:'CANCELLED'});},25);});
 try{return await Promise.race([pending.then(value=>({value})),halted]);}finally{clearTimeout(timer);clearInterval(watch);}
}
async function waitCurrentCoaching({readPair,readState,sessionId,isActive=()=>true,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=180000}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>180000)throw new Error('invalid bounded coaching readiness wait');
 const started=now();let samples=0;
 while(isActive()&&now()-started<=timeoutMs){
  const read=await boundedRead(readPair,timeoutMs-(now()-started),isActive);if(read.halt)return{status:read.halt,samples};const pair=read.value;samples++;if(!isActive())return{status:'CANCELLED',samples};
  if(pair?.sessionId===sessionId&&pair.pair?.what_worked?.trim()&&pair.pair?.what_to_try_next?.trim())return{status:'READY',pair,samples,elapsedMs:now()-started};
  const terminal=await boundedRead(readState,timeoutMs-(now()-started),isActive);if(terminal.halt)return{status:terminal.halt,samples};const state=terminal.value;if(!isActive())return{status:'CANCELLED',samples};
  if(['error','blocked'].includes(state))return{status:'TERMINAL',state,samples,elapsedMs:now()-started};
  if(now()-started>=timeoutMs)break;await sleep(Math.min(200,timeoutMs-(now()-started)));
 }
 return{status:isActive()?'TIMEOUT':'CANCELLED',samples,elapsedMs:now()-started};
}
module.exports={waitCurrentCoaching};
