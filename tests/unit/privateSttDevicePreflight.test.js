import assert from 'node:assert/strict';
import { test } from 'vitest';
import { privateSttDevicePreflight as qualify } from '../../scripts/lib/privateSttDevicePreflight.mjs';

const sha = 'a'.repeat(40);
const make = () => ({ sourceSha:sha,servedSha:sha,devices:['desktop','iphone-safari','android-chrome'].map(target=>({
  target,physical:target !== 'desktop',allow:true,deny:true,workerStarted:true,noDownloadBeforeConsent:true,coldDownloadVerified:true,
  betweenFilesRetrySaved:true,midFileRetrySaved:true,cancelSafe:true,cacheEvictionTruthful:true,
  warmNoSetupPrompt:true,warmSaved:true,lockRecovered:true,backgroundRecovered:true,
  wifi:{bytes:4096,transferMs:100,setupMs:300},mobileThrottled:{bytes:4096,transferMs:900,setupMs:1100},
  warmBytes:{session2:0,session3:0},warmReadyMs:{session2:3000,session3:5000},
  takes:Array.from({length:20},(_,i)=>({ordinal:i+1,durationMs:30000,finalMs:i===0?5001:5000,stopAckMs:250,reload:false,saveCount:1,ownedSaveMatchesTake:true}))
})) });
const d = r=>r.devices[1];
test('structural only, with one slow final out of exactly 20 per device',()=>assert.deepEqual(qualify(make(),sha),
  {status:'STRUCTURALLY_COMPLETE',reason:'device_receipt_shape_only'}));
test.each([
  ['unbound source','release_binding',r=>{r.sourceSha='b'.repeat(40)}],
  ['unbound served','release_binding',r=>{r.servedSha='b'.repeat(40)}],
  ['emulated phone','device_matrix',r=>{d(r).physical=false}],
  ['duplicate desktop','device_matrix',r=>{d(r).target='desktop'}],
  ['lock unknown','device_behavior',r=>{d(r).lockRecovered=null}],
  ['background false','device_behavior',r=>{d(r).backgroundRecovered=false}],
  ['not denied','device_behavior',r=>{d(r).deny=false}],
  ['missing worker','device_matrix',r=>{delete d(r).workerStarted}],
  ['no interrupted retry save','device_behavior',r=>{d(r).midFileRetrySaved=false}],
  ['no throttled bytes','cold_transfer',r=>{d(r).mobileThrottled.bytes=0}],
  ['missing finite Wi-Fi setup','cold_transfer',r=>{d(r).wifi.setupMs=Infinity}],
  ['missing session2 ready time','warm_cache_ready_latency',r=>{delete d(r).warmReadyMs.session2}],
  ['session2 warm ready at 5001','warm_cache_ready_latency',r=>{d(r).warmReadyMs.session2=5001}],
  ['session3 warm ready at 5001','warm_cache_ready_latency',r=>{d(r).warmReadyMs.session3=5001}],
  ['session3 download','warm_cache',r=>{d(r).warmBytes.session3=1}],
  ['pooled take shortage','warm_sample',r=>{d(r).takes.pop()}],
  ['duplicate ordinal','warm_sample',r=>{d(r).takes[1].ordinal=1}],
  ['short take','warm_sample',r=>{d(r).takes[0].durationMs=28999}],
  ['below 95%','warm_final_latency',r=>{d(r).takes[1].finalMs=5001}],
  ['long take','warm_sample',r=>{d(r).takes[0].durationMs=31001}],
  ['cold transfer longer than setup','cold_transfer',r=>{d(r).mobileThrottled.setupMs=899}],
  ['between-files retry did not save','device_behavior',r=>{d(r).betweenFilesRetrySaved=false}],
  ['second setup prompt','device_behavior',r=>{d(r).warmNoSetupPrompt=false}],
  ['wrong saved take','warm_integrity',r=>{d(r).takes[0].ownedSaveMatchesTake=false}],
  ['slow Stop','warm_integrity',r=>{d(r).takes[0].stopAckMs=251}],
  ['reload','warm_integrity',r=>{d(r).takes[0].reload=true}],
  ['lost save','warm_integrity',r=>{d(r).takes[0].saveCount=0}],
  ['duplicate save','warm_integrity',r=>{d(r).takes[0].saveCount=2}],
  ['raw payload not allowed','warm_sample',r=>{d(r).takes[0].transcript='fixture'}]
])('%s', (_name, reason, alter) => {
  const receipt = make();
  alter(receipt);
  assert.deepEqual(qualify(receipt, sha), { status: 'HOLD', reason });
});
