'use strict';
// Own pending resources until setup succeeds. Abort never abandons a late-resolving browser.
function aborted(){const e=new Error('guarded launch cancelled');e.name='AbortError';e.code='ABORT_ERR';return e;}
function bounded(promise,ms,label){let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' cleanup timeout')),ms);})]).finally(()=>clearTimeout(timer));}
function abortableContext(promise,signal){if(!signal)return promise;return new Promise((resolve,reject)=>{const abort=()=>reject(aborted());if(signal.aborted){Promise.resolve(promise).catch(()=>{});return abort();}signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
async function ownedLaunch({signal,prepareMedia,createGuard,createBrowser,createContext,cleanupTimeoutMs=3000}){
 let media=null,guard=null,browser=null,cancelled=signal?.aborted===true,mediaCleaned=false,guardClose=null;const errors=[];
 const cleanupMedia=()=>{if(media&&!mediaCleaned){mediaCleaned=true;try{media.cleanup();}catch(x){errors.push(x.message);}}};
 const closeGuard=()=>{if(!guard)return Promise.resolve();if(!guardClose)guardClose=bounded(Promise.resolve().then(()=>guard.close(cancelled?'launch-aborted':'launch-failed')),cleanupTimeoutMs,'guard').catch(x=>{errors.push(x.message);});return guardClose;};
 // Media is removed synchronously at abort, before the outer supervisor's 5s kill grace.
 // Unlinking an already-open fake-media file is safe; the owned browser is separately cancelled/killed.
 const cancel=()=>{cancelled=true;try{guard?.cancelAll('launch-aborted');}catch(x){errors.push(x.message);}cleanupMedia();void closeGuard();};
 const checkpoint=()=>{if(cancelled||signal?.aborted)throw aborted();};
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  checkpoint();media=prepareMedia();checkpoint();
  guard=await createGuard(media);checkpoint();
  browser=await createBrowser(guard,media);checkpoint();
  const context=await abortableContext(createContext(browser,guard),signal);checkpoint();
  return {media,guard,browser,context};
 }catch(e){
  try{guard?.cancelAll(cancelled?'launch-aborted':'launch-failed');}catch(x){errors.push(x.message);}
  const g=closeGuard();
  try{if(browser)await bounded(Promise.resolve().then(()=>browser.close()),cleanupTimeoutMs,'browser');}catch(x){errors.push(x.message);}
  await g;cleanupMedia();if(errors.length)e.cleanupErrors=errors;throw e;
 }finally{signal?.removeEventListener('abort',cancel);}
}
module.exports={ownedLaunch};
