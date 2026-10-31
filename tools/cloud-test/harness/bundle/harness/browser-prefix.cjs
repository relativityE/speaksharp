'use strict';
// Content-free browser receipt for one exact armed GET. Proxy writes are not
// browser reads. No response body, URL query, headers or transcript is journaled.
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const refused=()=>new Error('HARNESS_LIMITED: browser-prefix-receipt-not-established');

class BrowserPrefix extends EventEmitter {
 constructor({journal=()=>{},now=()=>Date.now()}={}){super();this.journal=journal;this.now=now;this.seq=0;this.sessionSerial=0;this.arms=new Map();this.requests=new Map();this.closed=false;this.invalid=false;}
 note(kind,fields={}){const seq=++this.seq;if(seq>4096){this.invalid=true;throw refused();}this.journal({kind,...fields,prefixSeq:seq});return seq;}
 fail(){this.invalid=true;this.emit('change');}
 arm(fault){
  if(this.closed||this.invalid||this.arms.size>=2||this.arms.has(fault.id))throw refused();
  const a={id:fault.id,url:fault.url||`https://${fault.host}${fault.pathname}`,phase:'armed',keys:new Set(),armedAt:this.now()};
  a.armedSeq=this.note('browser-prefix-armed',{faultId:a.id,assetSha256:digest(a.url)});this.arms.set(a.id,a);
 }
 event(session,method,p){
  if(this.closed||this.invalid)return;
  if(method==='Network.requestWillBeSent'){
   for(const a of this.arms.values()){
    if(p.request?.url!==a.url||p.request.method!=='GET'||a.phase!=='armed')continue;
    const key=session+':'+p.requestId;
    if(this.requests.has(key)||p.redirectResponse||typeof p.timestamp!=='number'||!Number.isFinite(p.timestamp)||this.requests.size>=256){this.fail();return;}
    const r={key,arm:a,requestSha256:digest(key),start:p.timestamp,bytes:0,encoded:0,status:0};
    r.startSeq=this.note('browser-prefix-request',{faultId:a.id,requestSha256:r.requestSha256});
    this.requests.set(key,r);a.keys.add(key);this.emit('change');
   }
   return;
  }
  const r=this.requests.get(session+':'+p.requestId);
  if(!r||r.arm.phase!=='armed')return;
  if(method==='Network.responseReceived'){
   if(p.response?.url!==r.arm.url||p.response.fromDiskCache||p.response.fromServiceWorker||p.response.fromPrefetchCache){this.fail();return;}
   r.status=p.response.status;
  }else if(method==='Network.requestServedFromCache'){this.fail();return;}
  else if(method==='Network.dataReceived'){
   if(!Number.isFinite(p.timestamp)||p.timestamp<r.start||!Number.isSafeInteger(p.dataLength)||p.dataLength<=0||!Number.isSafeInteger(p.encodedDataLength)||p.encodedDataLength<0)return;
   r.bytes+=p.dataLength;r.encoded+=p.encodedDataLength;
   if(!Number.isSafeInteger(r.bytes)||!Number.isSafeInteger(r.encoded)){this.fail();return;}
   r.dataSeq=this.note('browser-prefix-received',{faultId:r.arm.id,requestSha256:r.requestSha256,bytes:r.bytes,encodedBytes:r.encoded});this.emit('change');
  }else if(method==='Network.loadingFailed'){r.failed=true;this.emit('change');}
 }
 async bind(id,{timeoutMs=3000}={}){
  const a=this.arms.get(id);if(!a||a.phase!=='armed')throw refused();
  await this.wait(()=>a.keys.size===1,{timeoutMs});
  if(a.keys.size!==1||this.invalid)throw refused();
  return Object.freeze({id,key:[...a.keys][0],armedSeq:a.armedSeq});
 }
 async received(binding,{timeoutMs=3000}={}){
  const a=this.arms.get(binding.id),r=this.requests.get(binding.key);
  if(!a||!r||a.armedSeq!==binding.armedSeq||r.arm!==a)throw refused();
  await this.wait(()=>r.failed||r.status>=200&&r.status<300&&r.bytes>0&&r.encoded>0,{timeoutMs});
  if(r.failed||a.keys.size!==1||!a.keys.has(binding.key)||a.phase!=='armed'||this.invalid)throw refused();
  return this.beforeOffline(binding);
 }
 beforeOffline(binding){
  const a=this.arms.get(binding.id),r=this.requests.get(binding.key);
  if(this.closed||this.invalid||!a||!r||a.armedSeq!==binding.armedSeq||r.arm!==a||a.phase!=='armed'||a.keys.size!==1||r.failed||!(r.status>=200&&r.status<300&&r.bytes>0&&r.encoded>0&&r.dataSeq>r.startSeq&&r.startSeq>a.armedSeq))throw refused();
  a.phase='offline';
  const offlineSeq=this.note('browser-offline-invoking',{faultId:a.id,requestSha256:r.requestSha256});
  return Object.freeze({observed:true,requestCorrelated:true,beforeOffline:r.dataSeq<offlineSeq,bytes:r.bytes,encodedBytes:r.encoded,requestSha256:r.requestSha256,armedSeq:a.armedSeq,requestSeq:r.startSeq,receivedSeq:r.dataSeq,offlineSeq});
 }
 wait(predicate,{timeoutMs}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)return Promise.reject(refused());
  return new Promise((resolve,reject)=>{
   let timer;const done=error=>{clearTimeout(timer);this.off('change',check);error?reject(error):resolve();};
   const check=()=>{if(this.closed||this.invalid)done(refused());else if(predicate())done();};
   this.on('change',check);timer=setTimeout(()=>done(refused()),timeoutMs);check();
  });
 }
 close(){this.closed=true;this.emit('change');this.removeAllListeners();this.requests.clear();this.arms.clear();}
}

// A page CDP session sees the document's requests. Auto-attach pauses related
// worker targets until Network is enabled there too, so their initial request
// cannot outrun observation. Non-flat child sessions use the public Target API.
class ChildSession extends EventEmitter {
 constructor(parent,sessionId){super();this.parent=parent;this.sessionId=sessionId;this.counter=0;this.pending=new Map();}
 send(method,params={}){return new Promise((resolve,reject)=>{
  const id=++this.counter,timer=setTimeout(()=>{this.pending.delete(id);reject(refused());},3000);
  this.pending.set(id,{resolve,reject,timer});
  this.parent.send('Target.sendMessageToTarget',{sessionId:this.sessionId,message:JSON.stringify({id,method,params})}).catch(()=>{const p=this.pending.get(id);if(p){clearTimeout(p.timer);this.pending.delete(id);reject(refused());}});
 });}
 receive(raw){let m;try{m=JSON.parse(raw);}catch{this.emit('invalid');return;}if(m.id){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(refused()):p.resolve(m.result);}}else if(m.method)this.emit(m.method,m.params||{});}
 dispose(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(refused());}this.pending.clear();this.removeAllListeners();}
}

async function attachPage(context,page,tracker){
 const root=await context.newCDPSession(page),sessions=[];
 async function enable(session,label){
  const children=new Map();sessions.push(session);
  for(const method of ['requestWillBeSent','responseReceived','dataReceived','loadingFailed','requestServedFromCache'])session.on('Network.'+method,p=>{try{tracker.event(label,'Network.'+method,p);}catch{tracker.fail();}});
  session.on('Target.receivedMessageFromTarget',p=>children.get(p.sessionId)?.receive(p.message));
  session.on('Target.detachedFromTarget',p=>{children.get(p.sessionId)?.dispose();children.delete(p.sessionId);});
  session.on('Target.attachedToTarget',p=>{
   const child=new ChildSession(session,p.sessionId);children.set(p.sessionId,child);child.on('invalid',()=>tracker.fail());
   void enable(child,label+'/'+(++tracker.sessionSerial)).catch(()=>tracker.fail()).finally(()=>child.send('Runtime.runIfWaitingForDebugger').catch(()=>tracker.fail()));
  });
  await session.send('Network.enable');
  await session.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:false});
 }
 try{await enable(root,'page-'+(++tracker.sessionSerial));}catch{tracker.fail();await root.detach().catch(()=>{});throw refused();}
 const dispose=()=>{for(const s of sessions)if(s instanceof ChildSession)s.dispose();void root.detach().catch(()=>{});};
 page.once('close',dispose);return dispose;
}

module.exports={BrowserPrefix,attachPage};
