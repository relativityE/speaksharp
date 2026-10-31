#!/usr/bin/env node
'use strict';
// Run the existing guarded campaign in the SAME credentialed job. No account creation, arbitrary
// command, cloud dispatch, secret-store query or mutation endpoint is exposed by this launcher.
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto'),{spawn}=require('node:child_process');
const {createProducer,startBroker,assertJobReceipt,capabilityBinding}=require('./authenticated-job-producer.cjs');
const {sha}=require('./existing-runner-projection.cjs');
const {validateProducerBinding}=require('./producer-evidence.cjs');
const {selectedOrder}=require('./campaign-core.cjs');
const {probeTransport}=require('../../draft-adapters/receivers/github-job-evidence-reader.cjs');
function validatePlanProducers(plan,scope,configs,producer){
 const actual=capabilityBinding(scope,producer.job),selected=selectedOrder(plan);
 const expectedCases=plan.cases.filter(c=>selected.includes(c.id)&&['AHT-01','AHT-02','AHT-03','AHT-07','AHT-08'].includes(c.id)).map(c=>c.id).sort();
 if(JSON.stringify(expectedCases)!==JSON.stringify([...scope.caseIds].sort())||configs.length!==scope.caseIds.length)throw new Error('NOT_RUN: PRODUCER_SELECTED_CASES_DIFFER');
 const receiverFile=path.resolve(__dirname,'../../draft-adapters/receivers/github-job-evidence-reader.cjs');
 for(const c of plan.cases.filter(c=>expectedCases.includes(c.id)))if(typeof c.producerReceiverFile!=='string'||path.resolve(c.producerReceiverFile)!==receiverFile)throw new Error('NOT_RUN: PRODUCER_RECEIVER_PATH_DIFFERS');
 for(const {caseId,config}of configs){
  const entry=actual.caseRoles.find(c=>c.caseId===caseId);
  if(!entry||config.caseId!==caseId||config.campaignId!==scope.campaignId||config.account?.id!==scope.ownerAccountId||config.sourceSha!==scope.sourceSha||config.servedSha!==scope.servedSha)throw new Error('NOT_RUN: PRODUCER_CONFIG_SCOPE_DIFFERS');
  if(JSON.stringify(Object.keys(config.privateEvidenceProducers||{}).sort())!==JSON.stringify([...entry.roles].sort()))throw new Error('NOT_RUN: PRODUCER_ROLE_SET_DIFFERS');
  for(const role of entry.roles){const b=validateProducerBinding(role,config.privateEvidenceProducers[role]);
   for(const key of ['producerIdentity','producerCodeSha256','receiverSourceSha256','reviewReference'])if(b[key]!==actual[key])throw new Error('NOT_RUN: PRODUCER_ACTUAL_INSTANCE_DIFFERS');
   if(b.deliveryKind!=='reviewed-authenticated-workflow-artifact')throw new Error('NOT_RUN: PRODUCER_DELIVERY_KIND_DIFFERS');
  }
 }
 if(new Set(configs.map(c=>c.caseId)).size!==scope.caseIds.length)throw new Error('NOT_RUN: PRODUCER_CONFIG_CASES_DIFFER');
 return sha(JSON.stringify(actual));
}
async function probeBroker(bindingSha256,socketPath,{now=Date.now,probe=probeTransport}={}){
 const request={kind:'same-job-capability-probe',nonce:randomBytes(16).toString('hex'),bindingSha256,requestedAt:new Date(now()).toISOString()};
 const receipt=await probe(request,{socketPath});
 if(!receipt||Object.keys(receipt).sort().join(',')!=='bindingSha256,configured,kind,nonce,producedAt,remoteReadProven'||receipt.kind!=='same-job-capability-receipt'||receipt.nonce!==request.nonce||receipt.bindingSha256!==bindingSha256||receipt.configured!==true||receipt.remoteReadProven!==false||!Number.isFinite(Date.parse(receipt.producedAt))||Date.parse(receipt.producedAt)<Date.parse(request.requestedAt)||Date.parse(receipt.producedAt)>now())throw new Error('NOT_RUN: PRODUCER_PROBE_RECEIPT_DIFFERS');
 return receipt;
}
async function spawnAfterProducerProbe(bindingSha256,socketPath,spawnCampaign,options){
 await probeBroker(bindingSha256,socketPath,options);
 return spawnCampaign();
}
function privateJson(file,expected){
 const absolute=path.resolve(file),st=fs.lstatSync(absolute),parent=path.dirname(absolute),ps=fs.lstatSync(parent);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||fs.realpathSync(absolute)!==absolute||!ps.isDirectory()||(ps.mode&0o777)!==0o700||ps.uid!==process.getuid())throw new Error('NOT_RUN: PRIVATE_BOUND_INPUT_REQUIRED');
 const bytes=fs.readFileSync(absolute);if(!/^[a-f0-9]{64}$/.test(expected||'')||sha(bytes)!==expected)throw new Error('NOT_RUN: PRIVATE_INPUT_HASH_DIFFERS');return JSON.parse(bytes);
}
function driverEnvironment(env,socketPath){
 const clean={SPEAKSHARP_EVIDENCE_SOCKET:socketPath};
 for(const k of ['PATH','HOME','TMPDIR','HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy','LANG','LC_ALL','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','THROWAWAY_TEST_EMAIL','THROWAWAY_TEST_PASSWORD','FREE_TEST_EMAIL','FREE_TEST_PASSWORD','PRO_TEST_EMAIL','PRO_TEST_PASSWORD'])if(env[k]!==undefined)clean[k]=env[k];
 return clean;
}
async function main(argv){
 let broker=null,child=null,timer=null;const signals=[];
 try{
  const args={};if(argv.length!==8)throw new Error('NOT_RUN: EXACT_BOUND_ARGUMENTS_REQUIRED');
  for(let i=0;i<argv.length;i+=2){if(!['--scope','--scope-sha256','--plan','--plan-sha256'].includes(argv[i])||Object.hasOwn(args,argv[i]))throw new Error('NOT_RUN: UNKNOWN_OR_REPEATED_ARGUMENT');args[argv[i]]=argv[i+1];}
  const scope=privateJson(args['--scope'],args['--scope-sha256']),plan=privateJson(args['--plan'],args['--plan-sha256']);
  if(plan.campaignId!==scope.campaignId||plan.sourceSha!==scope.sourceSha||plan.servedSha!==scope.servedSha||plan.deadlineAt!==scope.deadlineAt)throw new Error('NOT_RUN: CAMPAIGN_PRODUCER_SCOPE_DIFFERS');
  const cases=plan.cases.filter(c=>scope.caseIds.includes(c.id));if(cases.length!==scope.caseIds.length)throw new Error('NOT_RUN: PRODUCER_CASE_BINDING_MISSING');
  const configs=cases.map(c=>({caseId:c.id,config:privateJson(c.configFile,c.configSha256)}));
  const producer=createProducer({scope}),admission=privateJson(plan.admissionConfigFile,plan.admissionConfigSha256),attestation=privateJson(admission.runtimeAttestationFile,admission.runtimeAttestationSha256);
  require('./runtime-selection.cjs').validateGitHubSelection(attestation,admission,Date.now());assertJobReceipt(attestation,producer.job);
  const bindingSha256=validatePlanProducers(plan,scope,configs,producer);
  const directory=fs.realpathSync(path.dirname(args['--scope']));broker=await startBroker({directory,producer});
  child=await spawnAfterProducerProbe(bindingSha256,broker.socketPath,()=>spawn(process.execPath,[path.join(__dirname,'campaign-runner.cjs'),'--plan',path.resolve(args['--plan']),'--plan-sha256',args['--plan-sha256'],'--execute-r0','true'],{stdio:'inherit',env:driverEnvironment(process.env,broker.socketPath)}));
  for(const signal of ['SIGINT','SIGTERM']){const fn=()=>child.kill(signal);process.on(signal,fn);signals.push([signal,fn]);}
  timer=setTimeout(()=>child.kill('SIGTERM'),Math.max(1,Date.parse(scope.deadlineAt)-Date.now()));timer.unref();
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>resolve(Number.isInteger(code)?code:78));});
  console.log(JSON.stringify({kind:'same-job-producer-counts',...producer.stats(),rawRowsRetained:false}));return exit;
 }catch{console.error('NOT_RUN: SAME_JOB_CAMPAIGN_UNAVAILABLE');return 78;}
 finally{if(timer)clearTimeout(timer);for(const [signal,fn]of signals)process.off(signal,fn);if(broker)await broker.close();}
}
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;});
module.exports={main,privateJson,driverEnvironment,validatePlanProducers,probeBroker,spawnAfterProducerProbe};
