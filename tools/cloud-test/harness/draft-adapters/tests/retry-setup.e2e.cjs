'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ui=require('../browser-actions.cjs');
const {CONTRACTS}=require('../source-adapters.cjs');

// Browser-control regression only: synthetic denial/error DOM, not a microphone/product result.
// No product traffic, account, model, credential or campaign cap change.
test('a delayed Retry setup settles before the separately counted Start',async()=>{
 const browser=await chromium.launch({headless:true,timeout:15000});
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
