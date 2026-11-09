'use strict';
// Real adapter, synthetic external I/O. No browser, account or network operation.
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const adapters=require('../source-adapters.cjs'),ui=require('../browser-actions.cjs'),observer=require('../browser-observers.cjs'),readback=require('../browser-readback.cjs');
async function capacityControl(count){
 const changes=[],recorded=[],writes=[];let closed=false,starts=0,opened=0;
 const patch=(object,key,value)=>{changes.push([object,key,object[key]]);object[key]=value;};
 const page=Object.assign(new EventEmitter(),{setDefaultTimeout(){},setDefaultNavigationTimeout(){},waitForTimeout:async()=>{},isClosed:()=>closed,close:async()=>{closed=true;},getByText:()=>({first(){return this;},isVisible:async()=>false})});
 patch(ui,'login',async()=>true);patch(ui,'openMic',async()=>{opened++;});
 patch(ui,'start',async()=>{starts++;throw Object.assign(Error('synthetic stop before real Start'),{code:'NOT_RUN',trustedBlocker:'synthetic-control-stop'});});
 patch(observer,'install',async()=>{});patch(readback,'sessions',async()=>Array.from({length:count},(_,i)=>({id:'synthetic-baseline-'+i,status:'completed'})));
 const contract=adapters.CONTRACTS['AHT-10'],c={caseId:'AHT-10',campaignId:'UNIT-CAPACITY',sourceSha:adapters.SOURCE_SHA,servedSha:adapters.SOURCE_SHA,targetUrl:'https://unit.invalid',requiredAssertions:contract.rows,
  account:{id:'11111111-1111-4111-8111-111111111111',mode:'existing-disposable',preprovisionReceipt:'unit/pre.json',analyticsExclusionReceipt:'unit/analytics.json',dispositionReceipt:'unit/disposition.json',effectiveFeatureAccessApproved:true},
  readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'synthetic-public',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit/rls.json',immutableFenceMigrationQualificationReceipt:'unit/fence.json'},
  observerSourceReviewed:true,observerQualificationReceipt:'unit/observer.json',takeCap:2,startPressCap:3,fixture:{sha256:'b'.repeat(64),launchSha256:'b'.repeat(64),speechDurationMs:7000},
  oracleBindings:{abandonmentLease:{sha256:'c'.repeat(64),reviewReceipt:'unit/review.json',module:'unit/abandonment.cjs'}}};
 try{const result=await adapters.run('AHT-10',{context:{newPage:async()=>page,grantPermissions:async()=>{}},guard:{summary:()=>({ledgerUsed:{model:0}})},caseConfig:c,
  capabilities:{credentials:{email:'synthetic@example.invalid',password:'synthetic-only'},recordStartPress:async()=>assert.fail('no real Start reservation in this control'),oracles:{abandonmentLease:async()=>({observed:true})},writeEvidence:async(n,v)=>{writes.push(v);return n;},recordAssertion:async r=>recorded.push(r)}});
  return {result,recorded,writes,closed,starts,opened};
 }finally{for(const [object,key,value]of changes.reverse())object[key]=value;}
}
for(const count of [99,100])test('Case10 full capacity '+count+' refuses before recording intent without deleting history',async()=>{
 const f=await capacityControl(count);assert.equal(f.starts,0);assert.equal(f.opened,0);assert.equal(f.result.blocker,'Case10 full-path history exceeds existing 100-row readback capacity');
 assert.equal(f.recorded.find(r=>r.id==='recording-before-leave')?.result,'NOT RUN');assert.equal(f.recorded.find(r=>r.id==='owned-pages-closed')?.result,'PASS');assert(f.closed);
});
test('Case10 baseline98 proceeds to the actual Start boundary, not a silent omission',async()=>{
 const f=await capacityControl(98);assert.equal(f.opened,1);assert.equal(f.starts,1);assert.equal(f.result.blocker,'synthetic-control-stop');assert(f.closed);
});
