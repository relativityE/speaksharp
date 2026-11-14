'use strict';
// Browser-only primitives sourced from benchmark-utils.ts, productsMenu.ts and rwtJourney.ts at main70e.
// No Playwright import, request API, route, browser launch, filesystem, Node transport, or credentials in evidence.
const TIMEOUT = 30000;
const auth=require('./auth-controls.cjs');
const startRecorders=new WeakMap(),START_CONTROLS=new Set(['mic-start','mic-download','mic-retry','verdict-practice-again','focus-points-retry']);
function bindStartPressRecorder(page,record){if(typeof record!=='function'||startRecorders.has(page))throw Object.assign(new Error('Start recorder binding invalid'),{code:'NOT_RUN'});startRecorders.set(page,record);}
async function pressStart(page,control,options={timeout:15000}){if(!START_CONTROLS.has(control)||!startRecorders.has(page))throw Object.assign(new Error('Start action lacks approved counter'),{code:'NOT_RUN'});
  const loc=page.getByTestId(control),limit=Date.now()+(options.timeout||15000);let ready=typeof loc.first!=='function'||typeof page.waitForTimeout!=='function';
  while(!ready&&Date.now()<limit){try{if(await loc.first().isVisible()&&await loc.first().isEnabled()){ready=true;break;}}catch{/* page transitioning */}await page.waitForTimeout(100).catch(()=>{});}
  if(!ready)throw Object.assign(new Error('Start control '+control+' not visible and enabled before press'),{code:'START_CONTROL_NOT_READY'});
  await startRecorders.get(page)(control);await loc.click({timeout:5000});}
const pageStages=new WeakMap(),failedStages=new WeakMap(),pageTrails=new WeakMap();
// Ordered, closed navigation/sign-in breadcrumbs (Sam 1794154809 / 1794156291): event, route, response status class, allowlisted net error and
// ms since the page's first event. No URL, header, body, credential or free text. At most TRAIL_MAX entries per page (the newest are kept).
const TRAIL_EVENTS=new Set(['nav-start','nav-response','nav-error','auth-form-visible','sign-in-submit','sign-in-done','sign-in-error']);
// Compound identifiers so the closed evidence sanitizer keeps them (single words outside its enum list are blocked).
const TRAIL_ROUTES=new Set(['route-signin','route-practice','route-analytics','route-session','route-other']),TRAIL_MAX=24;
function trail(page,event,{route='route-other',status=null,error=null}={}){try{if(!page||typeof page!=='object'||!TRAIL_EVENTS.has(event))return;
  const t=pageTrails.get(page)||{t0:Date.now(),events:[]};pageTrails.set(page,t);
  const statusClass=Number.isInteger(status)&&status>=100&&status<=599?'status-'+Math.floor(status/100)+'xx':null;
  t.events.push({event,route:TRAIL_ROUTES.has(route)?route:'route-other',statusClass,netError:error?safeErrorSummary(error).netError:null,ms:Math.min(Math.max(Date.now()-t.t0,0),3600000)});
  if(t.events.length>TRAIL_MAX)t.events.splice(0,t.events.length-TRAIL_MAX);}catch{}}
function navigationTrail(page){const t=page&&typeof page==='object'?pageTrails.get(page):null;return t?t.events.map(e=>({...e})):[];}
// A navigation the egress guard refused (any response carrying x-ss-harness-deny on the main-frame document) is a harness/setup stop, never a
// product verdict: fail at once as NOT RUN with a closed blocker, instead of waiting 30 s for an element and reporting stage `idle`. Chromium may
// either resolve such a navigation with the guard's status or throw net::ERR_HTTP_RESPONSE_CODE_FAILURE; the header is captured in both cases.
// Sam 1794177810: both parts of the subtype are CLOSED enums (every other value becomes `other` before anything is kept), and the reason is
// code-owned: it is registered for the error object this module created, never read from arbitrary error properties.
const GUARD_DENY_WORDS=new Set(['policy','host','unknown-host','upstream-error','deadline','deadline-passed','closing','concurrency-wait','websocket',
  'plain-http','malformed','host-mismatch']);
const GUARD_CAPS=new Set(['total','navigations','case-allowance','case-takes','account-closure','auth','coaching','model','preflight','public','signed-in',
  'telemetry']);
function guardDenyCode(deny){const d=String(deny);if(GUARD_DENY_WORDS.has(d))return d;const m=/^cap:([a-z-]{1,24})$/.exec(d);return m&&GUARD_CAPS.has(m[1])?d:'other';}
const stopReasons=new WeakMap();
function guardRefused(deny,page){const e=new Error('navigation refused by the egress guard');e.code='NOT_RUN';const reason='guard-refused-navigation:'+guardDenyCode(deny);
  e.trustedBlocker=reason;stopReasons.set(e,reason);failedStages.set(e,{page,stage:'signin-navigate'});return e;}
function stopReason(error){return error&&typeof error==='object'?stopReasons.get(error)||null:null;}
async function trackedGoto(page,url,route,opts){trail(page,'nav-start',{route});let response,deny=null;
  const onResponse=r=>{try{if(r.request().isNavigationRequest()&&(typeof page.mainFrame!=='function'||r.frame()===page.mainFrame())){const d=r.headers()['x-ss-harness-deny'];if(d)deny=String(d);}}catch{/* closed page */}};
  const watch=typeof page.on==='function'&&typeof page.off==='function';if(watch)page.on('response',onResponse);
  try{response=await page.goto(url,opts);}catch(error){trail(page,'nav-error',{route,error});if(deny)throw guardRefused(deny,page);throw error;}
  finally{if(watch)page.off('response',onResponse);}
  let status=null;try{status=response?response.status():null;}catch{status=null;}trail(page,'nav-response',{route,status});
  if(!deny){try{deny=response?(await response.headerValue('x-ss-harness-deny')):null;}catch{deny=null;}}
  if(deny)throw guardRefused(deny,page);
  return response;}
const productsFailures=new WeakMap();
async function productsSnapshot(page){
 try{
  const raw=await page.locator('html').evaluate(()=>{
   const shown=el=>!!el&&el.getClientRects().length>0;
   const trigger=['nav-products-button','nav-mobile-products-button'].map(id=>document.querySelector('[data-testid="'+id+'"]')).find(shown);
   const box=trigger?.getBoundingClientRect(),x=box?box.left+box.width/2:-1,y=box?box.top+box.height/2:-1;
   const inViewport=!!box&&box.width>0&&box.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight;
   const hit=inViewport?document.elementFromPoint(x,y):null;
   return {triggerVisible:!!trigger,triggerEnabled:!!trigger&&!trigger.disabled&&trigger.getAttribute('aria-disabled')!=='true',inViewport,triggerIsHitTarget:!!trigger&&!!hit&&(trigger===hit||trigger.contains(hit)),pointerEventsEnabled:!!trigger&&getComputedStyle(trigger).pointerEvents!=='none',focusDialogVisible:shown(document.querySelector('[data-testid="objective-setup-dialog"]')),menuVisible:Array.from(document.querySelectorAll('[role="menu"]')).some(shown),focusIntent:new URL(location.href).searchParams.get('product')==='focus-points',onPractice:location.pathname==='/practice',onSession:location.pathname==='/session'};
  },undefined,{timeout:1000});
  const keys=['triggerVisible','triggerEnabled','inViewport','triggerIsHitTarget','pointerEventsEnabled','focusDialogVisible','menuVisible','focusIntent','onPractice','onSession'];
  return Object.fromEntries(keys.map(key=>[key,typeof raw?.[key]==='boolean'?raw[key]:null]));
 }catch{return null;}
}
function productsDiagnostic(error){return error&&typeof error==='object'?productsFailures.get(error)||null:null;}
const STAGES=new Set(['idle','signin-navigate','start-select','start-press','start-pressed','retry-setup-wait','start-recording-wait','products-trigger-wait','products-menu-wait','products-trigger-click','products-open-wait','products-item-click','stop-press','stop-clicked','stop-release-wait','save-wait','save-readback','save-complete','focus-dialog-wait','focus-dialog-focus-wait','focus-dialog-close','focus-dialog-hidden-wait','focus-intent-clear-wait']);
const setStage=(page,stage)=>{if(!STAGES.has(stage))throw new Error('Unknown diagnostic phase');pageStages.set(page,stage);};
function currentStage(page){return page&&pageStages.get(page)||'idle';}
async function atStage(page,stage,operation){setStage(page,stage);try{return await operation();}catch(error){if(error&&typeof error==='object'&&!failedStages.has(error))failedStages.set(error,{page,stage:currentStage(page)});throw error;}}
function failurePage(error,fallback){return error&&typeof error==='object'&&failedStages.get(error)?.page||fallback;}
function failureStage(error,fallback){return error&&typeof error==='object'&&failedStages.get(error)?.stage||currentStage(fallback);}
// Content-free, timestamped model/control-state trace: only data-model-status, data-runtime-state, which Start control is rendered, and whether it is enabled.
async function installControlTrace(page){try{await page.evaluate(()=>{if(window.__ssCtlTrace)return;const t0=Date.now(),buf=window.__ssCtlTrace=[];let last='';const ids=['mic-start','mic-download','mic-retry','verdict-practice-again','focus-points-retry'];const tick=()=>{const h=document.documentElement;let c='none',e=null;for(const id of ids){const el=document.querySelector('[data-testid="'+id+'"]');if(el&&el.getClientRects().length){c=id;e=!el.disabled;break;}}const row=[h.getAttribute('data-model-status')||'-',h.getAttribute('data-runtime-state')||'-',c,e];const k=row.join('|');if(k!==last&&buf.length<300){last=k;buf.push([Date.now()-t0,...row]);}};tick();setInterval(tick,200);});}catch{/* best effort */}}
const MODEL_STATES=new Set(['-','init-failed','loading','ready','idle','error','download-required']);
const TRACE_CONTROLS=new Set(['none','mic-start','mic-download','mic-retry','verdict-practice-again','focus-points-retry']);
// Trace rows carry only closed vocabulary: [ms since install, model state, runtime state token, rendered Start control, enabled].
async function controlTrace(page){try{const raw=await page.evaluate(()=>(window.__ssCtlTrace||[]).slice(-40));return (Array.isArray(raw)?raw:[]).map(r=>{const a=Array.isArray(r)?r:[];return [Number.isInteger(a[0])&&a[0]>=0?a[0]:0,MODEL_STATES.has(a[1])?a[1]:'other',typeof a[2]==='string'&&/^[A-Z_]{2,32}$/.test(a[2])?a[2]:(a[2]==='-'?'-':'other'),TRACE_CONTROLS.has(a[3])?a[3]:'other',a[4]===true?true:a[4]===false?false:null];});}catch{return null;}}
async function visible(page, id, timeout = TIMEOUT) { await page.getByTestId(id).first().waitFor({ state:'visible', timeout }); }
async function attr(page, name) { return page.locator('html').getAttribute(name, {timeout:10000}); }
async function login(page, c, credentials) {
  await trackedGoto(page, c.targetUrl + '/auth/signin', 'route-signin', {waitUntil:'domcontentloaded', timeout:45000});
  await visible(page,'auth-form');trail(page,'auth-form-visible',{route:'route-signin'});
  trail(page,'sign-in-submit',{route:'route-signin'});
  try{const out=await auth.submit(page,c,credentials);trail(page,'sign-in-done',{route:'route-signin'});return out;}
  catch(error){trail(page,'sign-in-error',{route:'route-signin',error});throw error;}
}
async function products(page,item) {
 return atStage(page,'products-trigger-wait',async()=>{
  let before=null;
  try{
  const desktop=page.getByTestId('nav-products-button'), mobile=page.getByTestId('nav-mobile-products-button');
  await desktop.or(mobile).filter({visible:true}).first().waitFor({state:'visible',timeout:20000});
  setStage(page,'products-menu-wait');
  await page.getByRole('menu').waitFor({state:'detached',timeout:20000});
  const isDesktop=await desktop.isVisible(); const trigger=isDesktop?desktop:mobile;
  setStage(page,'products-trigger-click');
  before=await productsSnapshot(page);
  await trigger.click({timeout:20000});
  setStage(page,'products-open-wait');
  await page.waitForFunction((id)=>document.querySelector('[data-testid="'+id+'"]')?.getAttribute('aria-expanded')==='true',isDesktop?'nav-products-button':'nav-mobile-products-button',{timeout:20000});
  setStage(page,'products-item-click');
  await page.getByTestId((isDesktop?'nav-products-':'nav-mobile-products-')+item).click({timeout:20000});
  }catch(error){if(error&&typeof error==='object')productsFailures.set(error,Object.freeze({before,after:await productsSnapshot(page)}));throw error;}
 });
}
async function privateMode(page) {
  const select=page.getByTestId('stt-mode-select');
  if (await select.count()) { await select.click({timeout:15000}); await page.getByTestId('stt-mode-private').click({timeout:15000}); }
  // The absent selector is valid for Private-only configuration; actual published mode must still match.
  await page.waitForFunction(()=>document.documentElement.getAttribute('data-stt-mode')==='private'||document.querySelector('[data-testid="stt-mode-select"]')?.getAttribute('data-state')==='private',undefined,{timeout:30000});
}
async function openMic(page,c) {
  await trackedGoto(page,c.targetUrl+'/practice','route-practice',{waitUntil:'domcontentloaded',timeout:45000});
  await products(page,'open-mic'); await page.waitForURL(/\/session(?:[?#]|$)/,{timeout:45000}); await privateMode(page);
}
async function primary(page) {
 return atStage(page,'start-select',async()=>{
  await installControlTrace(page);
  for(let attempt=1;;attempt++){
  const handle=await page.waitForFunction(()=>{
    const h=document.documentElement,s=h.getAttribute('data-model-status');
    if(h.getAttribute('data-runtime-state')==='RECORDING'&&document.querySelector('[data-testid="recorder-stop"]'))return '@recording';
    if(!['download-required','ready','idle','error','init-failed'].includes(s))return false;
    const id=s==='download-required'?'mic-download':['error','init-failed'].includes(s)?'mic-retry':'mic-start';
    const el=document.querySelector('[data-testid="'+id+'"]');return el&&!el.disabled&&el.getClientRects().length?id:false;
  },undefined,{timeout:120000});
  const id=await handle.jsonValue();await handle.dispose();if(id==='@recording'){setStage(page,'start-recording-wait');return;}
  setStage(page,'start-press');
  try{await pressStart(page,id,{timeout:15000});setStage(page,'start-pressed');
    // 'Retry Private setup' only re-runs setup (control becomes mic-start when READY); recording needs a separately counted Start.
    if(id==='mic-retry'){
      setStage(page,'retry-setup-wait');
      // Retry starts async setup, not recording. The old Retry can remain visible/enabled until
      // setup publishes its next state; selecting it again spends another press without new intent.
      // Wait for a recording-capable state instead. Failed setup times out; it is never auto-retried.
      await page.waitForFunction(()=>{
        const h=document.documentElement;
        return ['ready','download-required'].includes(h.getAttribute('data-model-status'))
          || h.getAttribute('data-runtime-state')==='RECORDING';
      },undefined,{timeout:120000});
      continue;
    }
    return;}
  catch(e){if(e&&e.code==='START_CONTROL_NOT_READY'&&attempt<4)continue;throw e;}
  }
 });
}
async function recording(page, timeout=180000) {
  return atStage(page,'start-recording-wait',()=>page.waitForFunction(()=>document.documentElement.getAttribute('data-runtime-state')==='RECORDING'&&!!document.querySelector('[data-testid="recorder-stop"]'),undefined,{timeout}));
}
async function start(page) { await primary(page); await recording(page); }
async function stop(page,onClicked) {
 return atStage(page,'stop-press',async()=>{
  await page.getByTestId('recorder-stop').click({timeout:15000});setStage(page,'stop-clicked');if(onClicked)onClicked();
  setStage(page,'stop-release-wait');
  await page.getByTestId('recorder-bar').waitFor({state:'detached',timeout:180000});
 });
}
async function saved(page, previous=null) {
 return atStage(page,'save-wait',async()=>{
  await page.waitForFunction((old)=>{const h=document.documentElement,id=h.getAttribute('data-session-persisted-id');return h.getAttribute('data-session-persisted')==='true'&&!!id&&id!==old;},previous,{timeout:180000});
  setStage(page,'save-readback');const id=await attr(page,'data-session-persisted-id');setStage(page,'save-complete');return id;
 });
}
async function speak(page,c) { await page.waitForTimeout(c.recordingWindowMs??c.fixture.speechDurationMs); }
async function take(page,c, previous=null) { await start(page); await speak(page,c); await stop(page); return saved(page,previous); }
async function repeat(page,c,previous,focus=false) {
  await pressStart(page,focus?'focus-points-retry':'verdict-practice-again',{timeout:30000});
  await recording(page); await speak(page,c); await stop(page); return saved(page,previous);
}
async function setupFocus(page,c,points=c.focus.points,beforeSubmit) {
  await visible(page,'objective-setup-dialog'); await page.getByTestId('objective-goal-select').selectOption('other');
  await page.getByTestId('objective-goal-input').fill(c.focus.topic);
  for(let i=0;i<points.length;i++){if(!(await page.getByTestId('objective-point-label-'+i).count()))await page.getByTestId('objective-add-point').click();await page.getByTestId('objective-point-label-'+i).fill(points[i]);}
  if(beforeSubmit)await beforeSubmit();
  await page.getByTestId('objective-setup-submit').click(); await page.waitForURL(/\/session(?:[?#]|$)/,{timeout:45000}); await privateMode(page);
}
async function closeFocus(page,{expected=false}={}) {
 return atStage(page,'focus-dialog-wait',async()=>{
  const dialog=page.getByTestId('objective-setup-dialog');
  if(!expected&&!await dialog.isVisible())return;
  // Selection returns before the lazy dialog necessarily mounts. A one-shot visibility read
  // skips dismissal and leaves its overlay intercepting the next Products click.
  await dialog.waitFor({state:'visible',timeout:15000});
  setStage(page,'focus-dialog-focus-wait');
  await page.waitForFunction(()=>document.querySelector('[data-testid="objective-setup-dialog"]')?.contains(document.activeElement),undefined,{timeout:15000});
  setStage(page,'focus-dialog-close');await page.keyboard.press('Escape');
  setStage(page,'focus-dialog-hidden-wait');await dialog.waitFor({state:'hidden',timeout:10000});
  setStage(page,'focus-intent-clear-wait');
  await page.waitForURL(url=>url.searchParams.get('product')!=='focus-points',{timeout:10000});
 });
}
async function reopen(page,c,id) {
  await trackedGoto(page,c.targetUrl+'/analytics','route-analytics',{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByTestId('open-session-detail-'+id).or(page.getByTestId('open-session-detail-mobile-'+id)).first().click({timeout:45000});
  await visible(page,'session-detail-transcript',45000);const before=await fingerprint(page,'session-detail-transcript');await page.reload({waitUntil:'domcontentloaded',timeout:45000});await visible(page,'session-detail-transcript',45000);return {before,after:await fingerprint(page,'session-detail-transcript')};
}
async function fingerprint(page,id){return page.getByTestId(id).evaluate(async el=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(el.innerText.trim())))).map(x=>x.toString(16).padStart(2,'0')).join(''));}
async function sessionCleared(page,c){const key='sb-'+c.readback.projectRef+'-auth-token';try{await page.waitForFunction(key=>{try{return !JSON.parse(localStorage.getItem(key)||'null')?.access_token;}catch{return false;}},key,{timeout:30000});return true;}catch{return false;}}
async function signout(page) {
  const direct=page.getByTestId('sign-out-button').or(page.getByTestId('nav-sign-out-button')).first();
  if(await direct.isVisible())await direct.click();else{await page.getByTestId('nav-account-avatar').click();await page.getByTestId('nav-sign-out-button').click();}
}
// Known product copy (exact strings from the app source). Matching happens INSIDE the page; only ids and counts leave it,
// never the page text, so private speech or account content can never be copied into evidence.
const KNOWN_UI_COPY=Object.freeze({
  'mic-blocked':'Microphone access is blocked. Allow microphone access and try again.',
  'cold-download-title':'Download & start recording',
  'cold-download-note':'One-time model download to this device',
  'retry-setup':'Retry Private setup',
  'setup-incomplete':'Setup didn’t finish',
  'start-recording':'Start recording',
  'lease-held':'A recording is active on'
});
async function uiCopyIds(page){try{return await page.evaluate(known=>{const found=new Set();let regions=0,unknown=0;for(const el of document.querySelectorAll('[role="alert"],[role="status"],[aria-live],[data-testid="mic-card"]')){if(!el.getClientRects().length)continue;regions++;const t=(el.innerText||'').replace(/\s+/g,' ').trim();let hit=false;for(const [id,str] of Object.entries(known)){if(t.includes(str)){found.add(id);hit=true;}}if(!hit&&t)unknown++;}return {visibleRegions:regions,unknownRegions:unknown,knownCopy:[...found].sort()};},KNOWN_UI_COPY);}catch{return null;}}
// Error text is reduced to a closed summary: API name, error class, a coarse kind, a timeout number, developer test ids and the exact Chromium net
// error from a closed allowlist (Sam 1794154809: run 42496837188's page.goto network-error kept no token). Free text never survives.
const NET_ERRORS=new Set(['ERR_HTTP_RESPONSE_CODE_FAILURE','ERR_CONNECTION_REFUSED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_CONNECTION_TIMED_OUT','ERR_TIMED_OUT','ERR_NAME_NOT_RESOLVED','ERR_INTERNET_DISCONNECTED','ERR_ADDRESS_UNREACHABLE','ERR_PROXY_CONNECTION_FAILED','ERR_TUNNEL_CONNECTION_FAILED','ERR_CERT_AUTHORITY_INVALID','ERR_CERT_COMMON_NAME_INVALID','ERR_CERT_DATE_INVALID','ERR_SSL_PROTOCOL_ERROR','ERR_ABORTED','ERR_FAILED','ERR_EMPTY_RESPONSE','ERR_BLOCKED_BY_CLIENT','ERR_TOO_MANY_REDIRECTS','ERR_NETWORK_CHANGED']);
function safeErrorSummary(error){try{const msg=String(error&&error.message||'');const name=['TimeoutError','Error','TypeError'].includes(error&&error.name)?error.name:'Error';
  const code=['NOT_RUN','AUTH_REJECTED','START_PRESS_CAP','START_CONTROL_NOT_READY','PRODUCT_FAIL','EVIDENCE_READER_UNAVAILABLE'].includes(error&&error.code)?error.code:null;
  const api=(/^([A-Za-z]+\.[A-Za-z]+):/.exec(msg)||[])[1]||null;const t=/Timeout (\d+)ms exceeded/.exec(msg);
  const kind=t?'timeout':/has been closed/.test(msg)?'target-closed':/not visible and enabled/.test(msg)?'control-not-ready':/strict mode violation/.test(msg)?'strict-mode':/net::ERR_/.test(msg)?'network-error':'other';
  const ids=[];for(const m of msg.matchAll(/getByTestId\('([a-z][a-z0-9-]{1,40})'\)/g)){const id=m[1];if(!/\d{6,}/.test(id)&&!ids.includes(id)&&ids.length<5)ids.push(id);}
  const nm=/net::(ERR_[A-Z_]{1,48})/.exec(msg);const netError=nm?(NET_ERRORS.has(nm[1])?nm[1]:'other'):null;
  return {name,code,api:api&&/^[A-Za-z]{2,24}\.[A-Za-z]{2,24}$/.test(api)?api:null,kind,timeoutMs:t?Math.min(Number(t[1]),3600000):null,testIds:ids,netError};}catch{return {name:'Error',code:null,api:null,kind:'other',timeoutMs:null,testIds:[],netError:null};}}
module.exports={stopReason,guardDenyCode,NET_ERRORS,TRAIL_EVENTS,TRAIL_ROUTES,navigationTrail,trackedGoto,productsSnapshot,productsDiagnostic,KNOWN_UI_COPY,uiCopyIds,safeErrorSummary,currentStage,failurePage,failureStage,controlTrace,installControlTrace,bindStartPressRecorder,pressStart,submitLogin:auth.submit,visible,attr,login,products,privateMode,openMic,primary,recording,start,stop,saved,speak,take,repeat,setupFocus,closeFocus,reopen,fingerprint,sessionCleared,signout};
