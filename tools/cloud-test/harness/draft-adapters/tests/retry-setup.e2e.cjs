'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ui=require('../browser-actions.cjs');
const {CONTRACTS}=require('../source-adapters.cjs');

// Browser-control regression only: synthetic denial/error DOM, not a microphone/product result.
// No product traffic, account, model, credential or campaign cap change.
test('a delayed Retry setup settles before the separately counted Start',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});
 try{
  for(const succeeds of [true,false]){
   const context=await browser.newContext({serviceWorkers:'block'});let external=0;
   try{
    await context.route('**/*',route=>{
     if(new URL(route.request().url()).origin!=='http://127.0.0.1:47292'){external++;return route.abort();}
     return route.fulfill({contentType:'text/html',body:`<!doctype html>
      <html data-model-status="download-required" data-runtime-state="IDLE"><body>
      <button data-testid="mic-download">Download and start</button>
      <button data-testid="mic-retry" hidden>Retry setup</button>
      <button data-testid="mic-start" hidden>Start</button>
      <script>
       const root=document.documentElement,button=id=>document.querySelector('[data-testid="'+id+'"]');
       button('mic-download').onclick=()=>{
        root.dataset.modelStatus='error';root.dataset.runtimeState='TERMINATED';
        button('mic-download').hidden=true;button('mic-retry').hidden=false;
       };
       button('mic-retry').onclick=()=>{
        setTimeout(()=>{root.dataset.modelStatus='loading';button('mic-retry').hidden=true;},1000);
        setTimeout(()=>{
         root.dataset.modelStatus=${succeeds}?'ready':'error';
         button(${succeeds}?'mic-start':'mic-retry').hidden=false;
        },1500);
       };
       button('mic-start').onclick=()=>{
        root.dataset.runtimeState='RECORDING';button('mic-start').hidden=true;
        const stop=document.createElement('button');stop.dataset.testid='recorder-stop';document.body.append(stop);
       };
      </script></body></html>`});
    });
    const page=await context.newPage(),presses=[];
    ui.bindStartPressRecorder(page,async control=>{
     if(presses.length>=CONTRACTS['AHT-12'].startPresses)throw Object.assign(new Error('fixture press cap'),{code:'START_PRESS_CAP'});
     presses.push(control);
    });
    await page.goto('http://127.0.0.1:47292/');
    await ui.primary(page); // Initial failed Start is a fixture precondition, not a retry loop.
    assert.deepEqual(presses,['mic-download']);
    if(succeeds){
     await ui.start(page);
     assert.deepEqual(presses,['mic-download','mic-retry','mic-start']);
     assert.equal(await page.locator('html').getAttribute('data-runtime-state'),'RECORDING');
    }else{
     let settled=false;
     const pending=ui.primary(page).then(()=>{settled=true;return 'resolved';},()=>{settled=true;return 'rejected';});
     await page.waitForTimeout(2000);
     assert.equal(settled,false,'failed setup must not resolve or repeatedly press Retry');
     assert.deepEqual(presses,['mic-download','mic-retry']);
     await page.close();assert.equal(await pending,'rejected');
    }
    assert.equal(external,0);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
});

test('real 120-second Retry timeout reaches the actual adapter catch and page cleanup', {timeout:175000}, async()=>{
 const adapters=require('../source-adapters.cjs'),observer=require('../browser-observers.cjs'),readback=require('../browser-readback.cjs');
 const browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});
 const context=await browser.newContext({serviceWorkers:'block'}),changes=[],pages=[],writes=[],recorded=[],presses=[];
 let external=0,retryAt=null;
 const patch=(object,key,value)=>{changes.push([object,key,object[key]]);object[key]=value;};
 const origin='http://127.0.0.1:47292';
 try{
  await context.route('**/*',route=>{
   if(new URL(route.request().url()).origin!==origin){external++;return route.abort();}
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html data-model-status="download-required" data-runtime-state="IDLE"><body>
    <button data-testid="mic-download">Download and start</button><button data-testid="mic-retry" hidden>Retry setup</button>
    <p id="denial" hidden>Microphone access is blocked. Allow microphone access and try again.</p>
    <script>
     window.syntheticMic={acquisitions:0,log:[],liveTracks:0,recording:false,recorderVisible:false};
     document.querySelector('[data-testid="mic-download"]').onclick=()=>{
      window.syntheticMic={acquisitions:1,log:[{id:0,outcome:'NotAllowedError'}],liveTracks:0,recording:false,recorderVisible:false};
      document.documentElement.dataset.modelStatus='error';document.documentElement.dataset.runtimeState='TERMINATED';
      document.querySelector('[data-testid="mic-download"]').hidden=true;document.querySelector('[data-testid="mic-retry"]').hidden=false;document.querySelector('#denial').hidden=false;
     };
     document.querySelector('[data-testid="mic-retry"]').onclick=()=>{};
    </script></body></html>`});
  });
  context.on('page',p=>pages.push(p));
  // Only external product/auth/readback inputs are synthetic. The real adapter,
  // browser wait, wall clock, catch/finally and owned-page close run unchanged.
  patch(ui,'login',async()=>true);
  patch(ui,'openMic',async page=>page.goto(origin));
  patch(observer,'install',async()=>{});
  patch(observer,'mic',async page=>page.evaluate(()=>window.syntheticMic||{acquisitions:0,log:[],liveTracks:0,recording:false,recorderVisible:false}));
  patch(readback,'sessions',async()=>[]);
  const c={caseId:'AHT-12',campaignId:'UNIT-RETRY-TIMEOUT',sourceSha:adapters.SOURCE_SHA,servedSha:adapters.SOURCE_SHA,targetUrl:'https://unit.invalid',requiredAssertions:CONTRACTS['AHT-12'].rows,
   account:{id:'11111111-1111-4111-8111-111111111111',mode:'existing-disposable',preprovisionReceipt:'unit/pre.json',analyticsExclusionReceipt:'unit/analytics.json',dispositionReceipt:'unit/disposition.json',effectiveFeatureAccessApproved:true},
   readback:{origin:'https://unit.invalid',projectRef:'unit',anonKey:'synthetic-public',schemaSha256:'a'.repeat(64),ownerReadApproved:true,rlsReadQualificationReceipt:'unit/rls.json'},
   observerSourceReviewed:true,observerQualificationReceipt:'unit/observer.json',takeCap:1,startPressCap:3,
   fixture:{name:'unit',sha256:'b'.repeat(64),launchSha256:'b'.repeat(64),speechDurationMs:7000},oracleBindings:{},permissionQualification:{denialThenGrantSameContext:true,receipt:'unit/synthetic-only-not-permission-proof.json'}};
  const result=await adapters.run('AHT-12',{context,guard:{summary:()=>({ledgerUsed:{model:0}})},caseConfig:c,capabilities:{credentials:{email:'synthetic@example.invalid',password:'synthetic-only'},oracles:{},
   recordStartPress:async({control})=>{assert(presses.length<3);presses.push(control);if(control==='mic-retry')retryAt=Date.now();},
   writeEvidence:async(name,value)=>{writes.push(value);return name;},recordAssertion:async row=>recorded.push(row)}});
  assert(retryAt!==null,'the actual adapter must reach recovery Retry');
  const elapsed=Date.now()-retryAt;
  assert(elapsed>=119000&&elapsed<145000,'real readiness deadline, not page-close cancellation or fake time');
  assert.deepEqual(presses,['mic-download','mic-retry'],'no third Start or repeated Retry');
  assert.equal(recorded.find(r=>r.id==='press-bound-denial')?.result,'PASS');
  assert.equal(recorded.find(r=>r.id==='allowed-recovery-saved')?.result,'FAIL');
  assert.equal(recorded.find(r=>r.id==='review-reopen')?.result,'NOT RUN');
  assert.equal(recorded.find(r=>r.id==='owned-pages-closed')?.result,'PASS');
  const interruption=writes.find(w=>w.kind==='interruption-diagnostic');
  assert.equal(interruption?.stage,'retry-setup-wait');assert.equal(interruption?.error?.kind,'timeout');
  assert.equal(interruption?.error?.timeoutMs,120000);
  assert(pages.length===1&&pages.every(p=>p.isClosed()));assert.equal(external,0);
  assert.equal(result.blocker,'browser-or-oracle-step-interrupted');
  console.log(JSON.stringify({kind:'synthetic-retry-timeout-control',browserVersion:browser.version(),retryWaitMs:elapsed,presses:presses.length,ownedPagesClosed:pages.every(p=>p.isClosed()),externalRequests:external,liveCaseCredit:false}));
 }finally{
  for(const [object,key,value]of changes.reverse())object[key]=value;
  await context.close();await browser.close();
 }
});
