#!/usr/bin/env node
// Orchestration and aggregation only. The shipping WER evaluator and passive collector own scoring/proof.
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { LIMITS, validateApproval, requireCompatibleBackend, canonicalCaseReceipts } from './comparisonBounds.ts';
import { readProductCampaign, verifyCampaignPackages } from '../../scripts/model-evaluator/product-campaign.ts';
import { verifyProjectRuntimeBindings } from '../../scripts/model-evaluator/runtime-bindings.mjs';
import { createCleanupBarrier, awaitOwnedCleanup, signalOwnedGroups, groupState } from './ownedCleanup.mjs';
import { chromium } from 'playwright';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (process.version !== 'v22.12.0') throw Error('bounded_requires_frozen_node_22_12_0');
const approval = JSON.parse(await readFile(process.env.EVAL_EXECUTION_APPROVAL_FILE || '', 'utf8'));
validateApproval(approval, Date.now());
const campaign = readProductCampaign(root,process.env.EVAL_CAMPAIGN_FILE);
if(campaign.sha256!==approval.campaignSha256||campaign.takes!==approval.takes)throw Error('bounded_campaign_binding_mismatch');
await verifyCampaignPackages(campaign.candidates);
const priorRows=[];
if(approval.resume){
  const bytes=await readFile(process.env.EVAL_RESUME_RECEIPT||'');
  if(createHash('sha256').update(bytes).digest('hex')!==approval.resume.receiptSha256)throw Error('bounded_resume_receipt_binding_mismatch');
  const retained=JSON.parse(bytes.toString());
  if(!Array.isArray(retained.rows)||retained.rows.length!==approval.resume.priorCaseKeys.length)throw Error('bounded_resume_population_invalid');
  const allowedSessions=new Set(approval.resume.priorSessionIds.map(id=>createHash('sha256').update(id).digest('hex')));const observedSessions=new Set();
  for(let i=0;i<retained.rows.length;i++){
    const row=retained.rows[i];
    if(row.measured!==false||`${row.candidate}:${row.trial}:${row.clip}`!==approval.resume.priorCaseKeys[i]
      ||(row.sessionSha256!==null&&!allowedSessions.has(row.sessionSha256)))throw Error('bounded_resume_subject_mismatch');
    if(row.sessionSha256===null&&(row.failurePhase!=='candidate-selection'||row.budget?.mutationRequests!==0))throw Error('bounded_resume_unproven_no_session');
    if(approval.resume.retryCaseKeys?.includes(approval.resume.priorCaseKeys[i])&&row.sessionSha256!==null)throw Error('bounded_retry_consumed_recording_refused');
    if(row.sessionSha256!==null){if(observedSessions.has(row.sessionSha256))throw Error('bounded_resume_duplicate_session');observedSessions.add(row.sessionSha256);}
    priorRows.push(row);
  }
  if(observedSessions.size!==allowedSessions.size)throw Error('bounded_resume_missing_owned_session');
}
if (!process.env.SPEAKSHARP_INTERLOCK_HELD || process.env.SPEAKSHARP_INTERLOCK === 'off'
  || process.env.GITHUB_ACTIONS === 'true') throw Error('bounded_requires_shared_host_lock');
if(process.cwd()!=='/Users/fibonacci/Documents/Codex/2026-10-29')throw Error('bounded_requires_fixed_coordinator_cwd');
for (const name of ['EVAL_TEST_EMAIL','EVAL_TEST_PASSWORD','EVAL_SOURCE_ROOT','EVAL_RELEASE_SHA',
  'EVAL_SOURCE_DELTA_SHA256','EVAL_SOURCE_UNTRACKED_SHA256','EVAL_PRIVATE_OUTPUT','EVAL_ASSET_CACHE_RECEIPT',
  'EVAL_APP_URL','EVAL_API_ORIGIN','VITE_SUPABASE_ANON_KEY','EVAL_BACKEND_CONTRACT_RECEIPT']) {
  if (!process.env[name]) throw Error('bounded_missing_input:'+name);
}
const contractBytes=await readFile(process.env.EVAL_BACKEND_CONTRACT_RECEIPT);
if(createHash('sha256').update(contractBytes).digest('hex')!==approval.backendContractSha256)throw Error('bounded_backend_contract_binding_mismatch');
requireCompatibleBackend(JSON.parse(contractBytes.toString()),approval,campaign.campaign.candidates);
await verifyProjectRuntimeBindings(root);
if(resolve(process.env.EVAL_SOURCE_ROOT)!==root || process.env.EVAL_APP_URL!==approval.appOrigin
  || process.env.EVAL_API_ORIGIN!==approval.apiOrigin
  || execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==approval.sourceHead)throw Error('bounded_serving_binding_mismatch');
const output = resolve(process.env.EVAL_PRIVATE_OUTPUT);
if (output.startsWith(root + '/') || output === root) throw Error('bounded_output_must_be_private_outside_source');
await mkdir(output, { mode: 0o700 }); // fresh path required; no overwrite
const childOutput = join(output, 'playwright');
const env = {...process.env, EVAL_PRIVATE_OUTPUT: childOutput};
const app=new URL(approval.appOrigin);
const reservation=createServer();
await new Promise((resolve,reject)=>{reservation.once('error',()=>reject(Error('bounded_app_port_occupied')));reservation.listen(Number(app.port),app.hostname,resolve);});
await new Promise(resolve=>reservation.close(resolve));
let child;
let server;
let browserServer;
let timedOut=false;
let terminationTimer;
let stopping=false;
const workloads=[];
const terminals=[];
let ownershipComplete=true;
const cleanupBarrier=await createCleanupBarrier(process.cwd(),approval.runId);
const launch=(args,options)=>{
  if(stopping)throw Error('bounded_cancelled_before_launch');
  const processChild=spawn(process.execPath,args,{detached:true,...options});workloads.push(processChild);
  const terminal=new Promise(resolve=>{processChild.once('exit',(code,signal)=>resolve({code,signal}));
    processChild.once('error',()=>resolve({code:1,signal:null}));});terminals.push(terminal);return {processChild,terminal};
};
const terminate=()=>{
  if(stopping)return;
  stopping=true;
  signalOwnedGroups(workloads,'SIGTERM');
  terminationTimer ??= setTimeout(()=>signalOwnedGroups(workloads,'SIGKILL'),5000);
};
process.on('SIGINT',terminate); process.on('SIGTERM',terminate); process.on('SIGHUP',terminate);
const timer=setTimeout(()=>{timedOut=true;terminate();},Math.min(LIMITS.wholeRunMs,Date.parse(approval.expiresAt)-Date.now()));
let terminal={code:1,signal:null};
let startupFailure=null;
try {
  server=launch([join(root,'node_modules/vite/bin/vite.js'),'--host',app.hostname,'--port',app.port,'--strictPort','--mode','development','--logLevel','error'],
    {cwd:join(root,'frontend'),stdio:'ignore',env:{...env,BUILD_ID:approval.sourceHead,VITE_INTERNAL_BUILD:'true',VITE_AUTH_MODE:'real',
      VITE_USE_MOCK_AUTH:'false',VITE_TEST_MODE:'false',VITE_SKIP_MSW:'true',VITE_SUPABASE_URL:approval.apiOrigin,
      VITE_POSTHOG_KEY:'',VITE_SENTRY_DSN:''}});
  let ready=false;
  for(let attempt=0;attempt<120&&!stopping;attempt++){
    if(server.processChild.exitCode!==null)break;
    try {const response=await globalThis.fetch(approval.appOrigin+'/auth/signin',{redirect:'error',signal:globalThis.AbortSignal.timeout(1000)});
      if(response.ok&&(await response.text()).includes(approval.sourceHead)){ready=true;break;}}catch{/* bounded readiness only */}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready||stopping||server.processChild.exitCode!==null)throw Error('bounded_source_server_not_ready');
  // Own Chrome explicitly rather than losing its separate process group behind the Playwright fixture.
  ownershipComplete=false;
  browserServer=await chromium.launchServer({channel:'chrome',headless:false,chromiumSandbox:true,timeout:30_000,
    args:['--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const browserProcess=browserServer.process();if(!browserProcess?.pid)throw Error('bounded_browser_ownership_unknown');
  workloads.push(browserProcess);
  if(groupState(browserProcess.pid)!=='live')throw Error('bounded_browser_group_not_verifiable');
  ownershipComplete=true;
  if(stopping)throw Error('bounded_cancelled_before_product_child');
  child=launch(['--import',join(root,'node_modules/tsx/dist/loader.mjs'),join(root,'node_modules/@playwright/test/cli.js'),'test','--config='+join(root,'tests/model-dropin/playwright.in-app.config.ts')],
    {cwd:root,env:{...env,EVAL_BROWSER_WS_ENDPOINT:browserServer.wsEndpoint()},stdio:'inherit'});
  terminal=await child.terminal;
}catch{startupFailure='bounded_source_server_or_child_start_failed';}
finally{
  terminate();clearTimeout(timer);clearTimeout(terminationTimer);
  await awaitOwnedCleanup(workloads,cleanupBarrier,{ownershipComplete:()=>ownershipComplete});
  await Promise.all(terminals);await browserServer?.close();
}
process.off('SIGINT',terminate);process.off('SIGTERM',terminate);process.off('SIGHUP',terminate);
async function files(dir) { const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]); const found=[];
  for(const e of entries) {const path=join(dir,e.name);if(e.isDirectory())found.push(...await files(path));else found.push(path);}return found; }
const canonical=[];
for(const path of await files(childOutput)) if(/\/attachments\/independent-app-comparison\.json$/.test(path)) {
  const row=JSON.parse(await readFile(path,'utf8'));
  if(row.scope?.startsWith('SpeakSharp Open Mic'))canonical.push({path,row});
}
const rows=[...priorRows,...canonicalCaseReceipts(canonical)];
const expected = new Set(); for(let trial=1;trial<=campaign.corpus.trials;trial++)for(const clip of campaign.corpus.clips)for(const model of campaign.campaign.candidates)expected.add(`${model}:${trial}:${clip.id}`);
let complete = rows.length === campaign.takes;
for(const row of rows) {
  const key=`${row.candidate}:${row.trial}:${row.clip}`;
  if(!expected.delete(key)||row.campaignSha256!==campaign.sha256||row.runId!==approval.runId||row.releaseSha!==approval.sourceHead||row.driverSha256!==approval.driverSha256||!row.measured
    ||row.productEvidence?.productProof?.verdict!=='PASS'||row.budget?.failures?.length) complete=false;
}
const summary={mode:'product-lifecycle',campaignSha256:campaign.sha256,runId:approval.runId,sourceHead:approval.sourceHead,terminal,timedOut,startupFailure,cleanupVerified:true,
  status:complete&&!expected.size&&!timedOut&&terminal.code===0?'MEASURED_PRODUCT_COMPARISON':'INCOMPLETE_OR_FAILED',
  qualification:'HOLD',qualifiedPackages:[],attemptedRows:rows.length,expectedRows:campaign.takes,models:{},
  limits:['single_synthetic_speaker','acoustic_labels_unverified','no_promotion_policy','Focus_NOT_RUN',
    'coaching_NOT_RUN','memory_NOT_RUN','isolated_cold_warm_NOT_RUN','weights_not_introspected',
    'init_includes_cache_probe_pinning_warmup','read_and_reopen_are_harness_observed_wall_time']};
const median=values=>{const v=[...values].sort((a,b)=>a-b);return !v.length?null:v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;};
const metric=values=>{const measured=values.filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0);
  return {status:measured.length?'MEASURED':'NOT RUN',samples:measured.length,median:median(measured)};};
for(const model of campaign.campaign.candidates){const all=rows.filter(r=>r.candidate===model);const valid=all.filter(r=>r.measured&&r.productEvidence?.productProof?.verdict==='PASS');
  const words=valid.reduce((n,r)=>n+r.trackA.referenceWords,0);const errors=valid.reduce((n,r)=>n+r.trackA.substitutions+r.trackA.deletions+r.trackA.insertions,0);
  summary.models[model]={attempted:all.length,verified:valid.length,failed:all.length-valid.length,
    pooledWrittenReferenceWer:valid.length===campaign.corpus.trials*campaign.corpus.clips.length&&words?errors/words:null,referenceWordObservations:words,
    observedWrittenReferenceWer:words?errors/words:null,validSampleCount:valid.length,expectedSampleCount:campaign.corpus.trials*campaign.corpus.clips.length,
    substitutions:valid.reduce((n,r)=>n+r.trackA.substitutions,0),deletions:valid.reduce((n,r)=>n+r.trackA.deletions,0),insertions:valid.reduce((n,r)=>n+r.trackA.insertions,0),
    timings:{startToRecordingMs:metric(valid.map(r=>r.startToRecordingMs)),stopToCompletionMs:metric(valid.map(r=>r.stopToCompletionMs)),
      persistedReadRoundTripMs:metric(valid.map(r=>r.persistedReadRoundTripMs)),reopenToTranscriptMs:metric(valid.map(r=>r.reopenToTranscriptMs)),
      selectionWallMs:metric(valid.map(r=>r.selectionWallMs)),
      firstSelectedAcquisitionTotalMs:metric(valid.map(r=>r.acquisitions?.[0]?.totalMs)),
      firstSelectedAcquisitionInitMs:metric(valid.map(r=>r.acquisitions?.[0]?.initMs)),
      finalizeDecodeMs:metric(valid.map(r=>r.privateTiming?.finalizeDecodeMs)),rtf:metric(valid.map(r=>r.privateTiming?.rtf)),
      finalizeWaitMs:metric(valid.map(r=>r.privateTiming?.finalizeWaitMs)),finalizePrepMs:metric(valid.map(r=>r.privateTiming?.finalizePrepMs)),
      firstPartialAfterRecordingMs:metric(valid.map(r=>{const t=r.productEvidence.evidence.timeline;return t.partials.length?Math.min(...t.partials.map(p=>p.atMs))-t.startMs:null;}))},
    memory:'NOT RUN',coldWarmIsolation:'NOT RUN',focus:'NOT RUN',coaching:'NOT RUN'};
}
const verified=rows.filter(row=>row.measured&&row.productEvidence?.productProof?.verdict==='PASS');
const commonKeys=[...new Set(verified.map(row=>`${row.trial}:${row.clip}`))].filter(key=>campaign.campaign.candidates.every(model=>verified.some(row=>row.candidate===model&&`${row.trial}:${row.clip}`===key)));
summary.commonMatchedPopulation={samplesPerModel:commonKeys.length,keys:commonKeys,models:{}};
for(const model of campaign.campaign.candidates){const paired=verified.filter(row=>row.candidate===model&&commonKeys.includes(`${row.trial}:${row.clip}`));
 const words=paired.reduce((n,row)=>n+row.trackA.referenceWords,0);const count=key=>paired.reduce((n,row)=>n+row.trackA[key],0);
 summary.commonMatchedPopulation.models[model]={samples:paired.length,N:words,S:count('substitutions'),D:count('deletions'),I:count('insertions'),wer:words?(count('substitutions')+count('deletions')+count('insertions'))/words:null};
}
await writeFile(join(output,'comparison-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:summary.status,verifiedRows:rows.filter(r=>r.measured).length,expectedRows:campaign.takes}));
process.exitCode=summary.status==='MEASURED_PRODUCT_COMPARISON'?0:1;
