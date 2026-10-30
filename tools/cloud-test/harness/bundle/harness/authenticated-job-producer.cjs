'use strict';
// Privileged half of the existing GitHub-job route. Never pass this environment to a driver.
// Only closed, current-case queries are available; raw rows and reader output remain in memory.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const p=require('./existing-runner-projection.cjs');
const SHA=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROLES=Object.freeze({'AHT-01':['coaching-authority'],'AHT-02':['coaching-authority'],'AHT-03':['coaching-authority'],'AHT-07':['coaching-authority','feedback-association','feedback-received'],'AHT-08':['feedback-association','feedback-received']});
const fail=code=>{throw Object.assign(new Error('NOT_RUN: '+code),{code});};
const producerSha=()=>p.sha(fs.readFileSync(__filename));
function descriptor(reviewReference,env=process.env){
 const job=jobIdentity(env),relative='draft-adapters/receivers/github-job-evidence-reader.cjs';
 if(typeof reviewReference!=='string'||!reviewReference.trim())fail('INDEPENDENT_PRODUCER_REVIEW_REQUIRED');
 return {kind:'same-github-job-receiver-selection-not-execution-proof',producerIdentity:job.identity,jobId:job.jobId,producerCodeSha256:producerSha(),receiverRelativePath:relative,receiverSourceSha256:p.sha(fs.readFileSync(path.resolve(__dirname,'../..',relative))),workflowSourceSha:job.producerSourceSha,reviewReference};
}
function jobIdentity(env){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='relativityE/speaksharp'||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||'')||!/^[A-Za-z0-9_-]{1,100}$/.test(env.GITHUB_JOB||'')||!SHA.test(env.GITHUB_SHA||''))fail('AUTHENTICATED_JOB_UNAVAILABLE');
 return {identity:`github-actions:relativityE/speaksharp:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}:${env.GITHUB_JOB}`,jobId:env.GITHUB_JOB,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,reference:`https://github.com/relativityE/speaksharp/actions/runs/${env.GITHUB_RUN_ID}`,producerSourceSha:env.GITHUB_SHA};
}
function assertJobReceipt(receipt,job){
 if(receipt?.repository!=='relativityE/speaksharp'||receipt.runId!==job.runId||receipt.runAttempt!==job.runAttempt||receipt.jobId!==job.jobId||receipt.workflowSourceSha!==job.producerSourceSha||receipt.immutableEnvironmentId!==`relativityE/speaksharp/${job.runId}/${job.runAttempt}/${job.jobId}`)fail('PRODUCER_RUNTIME_JOB_DIFFERS');
}
function validateScope(s,now){
 if(!s||!UUID.test(s.ownerAccountId||'')||!SHA.test(s.sourceSha||'')||s.servedSha!==s.sourceSha||typeof s.campaignId!=='string'||!s.campaignId||!Array.isArray(s.caseIds)||!s.caseIds.length||new Set(s.caseIds).size!==s.caseIds.length||s.caseIds.some(k=>!ROLES[k]))fail('PRODUCER_SCOPE_INVALID');
 const start=Date.parse(s.notBefore),end=Date.parse(s.deadlineAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||now>=end||end-start>21600000||!Number.isSafeInteger(s.maxDeliveries)||s.maxDeliveries<1||s.maxDeliveries>128||!Number.isSafeInteger(s.maxSupabaseRequests)||s.maxSupabaseRequests<1||s.maxSupabaseRequests>256||!Number.isSafeInteger(s.maxTelemetryReads)||s.maxTelemetryReads<0||s.maxTelemetryReads>16)fail('PRODUCER_WINDOW_OR_BUDGET_INVALID');
 return structuredClone(s);
}
function readTelemetry(request,{env,checkout,signal}){
 // Reuse the governed reader. Do not reinterpret a missing/failed receipt as QUALIFIED.
 if(!env.POSTHOG_PROJECT_ID||!env.POSTHOG_PERSONAL_API_KEY)fail('TELEMETRY_CAPABILITY_UNAVAILABLE');
 const childEnv={};for(const k of ['PATH','HOME','POSTHOG_PROJECT_ID','POSTHOG_PERSONAL_API_KEY','POSTHOG_API_HOST'])if(env[k]!==undefined)childEnv[k]=env[k];
 childEnv.QUALIFICATION_STAGES='share_feedback';
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx',path.join(checkout,'scripts/telemetry-readback-qualification.mts'),'--release-sha',request.sourceSha,'--journey-id',request.journeyId,'--traffic-type','canary','--query-timeout-ms','30000'],{cwd:checkout,env:childEnv,stdio:['ignore','pipe','pipe'],signal});
  let output='',size=0,overflow=false;
  const timer=setTimeout(()=>child.kill('SIGKILL'),40000);timer.unref();
  child.stdout.on('data',b=>{size+=b.length;if(size>1048576){overflow=true;child.kill('SIGKILL');}else output+=b.toString('utf8');});
  // Never echo raw diagnostics or provider replies, including errors.
  child.stderr.on('data',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Object.assign(new Error('NOT_RUN: TELEMETRY_READER_UNAVAILABLE'),{code:'TELEMETRY_READER_UNAVAILABLE'}));});
  child.on('close',code=>{
   clearTimeout(timer);if(overflow)return reject(new Error('NOT_RUN: TELEMETRY_OUTPUT_LIMIT'));
   const prefix='TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ',lines=output.split('\n').filter(x=>x.startsWith(prefix));
   if(lines.length!==1||![0,1,3].includes(code))return reject(new Error('NOT_RUN: TELEMETRY_RECEIPT_UNAVAILABLE'));
   try{resolve(JSON.parse(lines[0].slice(prefix.length)));}catch{reject(new Error('NOT_RUN: TELEMETRY_RECEIPT_INVALID'));}
  });
 });
}
function createProducer({scope,env=process.env,fetchImpl=globalThis.fetch,telemetryReader=readTelemetry,checkout=process.cwd(),now=Date.now}={}){
 const job=jobIdentity(env),s=validateScope(scope,now()),codeSha=producerSha(),seen=new Set();let deliveries=0,supabaseRequests=0,telemetryReads=0;
 let base;try{base=new URL(env.SUPABASE_URL);}catch{fail('AUTHENTICATED_READ_CAPABILITY_UNAVAILABLE');}
 if(base.href!=='https://yxlapjuovrsvjswkwnrk.supabase.co/'||!env.SUPABASE_SERVICE_ROLE_KEY)fail('AUTHENTICATED_READ_CAPABILITY_UNAVAILABLE');
 async function json(route,{method='GET',body,signal}={}){
  if(++supabaseRequests>s.maxSupabaseRequests)fail('PRODUCER_SUPABASE_BUDGET_EXHAUSTED');
  const response=await fetchImpl(new URL(route,base),{method,redirect:'error',signal,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)fail('AUTHENTICATED_READ_FAILED');
  let bytes=0;const parts=[];
  for await(const part of response.body){bytes+=part.length;if(bytes>2097152)fail('AUTHENTICATED_READ_TOO_LARGE');parts.push(part);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail('AUTHENTICATED_READ_INVALID');}
 }
 return {job,codeSha,stats:()=>({deliveries,supabaseRequests,telemetryReads}),async receive({request,requestSha256,signal}){
  const t=now();if(signal?.aborted)fail('PRODUCER_CANCELLED');
  if(t<Date.parse(s.notBefore)||t>=Date.parse(s.deadlineAt))fail('PRODUCER_WINDOW_EXPIRED');
  if(p.requestDigest(request)!==requestSha256||request.campaignId!==s.campaignId||request.ownerAccountId!==s.ownerAccountId||request.sourceSha!==s.sourceSha||request.servedSha!==s.servedSha||!s.caseIds.includes(request.caseId)||!ROLES[request.caseId]?.includes(request.artifactRole)||request.producerIdentity!==job.identity||request.producerCodeSha256!==codeSha)fail('PRODUCER_REQUEST_SCOPE_DIFFERS');
  if(!Number.isFinite(Date.parse(request.startedAt))||!Number.isFinite(Date.parse(request.requestedAt))||Date.parse(request.startedAt)<Date.parse(s.notBefore)||Date.parse(request.startedAt)>Date.parse(request.requestedAt)||Date.parse(request.requestedAt)>t||t-Date.parse(request.requestedAt)>30000)fail('PRODUCER_REQUEST_STALE');
  if(seen.has(request.requestNonce))fail('PRODUCER_REQUEST_REPLAY');
  seen.add(request.requestNonce);if(++deliveries>s.maxDeliveries)fail('PRODUCER_DELIVERY_BUDGET_EXHAUSTED');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,Math.min(45000,Date.parse(s.deadlineAt)-t));timeout.unref();
  try{
   let content;
   if(request.artifactRole==='coaching-authority'){
    const q=p.coachingQuery(request),url=new URL('/rest/v1/sessions',base);url.searchParams.set('select','id');url.searchParams.set('id','eq.'+request.sessionIds[0]);url.searchParams.set('user_id','eq.'+s.ownerAccountId);url.searchParams.set('limit','2');
    const own=await json(url,{signal:controller.signal});if(!Array.isArray(own)||own.length!==1||own[0].id!==request.sessionIds[0])fail('OWN_SESSION_NOT_ESTABLISHED');
    content=p.projectCoachingAuthority(await json('/rest/v1/rpc/'+q.rpc,{method:'POST',body:q.args,signal:controller.signal}),request);
   }else if(request.artifactRole==='feedback-association'){
    const q=p.feedbackQuery(request),url=new URL('/rest/v1/'+q.table,base);url.searchParams.set('select',q.select);url.searchParams.set('limit',String(q.limit));for(const [k,op,v]of q.filters)url.searchParams.set(k,op+'.'+v);
    content=p.projectFeedbackAssociation(await json(url,{signal:controller.signal}),request);
   }else{
    p.feedbackReceivedQuery(request);
    // A reader invocation is not one HTTP request. It performs the existing identity + family
    // SELECTs (two queries in this mode); report that distinction, never an invented HTTP count.
    if(++telemetryReads>s.maxTelemetryReads)fail('PRODUCER_TELEMETRY_BUDGET_EXHAUSTED');
    content=p.projectFeedbackReceived(await telemetryReader(request,{env,checkout,signal:controller.signal}),request);
   }
   if(controller.signal.aborted||now()>=Date.parse(s.deadlineAt))fail('PRODUCER_CANCELLED');
   const artifactBytes=Buffer.from(JSON.stringify(content)),finished=new Date(now()).toISOString();
   return {artifactBytes,provenance:{verificationStatus:'VERIFIED_BY_REVIEWED_RECEIVER',deliveryKind:'reviewed-authenticated-workflow-artifact',producerIdentity:job.identity,producerCodeSha256:codeSha,requestSha256,artifactSha256:p.sha(artifactBytes),artifactRole:request.artifactRole,campaignId:s.campaignId,caseId:request.caseId,sourceSha:s.sourceSha,servedSha:s.servedSha,sourceReference:job.reference,verifierReference:'same-job-read-only-producer:'+job.producerSourceSha,rawServerRead:true,producedAt:finished,receivedAt:finished}};
  }catch(e){if(e?.code&&/^[A-Z_]+$/.test(e.code))throw e;fail('PRODUCER_READ_UNAVAILABLE');}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
 }};
}
async function startBroker({directory,producer}){
 const dir=path.resolve(directory),st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||fs.realpathSync(dir)!==dir)fail('PRODUCER_PRIVATE_DIRECTORY_REQUIRED');
 const socketPath=path.join(dir,'evidence.sock');if(Buffer.byteLength(socketPath)>100||fs.existsSync(socketPath))fail('PRODUCER_SOCKET_PATH_UNAVAILABLE');
 const clients=new Set(),controllers=new Set();
 const server=net.createServer({allowHalfOpen:true},socket=>{
  clients.add(socket);const controller=new AbortController();controllers.add(controller);let bytes=0,chunks=[];
  socket.setTimeout(50000,()=>socket.destroy());socket.on('error',()=>{});
  socket.on('data',b=>{bytes+=b.length;if(bytes>16384)socket.destroy();else chunks.push(b);});
  socket.on('close',()=>{clients.delete(socket);controllers.delete(controller);controller.abort();});
  socket.on('end',async()=>{try{const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=await producer.receive({...input,signal:controller.signal});socket.end(JSON.stringify({ok:true,artifactBase64:result.artifactBytes.toString('base64'),provenance:result.provenance}));}catch{socket.end(JSON.stringify({ok:false,code:'EVIDENCE_READ_UNAVAILABLE'}));}});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{fs.chmodSync(socketPath,0o600);resolve();});});
 return {socketPath,async close(){for(const c of controllers)c.abort();for(const c of clients)c.destroy();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
module.exports={createProducer,startBroker,jobIdentity,assertJobReceipt,validateScope,producerSha,descriptor};
