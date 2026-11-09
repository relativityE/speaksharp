'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ui=require('../browser-actions.cjs');

// Real browser DOM, timers, focus, keyboard and navigation; no product account or product traffic.
// Run explicitly with node --test; .e2e keeps it out of the offline *.test.cjs suite.
test('Products return waits for delayed Focus mount, focus, dismissal and cleared intent',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});
 let closed=false;
 try{
  for(const delay of [1000,0]){
   const context=await browser.newContext({serviceWorkers:'block'});let forbiddenRequests=0;
   try{
    await context.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.origin!=='http://127.0.0.1:47291'){forbiddenRequests++;return route.abort();}
     return route.fulfill({contentType:'text/html',body:`<!doctype html><button id="products" data-testid="nav-products-button" aria-expanded="false">Products</button>
      <script>
       window.fixture={mounted:false,focused:false,escaped:false,queryCleared:false};
       window.mountFocus=()=>{
        const dialog=document.createElement('div');dialog.dataset.testid='objective-setup-dialog';
        dialog.tabIndex=-1;dialog.style.cssText='position:fixed;inset:0;z-index:50;background:white';
        document.body.append(dialog);window.fixture.mounted=true;
        setTimeout(()=>{dialog.focus();window.fixture.focused=true;},50);
        dialog.addEventListener('keydown',event=>{
         if(event.key!=='Escape')return;
         window.fixture.escaped=true;dialog.style.display='none';
         setTimeout(()=>{history.replaceState(null,'','/practice');window.fixture.queryCleared=true;},80);
        });
       };
       document.querySelector('#products').onclick=()=>{
        document.querySelector('#products').setAttribute('aria-expanded','true');
        const menu=document.createElement('div');menu.setAttribute('role','menu');
        for(const item of ['focus-points','open-mic']){
         const button=document.createElement('button');button.dataset.testid='nav-products-'+item;button.textContent=item;
         button.onclick=()=>{menu.remove();document.querySelector('#products').setAttribute('aria-expanded','false');
          if(item==='focus-points'){history.replaceState(null,'','/practice?product=focus-points');setTimeout(window.mountFocus,${delay});}
          else history.replaceState(null,'','/session');
         };menu.append(button);
        }document.body.append(menu);
       };
      </script>`});
    });
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:47291/practice');
    // Preserve optional-close callers; AHT04 explicitly expects the dialog after selecting Focus.
    await ui.closeFocus(page);
    await ui.products(page,'focus-points');
    await ui.closeFocus(page,{expected:true});
    assert.deepEqual(await page.evaluate(()=>window.fixture),{mounted:true,focused:true,escaped:true,queryCleared:true});
    assert.equal(new URL(page.url()).searchParams.has('product'),false);
    // The dialog remains mounted but hidden, just as a controlled dialog may during exit.
    assert.equal(await page.getByTestId('objective-setup-dialog').isVisible(),false);
    const ready=await ui.productsSnapshot(page);
    assert.equal(ready.triggerEnabled,true);assert.equal(ready.inViewport,true);assert.equal(ready.triggerIsHitTarget,true);
    assert.equal(ready.focusDialogVisible,false);assert.equal(ready.focusIntent,false);
    // A rendered/enabled trigger can still be covered. Instrumentation must
    // distinguish that case without increasing the real click's 20-second wait.
    await page.evaluate(()=>{const cover=document.createElement('div');cover.id='synthetic-hit-cover';cover.style.cssText='position:fixed;inset:0;z-index:100';document.body.append(cover);});
    const covered=await ui.productsSnapshot(page);assert.equal(covered.triggerEnabled,true);assert.equal(covered.triggerIsHitTarget,false);
    await page.evaluate(()=>document.querySelector('#synthetic-hit-cover').remove());
    await ui.products(page,'open-mic');
    assert.equal(new URL(page.url()).pathname,'/session');
    assert.equal(forbiddenRequests,0);
   }finally{await context.close();}
  }
 }finally{await browser.close();closed=true;}
 assert.equal(closed,true);
});
