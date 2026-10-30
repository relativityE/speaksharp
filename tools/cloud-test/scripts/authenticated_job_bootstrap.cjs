'use strict';
// Preparation only: no browser, account operation, provider call or campaign is started here.
// The selected job supplies reviewed private inputs; this does not create an approval receipt.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const H=path.resolve(__dirname,'../harness/bundle/harness');
const {descriptor,jobIdentity,validateScope}=require(path.join(H,'authenticated-job-producer.cjs'));
const {privateJson}=require(path.join(H,'with-authenticated-evidence.cjs'));
const {sha}=require(path.join(H,'existing-runner-projection.cjs'));
const BP_NAMES=Object.freeze(['MODE','PACKET','CHECKOUT','PRIVATE','FACTS','ACCOUNT_ID_FILE','SOURCE_SHA','CAMPAIGN','T0','T1','TOTAL','CLEANUP','IDENT','SELECT','GATES','EST','COACHING_CAP','SELECT_REF','SELECT_REASON','BACKEND_SOURCE','BACKEND_VERIFIED','CASES','HOST_APP','HOST_DB','MEDIA_PARENT','PDFJS_DIR','PDFJS_SHA','PRESS_EXTRA','SKIP','STIM','LEASE_RPCS','LEASE_READ'].map(x=>'BP_'+x));
function builderEnvironment(env,selection){
 const out={};
 for(const k of ['PATH','HOME','LANG','LC_ALL','TMPDIR','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB','GITHUB_SHA','VITE_SUPABASE_ANON_KEY',...BP_NAMES])if(env[k]!==undefined)out[k]=env[k];
 return {...out,BP_RUNTIME:'GitHub Actions SpeakSharp',BP_PRODUCER_MODE:'same-github-job',BP_PRODUCER_DESCRIPTOR:selection.file,BP_PRODUCER_DESCRIPTOR_SHA256:selection.sha256};
}
function writePrivate(file,value){
 const data=Buffer.from(JSON.stringify(value,null,2)+'\n');
 const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);}finally{fs.closeSync(fd);}
 return {file,sha256:sha(data)};
}
function assertDirectory(dir){
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||fs.realpathSync(dir)!==dir)throw Error('PRIVATE_DIRECTORY_REQUIRED');
}
function validateBindings(scope,facts,env){
 jobIdentity(env);validateScope(scope,Date.now());
 if(scope.campaignId!==env.BP_CAMPAIGN||scope.sourceSha!==env.BP_SOURCE_SHA||scope.servedSha!==env.BP_SOURCE_SHA||scope.notBefore!==env.BP_T0||scope.deadlineAt!==env.BP_T1||!scope.ownerApprovalReference||scope.ownerApprovalReference!==facts.ownerApprovalReference||!scope.producerReviewReference||scope.producerReviewReference!==facts.producerReviewReference)throw Error('SELECTED_SCOPE_DIFFERS');
 const uid=fs.readFileSync(env.BP_ACCOUNT_ID_FILE,'utf8').trim();
 if(scope.ownerAccountId!==uid)throw Error('SELECTED_ACCOUNT_DIFFERS');
}
function prepare({authorization,authorizationSha256,env=process.env,runBuilder}={}){
 // Neither arbitrary commands nor an alternate builder path are accepted.
 const scope=privateJson(authorization,authorizationSha256);
 const factsBytes=fs.readFileSync(env.BP_FACTS),facts=JSON.parse(factsBytes);
 validateBindings(scope,facts,env);
 const dir=path.resolve(env.BP_PRIVATE);assertDirectory(dir);
 if(fs.readdirSync(dir).length)throw Error('FRESH_PRIVATE_DIRECTORY_REQUIRED');
 const reviewedPacket=path.resolve(__dirname,'../harness');
 if(fs.realpathSync(env.BP_PACKET)!==reviewedPacket)throw Error('BOOTSTRAP_PACKET_DIFFERS');
 const selection=writePrivate(path.join(dir,'producer-descriptor.json'),descriptor(facts.producerReviewReference,env));
 const childEnv=builderEnvironment(env,selection);
 const builder=path.resolve(__dirname,'../harness-adapter/build_plan.py');
 const execute=runBuilder||((phase)=>{
  const r=spawnSync('python3',['-I',builder,phase],{env:childEnv,stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:1048576});
  if(r.error||r.status!==0)throw Error('PLAN_BUILD_REFUSED');
 });
 execute('phase1',childEnv);execute('phase2',childEnv);
 const planFile=path.join(dir,'cfg/campaign-plan.json'),planBytes=fs.readFileSync(planFile),plan=privateJson(planFile,sha(planBytes));
 if(plan.runtime!=='GitHub Actions SpeakSharp'||plan.campaignId!==scope.campaignId||plan.sourceSha!==scope.sourceSha||plan.servedSha!==scope.servedSha||plan.deadlineAt!==scope.deadlineAt)throw Error('BUILT_PLAN_SCOPE_DIFFERS');
 const selected=require(path.join(H,'campaign-core.cjs')).selectedOrder(plan);
 const producerCases=plan.cases.filter(c=>selected.includes(c.id)&&['AHT-01','AHT-02','AHT-03','AHT-07','AHT-08'].includes(c.id)).map(c=>c.id);
 if(JSON.stringify([...producerCases].sort())!==JSON.stringify([...scope.caseIds].sort()))throw Error('BUILT_PRODUCER_CASES_DIFFER');
 const savedScope=writePrivate(path.join(dir,'producer-scope.json'),scope);
 return {kind:'same-job-preparation-not-live-result',plan:{file:planFile,sha256:sha(planBytes)},scope:savedScope,descriptor:selection,authorizationSha256};
}
function main(argv){
 try{
  if(argv.length!==4||argv[0]!=='--authorization'||argv[2]!=='--authorization-sha256')throw Error('EXACT_ARGUMENTS_REQUIRED');
  const result=prepare({authorization:argv[1],authorizationSha256:argv[3]});
  console.log(JSON.stringify(result));return 0;
 }catch{console.error('NOT_RUN: AUTHENTICATED_JOB_PREPARATION_REFUSED');return 78;}
}
if(require.main===module)process.exitCode=main(process.argv.slice(2));
module.exports={builderEnvironment,validateBindings,prepare,main};
