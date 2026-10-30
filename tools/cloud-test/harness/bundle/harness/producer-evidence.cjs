'use strict';
// Receiving boundary for an EXISTING independently authenticated producer. No API calls, new
// accounts, credentials or signer infrastructure are supplied here. The receiver is trusted
// reviewed Node code, not a sandbox. Its external authenticated-source verification is a genuine
// runtime capability, never established by caseConfig booleans or these pure contract tests.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {verifyReviewedStep}=require('./reviewed-step.cjs');
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const loaded=new WeakSet();
const roles=Object.freeze({'coaching-authority':['sessionIds'],'feedback-received':['journeyId','bootId'],'feedback-association':['idempotencyKey']});
const requiredScope='existing-authenticated-producer-receiving-capability';
function fail(s){throw new Error('NOT_RUN: '+s);}
function validateProducerBinding(name,b){
 if(!roles[name]||!b||b.scope!==requiredScope||typeof b.producerIdentity!=='string'||!b.producerIdentity.trim()||!SHA.test(b.producerCodeSha256||'')||!SHA.test(b.receiverSourceSha256||'')||typeof b.reviewReference!=='string'||!b.reviewReference.trim())fail('existing producer identity/source/review unbound');
 if(!Array.isArray(b.allowedObservationInputs)||JSON.stringify([...b.allowedObservationInputs].sort())!==JSON.stringify(['startedAt',...roles[name]].sort()))fail('producer allowed observation inputs must match exact role');
 if(!['authenticated-connector-artifact','reviewed-authenticated-workflow-artifact'].includes(b.deliveryKind))fail('producer authenticated delivery kind unbound');
 return b;
}
function buildProducerRequest(name,b,c,observation,{notBefore,now=Date.now()}={}){
 validateProducerBinding(name,b);if(!observation||Object.keys(observation).some(k=>!b.allowedObservationInputs.includes(k)))fail('unexpected producer observation input');
 if(!c||!c.campaignId||!/^AHT-\d{2}$/.test(c.caseId||'')||!/^[a-f0-9]{40}$/.test(c.sourceSha||'')||c.servedSha!==c.sourceSha||!UUID.test(c.account?.id||''))fail('producer campaign/case/source/owner binding missing');
 const start=Date.parse(observation.startedAt),bound=Date.parse(notBefore);if(!Number.isFinite(start)||!Number.isFinite(bound)||start<bound||start>now)fail('producer observation window stale/future');
 const request={version:1,artifactRole:name,producerIdentity:b.producerIdentity,producerCodeSha256:b.producerCodeSha256,campaignId:c.campaignId,caseId:c.caseId,sourceSha:c.sourceSha,servedSha:c.servedSha,ownerAccountId:c.account.id,startedAt:new Date(start).toISOString(),requestedAt:new Date(now).toISOString(),requestNonce:crypto.randomBytes(16).toString('hex')};
 if(name==='coaching-authority'){if(!Array.isArray(observation.sessionIds)||observation.sessionIds.length!==1||new Set(observation.sessionIds).size!==1||observation.sessionIds.some(id=>!UUID.test(id)))fail('producer requires exactly one actual current session identity');request.sessionIds=[...observation.sessionIds];}
 else if(name==='feedback-association'){if(!UUID.test(observation.idempotencyKey||''))fail('producer actual feedback idempotency key missing');request.idempotencyKey=observation.idempotencyKey;}
 else{for(const key of ['journeyId','bootId'])if(typeof observation[key]!=='string'||!observation[key].trim()||observation[key].length>200)fail('producer observed telemetry identity missing');request.journeyId=observation.journeyId;request.bootId=observation.bootId;}
 return Object.freeze({...request,...(request.sessionIds?{sessionIds:Object.freeze(request.sessionIds)}:{})});
}
function validateProducerDelivery(delivery,request,b,{now=Date.now()}={}){
 const bytes=delivery?.artifactBytes;if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>2*1024*1024)fail('producer artifact byte size/type invalid');
 const p=delivery.provenance;const requestSha256=digest(JSON.stringify(request)),actualSha256=digest(bytes);
 if(!p||p.verificationStatus!=='VERIFIED_BY_REVIEWED_RECEIVER'||p.deliveryKind!==b.deliveryKind||p.producerIdentity!==b.producerIdentity||p.producerCodeSha256!==b.producerCodeSha256||p.requestSha256!==requestSha256||p.artifactSha256!==actualSha256)fail('authenticated producer provenance/request/artifact binding mismatch');
 for(const key of ['artifactRole','campaignId','caseId','sourceSha','servedSha'])if(p[key]!==request[key])fail('producer returned different '+key);
 if(typeof p.sourceReference!=='string'||!p.sourceReference.trim()||typeof p.verifierReference!=='string'||!p.verifierReference.trim()||p.rawServerRead!==true||p.mocked===true||p.clientEcho===true)fail('producer authentication/server read unverified');
 const produced=Date.parse(p.producedAt),received=Date.parse(p.receivedAt);if(!Number.isFinite(produced)||!Number.isFinite(received)||produced<Date.parse(request.requestedAt)||received<produced||received<Date.parse(request.requestedAt)||received>now)fail('producer observation/receipt ordering invalid');
 let content;try{content=JSON.parse(bytes.toString('utf8'));}catch{fail('producer artifact JSON invalid');}
 assertNoCredentialMaterial(content);assertNoCredentialMaterial(p);for(const key of ['sourceReference','verifierReference']){if(p[key].length>2048)fail('producer reference too long');if(/^[a-z][a-z0-9+.-]*:\/\//i.test(p[key])){let u;try{u=new URL(p[key]);}catch{fail('producer reference invalid');}if(u.username||u.password||u.search||u.hash)fail('producer reference must not contain authentication/query material');}}
 return {content,provenance:{verified:true,sourceSha:p.sourceSha,servedSha:p.servedSha,campaignId:p.campaignId,caseId:p.caseId,producedAt:p.producedAt,artifactSha256:actualSha256,requestSha256,sourceReference:p.sourceReference,verifierReference:p.verifierReference,bindingName:request.artifactRole,verificationScope:request.artifactRole,producerIdentity:p.producerIdentity,producerCodeSha256:p.producerCodeSha256,verificationBoundary:'Authenticated delivery verified by exact-source reviewed receiver; this validator does not itself authenticate an external service'}};
}
function loadReviewedProducerReceiver(options){
 const {receiverFile,...review}=options;const checked=verifyReviewedStep({...review,stepFile:receiverFile});const absolute=path.resolve(receiverFile);if(path.extname(absolute)!=='.cjs')fail('producer receiver must be explicit CJS');
 const manifest=JSON.parse(fs.readFileSync(review.manifestFile,'utf8')),entry=manifest.steps.find(x=>x.path===checked.stepPath);for(const file of [entry,...entry.dependencies])if(require.cache[path.resolve(review.stepRoot,file.path)])fail('producer receiver/dependency already cached; fresh supervised process required');
 verifyReviewedStep({...review,stepFile:receiverFile});const mod=require(absolute);
 if(mod.contract?.scope!==requiredScope||typeof mod.receiveArtifact!=='function')fail('reviewed producer receiver contract missing');
 const result=Object.freeze({sha256:checked.stepSha256,receive:mod.receiveArtifact});loaded.add(result);return result;
}
function assertNoCredentialMaterial(value){
 const visit=v=>{if(typeof v==='string'&&(/\bBearer\s+\S+/i.test(v)||/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(v)||/\b(?:sb_secret_|sk_live_|sk_test_)[A-Za-z0-9_-]+/.test(v)))fail('credential-shaped producer content forbidden');if(v&&typeof v==='object'){for(const [key,x]of Object.entries(v)){if(/^(?:authorization|proxy-authorization|headers|password|passwd|secret|cookie|set-cookie|apikey|api_key|access_token|refresh_token|id_token|login_response)$/i.test(key))fail('credential/header/login producer field forbidden');visit(x);}}};visit(value);
}
function persistPrivateDelivery(directory,request,delivery,result){
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('private producer evidence directory unbound');
 const dir=path.resolve(directory),parent=path.dirname(dir),ps=fs.lstatSync(parent);if(!ps.isDirectory()||ps.isSymbolicLink()||(ps.mode&0o777)!==0o700||ps.uid!==process.getuid()||fs.realpathSync(parent)!==parent)fail('producer evidence parent must be current-owned canonical private directory');
 try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const ds=fs.lstatSync(dir);if(!ds.isDirectory()||ds.isSymbolicLink()||(ds.mode&0o777)!==0o700||ds.uid!==process.getuid()||fs.realpathSync(dir)!==dir)fail('producer evidence directory is not private/current-owned');const artifact=path.join(dir,request.requestNonce+'.summary.json'),receipt=path.join(dir,request.requestNonce+'.receipt.json');
 // A refused replay must never unlink the first attempt's immutable receipt.
 const created=[];
 const put=(file,bytes)=>{const fd=fs.openSync(file,'wx',0o600);created.push(file);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const p=delivery.provenance,retained=Object.fromEntries(['verificationStatus','deliveryKind','producerIdentity','producerCodeSha256','requestSha256','artifactSha256','artifactRole','campaignId','caseId','sourceSha','servedSha','sourceReference','verifierReference','rawServerRead','producedAt','receivedAt'].map(k=>[k,p[k]]));
 const summaryBytes=Buffer.from(JSON.stringify({contentSafe:true,kind:'producer-content-free-summary',artifactRole:request.artifactRole,rawArtifactSha256:result.provenance.artifactSha256,rawArtifactRetained:false,jsonType:Array.isArray(result.content)?'array':typeof result.content,rowCount:Array.isArray(result.content?.rows)?result.content.rows.length:null},null,2)+'\n');
 const safeRequest={artifactRole:request.artifactRole,campaignId:request.campaignId,caseId:request.caseId,sourceSha:request.sourceSha,servedSha:request.servedSha,ownerAccountSha256:digest(request.ownerAccountId),sessionSha256s:request.sessionIds?.map(digest)||null,idempotencySha256:request.idempotencyKey?digest(request.idempotencyKey):null,journeySha256:request.journeyId?digest(request.journeyId):null,bootSha256:request.bootId?digest(request.bootId):null,startedAt:request.startedAt,requestedAt:request.requestedAt,requestSha256:result.provenance.requestSha256};
 const receiptBytes=Buffer.from(JSON.stringify({kind:'private-authenticated-producer-delivery',request:safeRequest,provenance:retained,summaryFile:path.basename(artifact),summarySha256:digest(summaryBytes),rawArtifactSha256:result.provenance.artifactSha256,rawArtifactRetained:false},null,2)+'\n');
 try{put(artifact,summaryBytes);put(receipt,receiptBytes);const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch(e){for(const file of created)try{fs.unlinkSync(file);}catch{}throw e;}
 return {summaryFile:path.basename(artifact),summarySha256:digest(summaryBytes),receiptFile:path.basename(receipt),receiptSha256:digest(receiptBytes)};
}
function createProducerEvidenceReader({caseConfig,notBefore,receiver,writeEvidence,privateEvidenceDir,now=Date.now,signal}){
 if(!loaded.has(receiver))fail('actual reviewed producer receiving capability unavailable');
 return async function readPrivateEvidence(name,observation){
  const binding=validateProducerBinding(name,caseConfig.privateEvidenceProducers?.[name]);if(binding.receiverSourceSha256!==receiver.sha256)fail('producer receiver differs from frozen reviewed bytes');
  if(signal?.aborted)fail('producer request cancelled');const request=buildProducerRequest(name,binding,caseConfig,observation,{notBefore,now:now()});
  // The receiver must obey signal; outer supervisor deadline still owns all processes/work. No
  // implicit retry or alternate producer is attempted by this receiving boundary.
  const delivery=await receiver.receive(Object.freeze({request,requestSha256:digest(JSON.stringify(request)),signal}));if(signal?.aborted)fail('producer response arrived after cancellation');
  const result=validateProducerDelivery(delivery,request,binding,{now:now()});
  const retained=persistPrivateDelivery(privateEvidenceDir,request,delivery,result);
  result.provenance.privateSummaryFile=retained.summaryFile;result.provenance.privateSummarySha256=retained.summarySha256;result.provenance.rawArtifactRetained=false;result.provenance.privateReceiptFile=retained.receiptFile;result.provenance.privateReceiptSha256=retained.receiptSha256;
  if(typeof writeEvidence==='function')result.provenance.evidenceRef=await writeEvidence('producer-'+name+'-'+request.requestNonce+'.json',{contentSafe:true,kind:'verified-producer-receipt',artifactRole:name,artifactSha256:result.provenance.artifactSha256,requestSha256:result.provenance.requestSha256,producerCodeSha256:binding.producerCodeSha256,privateReceiptSha256:retained.receiptSha256,privateSummaryRef:'private-producer/'+retained.summaryFile,privateSummarySha256:retained.summarySha256,rawArtifactRetained:false,privateReceiptRef:'private-producer/'+retained.receiptFile,receivedAfterRequest:true});
  return result;
 };
}
module.exports={validateProducerBinding,buildProducerRequest,validateProducerDelivery,loadReviewedProducerReceiver,createProducerEvidenceReader};
