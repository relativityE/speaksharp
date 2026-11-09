'use strict';
// Focused, content-free adaptation of rwtJourney.AnalyticsTap.decode/attach (main70e).
// Only SENT identity is captured here; ingestion is separately adjudicated from a producer readback.
const {gunzipSync,inflateSync}=require('node:zlib');
function decode(raw){if(!raw||!raw.length||raw.length>1048576)return null;const unpack=x=>{if(x.length>1048576)throw Error('size');return JSON.parse(x.toString('utf8'));};const options={maxOutputLength:1048576};
 const attempts=[()=>unpack(raw),()=>{const d=new URLSearchParams(raw.toString('utf8')).get('data');if(!d)throw Error('form');const b=Buffer.from(d,'base64');try{return unpack(gunzipSync(b,options));}catch{return unpack(b);}},()=>unpack(gunzipSync(raw,options)),()=>unpack(inflateSync(raw,options)),()=>unpack(Buffer.from(raw.toString('utf8'),'base64'))];
 for(const f of attempts)try{const p=f();return Array.isArray(p)?p:[p];}catch{}return null;
}
function attach(page){const state={events:[],blind:0,documentAt:Date.now(),batch:0};const request=r=>{try{if(r.isNavigationRequest()&&r.frame()===page.mainFrame()){state.documentAt=Date.now();return;}const u=new URL(r.url());if(!/(^|\.)posthog\.com$/i.test(u.hostname)||r.method()!=='POST')return;const batch=decode(r.postDataBuffer());if(!batch){state.blind++;return;}
  const batchId=++state.batch;let batchIndex=0;for(const x of batch){const p=x?.properties;if(typeof x?.event!=='string'||!p)continue;const str=k=>typeof p[k]==='string'?p[k]:null;
   const rawTs=p.$ts;const producerTs=typeof rawTs==='number'&&Number.isFinite(rawTs)?rawTs:typeof rawTs==='string'&&/^\d+(?:\.\d+)?$/.test(rawTs)?Number(rawTs):typeof x.timestamp==='string'&&Number.isFinite(Date.parse(x.timestamp))?Date.parse(x.timestamp):typeof p.$time==='number'&&Number.isFinite(p.$time)?Math.round(p.$time*1000):null;
   state.events.push({event:x.event,at:Date.now(),batch:batchId,batchIndex:batchIndex++,producerTs,journeyId:str('journey_id'),bootId:str('boot_id'),releaseSha:str('release_sha'),trafficType:str('traffic_type'),fields:{action:str('action'),link_state:str('link_state'),action_seq:p.action_seq,outcome:str('outcome'),submit_seq:Number.isSafeInteger(p.submit_seq)?p.submit_seq:null,error_category:str('error_category')}});
  }
 }catch{state.blind++;}};page.on('request',request);state.detach=()=>page.off('request',request);return state;}
module.exports={decode,attach};
