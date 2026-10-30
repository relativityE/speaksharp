#!/usr/bin/env node
'use strict';
// Run the existing guarded campaign in the SAME credentialed job. No account creation, arbitrary
// command, cloud dispatch, secret-store query or mutation endpoint is exposed by this launcher.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {createProducer,startBroker}=require('./authenticated-job-producer.cjs');
const {sha}=require('./existing-runner-projection.cjs');
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
  for(const c of cases){const config=privateJson(c.configFile,c.configSha256);if(config.account?.id!==scope.ownerAccountId)throw new Error('NOT_RUN: PRODUCER_ACCOUNT_DIFFERS');}
  const producer=createProducer({scope}),directory=fs.realpathSync(path.dirname(args['--scope']));broker=await startBroker({directory,producer});
  child=spawn(process.execPath,[path.join(__dirname,'campaign-runner.cjs'),'--plan',path.resolve(args['--plan']),'--plan-sha256',args['--plan-sha256'],'--execute-r0','true'],{stdio:'inherit',env:driverEnvironment(process.env,broker.socketPath)});
  for(const signal of ['SIGINT','SIGTERM']){const fn=()=>child.kill(signal);process.on(signal,fn);signals.push([signal,fn]);}
  timer=setTimeout(()=>child.kill('SIGTERM'),Math.max(1,Date.parse(scope.deadlineAt)-Date.now()));timer.unref();
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>resolve(Number.isInteger(code)?code:78));});
  console.log(JSON.stringify({kind:'same-job-producer-counts',...producer.stats(),rawRowsRetained:false}));return exit;
 }catch{console.error('NOT_RUN: SAME_JOB_CAMPAIGN_UNAVAILABLE');return 78;}
 finally{if(timer)clearTimeout(timer);for(const [signal,fn]of signals)process.off(signal,fn);if(broker)await broker.close();}
}
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;});
module.exports={main,privateJson,driverEnvironment};
