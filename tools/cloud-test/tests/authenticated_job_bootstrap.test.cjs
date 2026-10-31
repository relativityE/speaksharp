'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {prepare,builderEnvironment,main}=require('../scripts/authenticated_job_bootstrap.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'job-prep-')));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=path.join(root,'out');fs.mkdirSync(out,0o700);
 const write=(p,v)=>{fs.writeFileSync(p,JSON.stringify(v),{mode:0o600});return hash(fs.readFileSync(p));};
 const now=Date.now(),scope={ownerAccountId:'11111111-1111-4111-8111-111111111111',sourceSha:'a'.repeat(40),servedSha:'a'.repeat(40),campaignId:'UNIT-CAMPAIGN',caseIds:['AHT-01','AHT-07'],notBefore:new Date(now-1000).toISOString(),deadlineAt:new Date(now+60000).toISOString(),maxDeliveries:8,maxSupabaseRequests:16,maxTelemetryReads:2,ownerApprovalReference:'UNIT-OWNER-SELECTION',producerReviewReference:'UNIT-INDEPENDENT-REVIEW'};
 const env={PATH:process.env.PATH,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'relativityE/speaksharp',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'live',GITHUB_SHA:'b'.repeat(40),BP_PRIVATE:out,BP_PACKET:path.resolve(__dirname,'../harness'),BP_FACTS:path.join(root,'facts.json'),BP_ACCOUNT_ID_FILE:path.join(root,'uid'),BP_CAMPAIGN:scope.campaignId,BP_SOURCE_SHA:scope.sourceSha,BP_T0:scope.notBefore,BP_T1:scope.deadlineAt,SUPABASE_SERVICE_ROLE_KEY:'PRIVATE-SERVICE',POSTHOG_PERSONAL_API_KEY:'PRIVATE-PROVIDER',THROWAWAY_TEST_PASSWORD:'PRIVATE-PASSWORD',UNKNOWN_SECRET:'PRIVATE-UNKNOWN'};
 write(env.BP_FACTS,{ownerApprovalReference:scope.ownerApprovalReference,producerReviewReference:scope.producerReviewReference});fs.writeFileSync(env.BP_ACCOUNT_ID_FILE,scope.ownerAccountId,{mode:0o600});
 const authorization=path.join(root,'scope.json');let authorizationSha256=write(authorization,scope);
 const phases=[];const f={scope,env,root,out,phases,authorization,authorizationSha256,mutatePlan:()=>{}};
 f.runBuilder=(phase,childEnv)=>{phases.push(phase);assert.equal(childEnv.SUPABASE_SERVICE_ROLE_KEY,undefined);assert.equal(childEnv.THROWAWAY_TEST_PASSWORD,undefined);assert.equal(childEnv.GITHUB_JOB,'live');if(phase==='phase2'){fs.mkdirSync(path.join(out,'cfg'),0o700);const plan={runtime:'GitHub Actions SpeakSharp',campaignId:scope.campaignId,sourceSha:scope.sourceSha,servedSha:scope.servedSha,deadlineAt:scope.deadlineAt,cases:[{id:'AHT-01'},{id:'AHT-07'},{id:'AHT-15'}]};f.mutatePlan(plan);write(path.join(out,'cfg/campaign-plan.json'),plan);}};
 f.repin=()=>{f.authorizationSha256=write(authorization,scope);};return f;
}
test('preparation binds actual job descriptor and exact plan/scope bytes, never launches a campaign',t=>{const f=fixture(t),r=prepare(f);assert.deepEqual(f.phases,['phase1','phase2']);assert.match(r.kind,/not-live-result/);for(const input of [r.plan,r.scope,r.descriptor]){assert.equal(hash(fs.readFileSync(input.file)),input.sha256);assert.equal(fs.statSync(input.file).mode&0o777,0o600);}const d=JSON.parse(fs.readFileSync(r.descriptor.file));assert.equal(d.producerIdentity,'github-actions:relativityE/speaksharp:123:1:live');assert.equal(d.workflowSourceSha,'b'.repeat(40));assert.equal(d.reviewReference,'UNIT-INDEPENDENT-REVIEW');assert(!JSON.stringify(r).includes('PRIVATE-'));});
test('builder gets a closed preparation environment, not privileged or account credentials',()=>{const e=builderEnvironment({PATH:'/bin',BP_TOTAL:'100',GITHUB_JOB:'live',SUPABASE_SERVICE_ROLE_KEY:'PRIVATE',POSTHOG_PERSONAL_API_KEY:'PRIVATE',FREE_TEST_PASSWORD:'PRIVATE',UNKNOWN_SECRET:'PRIVATE',BP_UNKNOWN_SECRET:'PRIVATE'}, {file:'/unit/descriptor',sha256:'c'.repeat(64)});assert.equal(e.BP_TOTAL,'100');assert.equal(e.BP_PRODUCER_MODE,'same-github-job');assert.equal(e.BP_RUNTIME,'GitHub Actions SpeakSharp');assert(!JSON.stringify(e).includes('PRIVATE'));assert.equal(e.BP_UNKNOWN_SECRET,undefined);});
for(const [key,value]of [['BP_SOURCE_SHA','c'.repeat(40)],['BP_CAMPAIGN','different'],['BP_T1','2099-01-01T00:00:00Z'],['GITHUB_JOB','bad/job'],['GITHUB_ACTIONS','false']])test('wrong actual job/campaign scope refuses before builder: '+key,t=>{const f=fixture(t);f.env[key]=value;assert.throws(()=>prepare(f));assert.deepEqual(f.phases,[]);assert.deepEqual(fs.readdirSync(f.out),[]);});
test('private scope hash mismatch refuses before any output',t=>{const f=fixture(t);f.authorizationSha256='0'.repeat(64);assert.throws(()=>prepare(f));assert.deepEqual(f.phases,[]);assert.deepEqual(fs.readdirSync(f.out),[]);});
test('unselected account refuses before preparation',t=>{const f=fixture(t);fs.writeFileSync(f.env.BP_ACCOUNT_ID_FILE,'22222222-2222-4222-8222-222222222222');assert.throws(()=>prepare(f));assert.deepEqual(f.phases,[]);});
test('no overwrite or resume of an existing preparation',t=>{const f=fixture(t);prepare(f);const before=fs.readFileSync(path.join(f.out,'producer-descriptor.json'));assert.throws(()=>prepare(f),/FRESH_PRIVATE/);assert.deepEqual(fs.readFileSync(path.join(f.out,'producer-descriptor.json')),before);});
for(const [name,mutate]of [['another release',p=>p.servedSha='c'.repeat(40)],['another runtime',p=>p.runtime='Claude SpeakSharp R4'],['omitted producer case',p=>p.cases=p.cases.filter(c=>c.id!=='AHT-07')],['unselected producer case',p=>p.cases.push({id:'AHT-08'})]])test('built plan cannot silently change scope: '+name,t=>{const f=fixture(t);f.mutatePlan=mutate;assert.throws(()=>prepare(f));assert.equal(fs.existsSync(path.join(f.out,'producer-scope.json')),false);});
test('builder refusal retains preparation for diagnosis but creates no runnable scope',t=>{const f=fixture(t);f.runBuilder=()=>{throw Error('synthetic refusal');};assert.throws(()=>prepare(f));assert.equal(fs.existsSync(path.join(f.out,'producer-scope.json')),false);assert.equal(fs.existsSync(path.join(f.out,'producer-descriptor.json')),true);});
test('CLI accepts only the fixed preparation command, no arbitrary executable',()=>{const old=console.error;let output='';console.error=x=>{output+=x;};try{assert.equal(main(['--exec','echo PRIVATE']),78);}finally{console.error=old;}assert.equal(output,'NOT_RUN: AUTHENTICATED_JOB_PREPARATION_REFUSED');assert(!output.includes('PRIVATE'));});
test('inactive producer manifest rows grant no extra account/evidence scope',t=>{const f=fixture(t);f.mutatePlan=p=>{p.cases.push({id:'AHT-02'});p.selection={ids:['AHT-01','AHT-07','AHT-15']};};const result=prepare(f);assert.deepEqual(JSON.parse(fs.readFileSync(result.scope.file)).caseIds,['AHT-01','AHT-07']);});
test('scope for an unselected producer case refuses instead of widening selection',t=>{const f=fixture(t);f.mutatePlan=p=>{p.selection={ids:['AHT-07','AHT-15']};};assert.throws(()=>prepare(f),/PRODUCER_CASES_DIFFER/);assert.equal(fs.existsSync(path.join(f.out,'producer-scope.json')),false);});

function actualFixture(t){
 const f=fixture(t),r=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/partial-request.json')));
 f.scope.caseIds=['AHT-08'];f.scope.sourceSha=f.scope.servedSha='66328703bf47e865b730e229005411e78481d34c';
 const caps={'AHT-08':0};
 Object.assign(r,{runId:f.scope.campaignId,coverageMode:'partial',sampleMode:'full',executionRuntime:'GitHub Actions SpeakSharp',selectionApprovalRef:'SYNTHETIC-NOT-A-RUN'});
 r.release.testedSha=f.scope.sourceSha;r.window={startUtc:f.scope.notBefore,endUtc:f.scope.deadlineAt};
 r.selection=[{order:1,case:'AHT-08',plannedRequests:100,startPressCap:0,gate:null}];
 Object.assign(r.estimate,{starts:0,identityReads:4,requests:{planned:100,cleanupReserve:50,pooledSlack:0,runCap:150},providerBillableRequests:{coachingCap:0,basis:'SYNTHETIC-NOT-A-RUN'}});
 r.proposedLimits.startPressCaps=caps;
 Object.assign(r.approvedLimits,{startPressCaps:caps,startsCap:100,runCapRequests:150,approvalRef:'SYNTHETIC-NOT-A-RUN',approvedBy:'SYNTHETIC-NOT-A-RUN'});
 const write=(name,v)=>{const file=path.join(f.root,name);fs.writeFileSync(file,JSON.stringify(v),{mode:0o600});return file;};
 const request=write('request.json',r),rc=write('reconciliation.json',{synthetic:'NOT-A-RUN',starts:{ownerCounted:0},ceilings:{starts:100}});
 const facts=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/plan-facts.PLACEHOLDER.json')));
 Object.assign(facts,{ownerApprovalReference:f.scope.ownerApprovalReference,producerReviewReference:f.scope.producerReviewReference,
  actionApproval:{schema:'speaksharp.case-start-approval.v1',requestSha256:hash(fs.readFileSync(request)),reconciliationSha256:hash(fs.readFileSync(rc)),approvalRef:r.approvedLimits.approvalRef,approvedBy:r.approvedLimits.approvedBy,selectionApprovalRef:r.selectionApprovalRef}});
 fs.writeFileSync(f.env.BP_FACTS,JSON.stringify(facts));
 Object.assign(f.env,{BP_MODE:'selected-full',BP_CHECKOUT:path.resolve(__dirname,'../../..'),BP_SOURCE_SHA:f.scope.sourceSha,
  BP_REQUEST_FILE:request,BP_REQUEST_SHA256:hash(fs.readFileSync(request)),BP_RECONCILIATION_FILE:rc,BP_RECONCILIATION_SHA256:hash(fs.readFileSync(rc)),
  BP_SELECT:'8',BP_CASES:Array.from({length:15},(_,i)=>i+1).join(','),BP_EST:'8:100',BP_SELECT_REF:r.selectionApprovalRef,BP_SELECT_REASON:'SYNTHETIC-NOT-A-RUN',
  BP_IDENT:'4',BP_TOTAL:'150',BP_CLEANUP:'50',BP_COACHING_CAP:'0',BP_MEDIA_PARENT:path.join(f.root,'media'),VITE_SUPABASE_ANON_KEY:'SYNTHETIC-PUBLISHABLE'});
 f.repin();delete f.runBuilder;return f;
}
test('actual prepare spawns the fixed isolated builder for both phases and transports all four bindings',t=>{
 const f=actualFixture(t),result=prepare(f),plan=JSON.parse(fs.readFileSync(result.plan.file));
 assert.equal(plan.cases.length,15);assert.deepEqual(plan.selection.ids,['AHT-08']);
 const c=JSON.parse(fs.readFileSync(path.join(f.out,'cases/AHT-08.json')));
 assert.equal(c.startPressApproval.requestSha256,f.env.BP_REQUEST_SHA256);
 assert.equal(c.startPressApproval.reconciliationSha256,f.env.BP_RECONCILIATION_SHA256);
 assert.equal(fs.existsSync(path.join(f.root,'media')),false);
 assert.equal(fs.existsSync(path.join(f.out,'run')),false);
});
for(const key of ['BP_REQUEST_FILE','BP_REQUEST_SHA256','BP_RECONCILIATION_FILE','BP_RECONCILIATION_SHA256'])
 test('actual prepare refuses a dropped binding without new builder files: '+key,t=>{
  const f=actualFixture(t);delete f.env[key];assert.throws(()=>prepare(f),/PLAN_BUILD_REFUSED/);
  assert.deepEqual(fs.readdirSync(f.out),['producer-descriptor.json']);
 });

for(const caseId of ['AHT-13','AHT-14'])test(caseId+' real Start helper journals and fsyncs three recovery actions; fourth is refused before click',async t=>{
 const {ActionBudget}=require('../harness/bundle/harness/action-budget.cjs');
 const ui=require('../harness/draft-adapters/browser-actions.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-actions-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const budget=new ActionBudget({runDir:dir,caseId,startPressCap:3,takeCap:1}),clicks=[],order=[];
 const originalSync=fs.fsyncSync;fs.fsyncSync=fd=>{order.push('fsync');return originalSync(fd);};t.after(()=>{fs.fsyncSync=originalSync;});
 const page={getByTestId:control=>({click:async()=>{const rows=fs.readFileSync(budget.file,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).control,control);assert.equal(rows.at(-1).ordinal,clicks.length+1);assert.equal(order.at(-1),'fsync');
  order.push('click');clicks.push(control);}})};
 ui.bindStartPressRecorder(page,control=>budget.reserveStart({caseId,control}));
 for(const control of ['mic-download','mic-retry','mic-start'])await ui.pressStart(page,control);
 const before=fs.readFileSync(budget.file);await assert.rejects(ui.pressStart(page,'mic-start'),e=>e.code==='START_PRESS_CAP');
 assert.deepEqual(clicks,['mic-download','mic-retry','mic-start']);assert.deepEqual(fs.readFileSync(budget.file),before);
 assert.equal(budget.summary().used.startPresses,3);
});
