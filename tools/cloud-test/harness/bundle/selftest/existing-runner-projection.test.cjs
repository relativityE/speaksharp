'use strict';
// Pure synthetic rows and injected delivery only. No RPC, browser, credentials or workflow.
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../harness/existing-runner-projection.cjs'),{createExistingRunnerReceiver}=require('../harness/existing-runner-receiver.cjs');
const {validateProducerDelivery}=require('../harness/producer-evidence.cjs');
const {canonicalSuggestionSha256}=require('../../draft-adapters/oracles/pure/rwtCoachingEvidence.cjs');
const uid='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333',sha='a'.repeat(40),h='b'.repeat(64);
const pair={version:'gemini_coaching_v1',what_worked:'UNIT private well',what_to_try_next:'UNIT private next'},d=canonicalSuggestionSha256(pair);
const request=(role='coaching-authority')=>({artifactRole:role,ownerAccountId:uid,sourceSha:sha,servedSha:sha,campaignId:'UNIT',caseId:'AHT-07',requestNonce:'1'.repeat(32),startedAt:'2026-10-27T12:00:00Z',sessionIds:[id],idempotencyKey:key,requestedAt:'2026-10-27T12:00:00Z'});
const authority=()=>({session_id:id,user_id:uid,ai_suggestions:pair,provider:'google_gemini',model:'unit-model',provider_request_made:true,cache_read_count:5,receipt_suggestion_sha256:d,current_suggestion_sha256:d});
const report=()=>({id,user_id:uid,session_id:id,idempotency_key:key,created_at:'2026-10-27T12:00:00Z',metadata:{coaching_diagnostic_ref:key}});
test('actual RPC projection retains exact cache count, route and canonical digest without raw pair/owner',()=>{const q=request(),v=p.projectCoachingAuthority([authority()],q);assert.equal(p.validateProjection(v,q),v);assert.equal(v.observations[0].cacheReadCount,5);assert.equal(v.observations[0].immutableSuggestionSha256,d);for(const secret of [uid,id,pair.what_worked,pair.what_to_try_next])assert.equal(JSON.stringify(v).includes(secret),false);assert.deepEqual(p.coachingQuery(q),{rpc:'read_ai_suggestion_authority_v1',args:{p_session_ids:[id]},requiredOwnerId:uid});});
for(const [key,value]of [['user_id',id],['session_id',uid],['provider','other'],['provider_request_made',false],['cache_read_count',-1],['cache_read_count',1.2],['current_suggestion_sha256',h],['receipt_suggestion_sha256',h],['ai_suggestions',{...pair,what_worked:'changed'}]])test('projection rejects actual authority '+key+' '+value,()=>assert.throws(()=>p.projectCoachingAuthority([{...authority(),[key]:value}],request())));
for(const rows of [[],[authority(),authority()]])test('authority cardinality '+rows.length,()=>assert.throws(()=>p.projectCoachingAuthority(rows,request())));
test('feedback query narrows existing admin route by actual owner+draft, not desired session',()=>{const q=p.feedbackQuery(request('feedback-association'));assert.deepEqual(q.filters,[['user_id','eq',uid],['idempotency_key','eq',key],['created_at','gte','2026-10-27T12:00:00Z']]);assert.equal(q.limit,2);assert(!JSON.stringify(q.filters).includes('session_id'));});
for(const [kind,ref]of [['valid',key],['absent',null],['malformed',3]])test('feedback preserves '+kind+' reference and actual nulled session',()=>{const q=request('feedback-association'),v=p.projectFeedbackAssociation([{...report(),session_id:null,metadata:{coaching_diagnostic_ref:ref}}],q);assert.equal(p.validateProjection(v,q),v);assert.equal(v.observations[0].sessionSha256,null);assert.equal(v.observations[0].diagnosticKind,kind);assert(!JSON.stringify(v).includes(uid));});
for(const n of [0,1,2])test('feedback exact bounded observed cardinality '+n,()=>assert.equal(p.projectFeedbackAssociation(Array(n).fill(report()),request('feedback-association')).observations.length,n));
for(const [k,v]of [['user_id',id],['idempotency_key',id],['session_id','malformed']])test('feedback rejects wrong '+k,()=>assert.throws(()=>p.projectFeedbackAssociation([{...report(),[k]:v}],request('feedback-association'))));
for(const [k,v]of [['requestSha256',h],['campaignId','other'],['caseId','AHT-08'],['sourceReadRoute','fake'],['artifactRole','feedback-association']])test('projection receipt rejects '+k,()=>{const q=request(),v0=p.projectCoachingAuthority([authority()],q);v0[k]=v;assert.throws(()=>p.validateProjection(v0,q));});
const binding={deliveryKind:'authenticated-connector-artifact',producerIdentity:'UNIT-EXISTING',producerCodeSha256:h};

const telemetryRequest=()=>({...request('feedback-received'),caseId:'AHT-08',journeyId:'UNIT-journey',bootId:'UNIT-boot'});
const telemetryReceipt=()=>({gate:'TELEMETRY-READBACK-COMPLETENESS',release_sha:sha,journey_id:'UNIT-journey',boot_id:'UNIT-boot',traffic_type:'internal_test',identity_bound:true,verdict:'QUALIFIED',stages_declared:['share_feedback'],stage_reasons:[],missing:[],reasons:[],unrecognised:[],duplicate_families:[],delivery_failures:[],observed_families:['feedback_dialog_opened','feedback_field','feedback_submit'],required_families:['feedback_dialog_opened','feedback_field','feedback_submit'],received_counts:{telemetry_positive_control:1}});
const receivedVerdict=require('../../draft-adapters/oracles/receipts.cjs').receivedFeedbackVerdict;
const sentTelemetry={journeyId:'UNIT-journey',bootId:'UNIT-boot',trafficType:'internal_test'};
const telemetryConfig={sourceSha:sha,servedSha:sha,campaignId:'UNIT',caseId:'AHT-08'};
test('actual feedback readback projection reaches the existing journey oracle without retaining private strings',()=>{
 const q=telemetryRequest(),raw=telemetryReceipt();raw.extra='PRIVATE https://example.invalid/?token=do-not-retain';
 const projected=p.projectFeedbackReceived(raw,q);
 assert.equal(p.validateProjection(projected,q),projected);
 assert.equal(receivedVerdict(projected,sentTelemetry,telemetryConfig).status,'PASS');
 for(const value of [q.journeyId,q.bootId,q.ownerAccountId,raw.extra])assert.equal(JSON.stringify(projected).includes(value),false);
 assert.equal(projected.observations[0].positiveControlCount,1);
 assert.equal(projected.observations[0].feedbackSubmitCount,undefined);
});
for(const [field,value]of [['release_sha','b'.repeat(40)],['journey_id','other'],['boot_id','other'],['identity_bound',false],['traffic_type','user']])test('received projection rejects actual readback '+field,()=>assert.throws(()=>p.projectFeedbackReceived({...telemetryReceipt(),[field]:value},telemetryRequest())));
for(const [variant,[field,value,expected]]of [['missing',['feedback_submit'],'HOLD'],['reasons',['private error token'],'HOLD'],['stage_reasons',['private failure text'],'HOLD'],['unrecognised',['other'],'HOLD'],['duplicate_families',['feedback_submit'],'FAIL'],['delivery_failures',[{category:'unaccounted_delivery_gap',affectedFamilies:['feedback_submit']}],'FAIL'],['verdict','FAIL','FAIL'],['verdict','HOLD','HOLD'],['stages_declared',[],'HOLD'],['required_families',[],'HOLD'],['observed_families',[],'HOLD'],['received_counts',{telemetry_positive_control:0},'HOLD']].entries())test('received projection preserves non-success '+field+' variant '+variant,()=>{
 const raw={...telemetryReceipt(),[field]:value},projected=p.projectFeedbackReceived(raw,telemetryRequest());
 assert.equal(receivedVerdict(projected,sentTelemetry,telemetryConfig).status,expected);
 assert.equal(JSON.stringify(projected).includes('private error token'),false);
 assert.equal(JSON.stringify(projected).includes('private failure text'),false);
});
test('received counts alone cannot replace completeness fields',()=>{
 const raw=telemetryReceipt();delete raw.missing;
 assert.throws(()=>p.projectFeedbackReceived(raw,telemetryRequest()),/completeness/);
});
test('real producer-shaped delivery failure remains FAIL without retaining its raw fields',()=>{
 const raw=telemetryReceipt();raw.delivery_failures=[{category:'unaccounted_delivery_gap',affectedFamilies:['feedback_submit']}];
 const projected=p.projectFeedbackReceived(raw,telemetryRequest());
 assert.equal(projected.observations[0].deliveryFailuresCount,1);
 assert.equal(receivedVerdict(projected,sentTelemetry,telemetryConfig).status,'FAIL');
 assert.equal(JSON.stringify(projected).includes('unaccounted_delivery_gap'),false);
});
for(const failure of ['posthog',null,{category:'private-vendor-error',affectedFamilies:['feedback_submit']},{category:'unaccounted_delivery_gap',affectedFamilies:'feedback_submit'},{category:'unaccounted_delivery_gap',affectedFamilies:[{}]},{category:'unaccounted_delivery_gap',affectedFamilies:['feedback_submit'],raw:'do not retain'}])test('malformed delivery failure objects refuse before projection '+JSON.stringify(failure),()=>{
 const raw=telemetryReceipt();raw.delivery_failures=[failure];
 assert.throws(()=>p.projectFeedbackReceived(raw,telemetryRequest()),/failure object shape/);
});
for(const [field,value]of [['journeySha256','0'.repeat(64)],['trafficType','user'],['missingCount',-1],['positiveControlCount',1.1],['unexpected','private string'],['observedFamilies',['feedback_submit','not-a-family']]])test('received projection validator refuses changed '+field,()=>{
 const q=telemetryRequest(),v=p.projectFeedbackReceived(telemetryReceipt(),q);v.observations[0][field]=value;
 assert.throws(()=>p.validateProjection(v,q));
});
test('existing reviewed receiver accepts received projection bytes then the normal outer delivery gate checks provenance',async()=>{
 const q=telemetryRequest(),artifactBytes=Buffer.from(JSON.stringify(p.projectFeedbackReceived(telemetryReceipt(),q)));
 const actual={...delivery(request()),artifactBytes};Object.assign(actual.provenance,{artifactSha256:p.sha(artifactBytes),artifactRole:q.artifactRole,caseId:q.caseId,requestSha256:p.requestDigest(q)});
 const receive=createExistingRunnerReceiver({binding,receiveAuthenticatedArtifact:async()=>actual});
 const got=await receive({request:q,requestSha256:p.requestDigest(q)});
 const verified=validateProducerDelivery(got,q,binding);
 assert.equal(receivedVerdict(verified.content,sentTelemetry,telemetryConfig).status,'PASS');
});
function delivery(q){const artifactBytes=Buffer.from(JSON.stringify(p.projectCoachingAuthority([authority()],q)));return{artifactBytes,provenance:{verificationStatus:'VERIFIED_BY_REVIEWED_RECEIVER',deliveryKind:binding.deliveryKind,producerIdentity:binding.producerIdentity,producerCodeSha256:h,requestSha256:p.requestDigest(q),artifactSha256:p.sha(artifactBytes),artifactRole:q.artifactRole,campaignId:q.campaignId,caseId:q.caseId,sourceSha:sha,servedSha:sha,sourceReference:'UNIT-AUTHENTICATED-DELIVERY-NOT-A-RUN',verifierReference:'UNIT-REVIEWED-CAPABILITY-NOT-REAL',rawServerRead:true,producedAt:q.requestedAt,receivedAt:q.requestedAt}};}
test('receiving factory does not manufacture transport',()=>assert.throws(()=>createExistingRunnerReceiver({binding}),/unavailable/));
test('injected delivery validates actual bytes/provenance and returns them unchanged',async()=>{const q=request(),actual=delivery(q),receive=createExistingRunnerReceiver({binding,receiveAuthenticatedArtifact:async()=>actual});assert.equal(await receive({request:q,requestSha256:p.requestDigest(q)}),actual);});
for(const [k,v]of [['verificationStatus','CONFIG_ASSERTION'],['artifactSha256',h],['requestSha256',h],['rawServerRead',false],['clientEcho',true],['producerIdentity','other']])test('receiver rejects '+k,async()=>{const q=request(),actual=delivery(q);actual.provenance[k]=v;const receive=createExistingRunnerReceiver({binding,receiveAuthenticatedArtifact:async()=>actual});await assert.rejects(async()=>{const got=await receive({request:q,requestSha256:p.requestDigest(q)});validateProducerDelivery(got,q,binding);});});
test('changed passed request hash rejected before delivery',async()=>{let called=false;const receive=createExistingRunnerReceiver({binding,receiveAuthenticatedArtifact:async()=>{called=true;}});await assert.rejects(receive({request:request(),requestSha256:h}));assert.equal(called,false);});
test('cancelled delivery not accepted after asynchronous receive',async()=>{const q=request(),ac=new AbortController();const receive=createExistingRunnerReceiver({binding,receiveAuthenticatedArtifact:async()=>{ac.abort();return delivery(q);}});await assert.rejects(receive({request:q,requestSha256:p.requestDigest(q),signal:ac.signal}),/after cancellation/);});
test('old same-key stored row cannot stand in for this final action',()=>assert.throws(()=>p.projectFeedbackAssociation([{...report(),created_at:'2026-10-26T12:00:00Z'}],request('feedback-association')),/freshness/));
test('future stored timestamp cannot stand in for observed window',()=>assert.throws(()=>p.projectFeedbackAssociation([{...report(),created_at:'2026-10-28T12:00:00Z'}],request('feedback-association')),/freshness/));
test('real packaged factory loads after producer loader without weakening cache guard',t=>{
 const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');const packet=path.resolve(__dirname,'../..'),root=fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ss-receiver-unit-'))),dir=path.join(root,'delta-final-source/receiver-unit');fs.mkdirSync(dir,{recursive:true,mode:0o700});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const rel of ['bundle/harness/producer-evidence.cjs','bundle/harness/reviewed-step.cjs','bundle/harness/existing-runner-receiver.cjs','bundle/harness/existing-runner-projection.cjs','draft-adapters/oracles/pure/rwtCoachingEvidence.cjs','draft-adapters/oracles/pure/coaching-contract.json','draft-adapters/oracles/pure/fixture-manifest.json']){const target=path.join(root,rel);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,fs.readFileSync(path.join(packet,rel)),{mode:0o600});assert.equal(p.sha(fs.readFileSync(target)),p.sha(fs.readFileSync(path.join(packet,rel))));}const receiver=path.join(dir,'receiver.cjs'),manifest=path.join(dir,'manifest.json');fs.writeFileSync(receiver,"const x=require('../../bundle/harness/existing-runner-receiver.cjs');exports.contract=x.contract;exports.receiveArtifact=x.createExistingRunnerReceiver({binding:{},receiveAuthenticatedArtifact:async()=>{throw Error('UNIT transport never invoked');}});");const dep=['bundle/harness/existing-runner-receiver.cjs','bundle/harness/existing-runner-projection.cjs','draft-adapters/oracles/pure/rwtCoachingEvidence.cjs','draft-adapters/oracles/pure/coaching-contract.json','draft-adapters/oracles/pure/fixture-manifest.json'];const rel=path.relative(root,receiver),m={version:1,scope:'trusted-reviewed-node-not-sandbox',reviewer:'UNIT ONLY',reviewedAt:new Date().toISOString(),steps:[{path:rel,sha256:p.sha(fs.readFileSync(receiver)),dependencies:dep.map(file=>({path:file,sha256:p.sha(fs.readFileSync(path.join(root,file)))}))}]};fs.writeFileSync(manifest,JSON.stringify(m));const script=`const {loadReviewedProducerReceiver}=require('./bundle/harness/producer-evidence.cjs');const options=${JSON.stringify({stepRoot:root,receiverFile:receiver,manifestFile:manifest,expectedManifestSha256:p.sha(fs.readFileSync(manifest))})};const r=loadReviewedProducerReceiver(options);if(typeof r.receive!=='function')throw Error('notloaded');try{loadReviewedProducerReceiver(options);throw Error('cacheguardfailed');}catch(e){if(!/already cached/.test(e.message))throw e;}`;assert.doesNotThrow(()=>execFileSync(process.execPath,['-e',script],{cwd:root,env:{PATH:process.env.PATH},stdio:'pipe'}));
});
