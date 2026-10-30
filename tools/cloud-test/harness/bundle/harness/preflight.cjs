#!/usr/bin/env node
'use strict';
// Offline inventory and integrity check ONLY. No sockets, credential reads, browser or subprocess.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function verifyManifest(root,file) {
  const lines=fs.readFileSync(path.join(root,file),'utf8').trim().split('\n'); const errors=[];
  for(const line of lines) {
    const m=/^([a-f0-9]{64})  ([^\n]+)$/.exec(line);
    if(!m || path.isAbsolute(m?.[2]||'') || m?.[2].split('/').includes('..')) {errors.push('invalid manifest entry');continue;}
    const p=path.join(root,m[2]);
    try {if(fs.lstatSync(p).isSymbolicLink() || !fs.lstatSync(p).isFile() || sha(fs.readFileSync(p))!==m[1]) errors.push(m[2]);} catch {errors.push(m[2]);}
  }
  return {result:errors.length?'FAIL':'PASS',files:lines.length,errors};
}
function preflight(root=path.resolve(__dirname,'..')) {
  const packageRoot=path.resolve(root,'..');
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config/admission.TEMPLATE.json'),'utf8'));
  const policy=JSON.parse(fs.readFileSync(path.join(root,'config/policy.production.TEMPLATE.json'),'utf8'));
  const prompt=fs.readFileSync(path.join(packageRoot,'run-packet/cloud-test-prompt.txt'),'utf8');
  const humans=fs.readFileSync(path.join(packageRoot,'run-packet/human-observations.csv'),'utf8');
  const aht=[...new Set(prompt.match(/AHT-\d{2}/g)||[])].sort();
  const hum=[...new Set(humans.match(/HUM-\d{2}/g)||[])].sort();
  const integrity=verifyManifest(root,'CODE.sha256');
  const scopeOk=aht.length===15 && hum.length===6 && Object.keys(policy.hosts).sort().join(',')==='speaksharp-public.vercel.app,yxlapjuovrsvjswkwnrk.supabase.co';
  const missing=Object.entries(cfg).filter(([k,v])=>!k.startsWith('_')&&v===null).map(([k])=>k);
  return {schemaVersion:1,generatedAt:new Date().toISOString(),result:integrity.result==='PASS'&&scopeOk?'OFFLINE_PREFLIGHT_PASS':'OFFLINE_PREFLIGHT_FAIL',liveAdmission:'BLOCKED_SETUP',productionTrafficSent:0,networkCalls:0,browserLaunched:false,credentials:'NOT_INSPECTED: R0 only',codeManifestSha256:sha(fs.readFileSync(path.join(root,'CODE.sha256'))),integrity,acceptance:{ahtCount:aht.length,aht,humanCount:hum.length,human:hum,originalPacketPreserved:true},observedOfflineNode:process.version,selectedRuntime:{name:'Claude SpeakSharp R4',versionPolicy:cfg.runtimePolicy,observedR0Versions:'NOT_OBSERVED',qualification:'NOT_RUN'},unboundAdmissionFields:missing,remainingBlockers:[
    'Owner approved one R0 campaign plus preflight (Sentinel_4f104c59788481918f3678505a6c019d); exact reviewed-byte/window/host binding and R0 admission remain pending. No substitute execution.',
    'Current browser/wrapper/guard/redirect/fault/private-media end-to-end qualification has NOT_RUN in selected R0 runtime; historical 103/103 is not current evidence.',
    'Normal-TLS fallback supports only the explicitly authorized bounded identity read; browser journeys/redirects/Lighthouse remain HARNESS_LIMITED.',
    'Selected source/tree/lock, served full-SHA marker, backend/config/model identity and source-reviewed policy paths are not jointly bound.',
    'Existing test-account access/effective features, exact no-cost provider attempt contract, finite traffic/take/coaching caps and UTC window are not established.',
    'Rev5 implements the three former required groups and full Claude review repairs offline; final source revalidation, producer/account bindings and R0 safety qualification still block admission. No all15 live PASS is claimed.',
    'PG01/PG02/PG03/PG04 product changes must be qualified/deployed/verified before launch; candidate source is not served proof.',
    'Trusted step/dependency/oracle loader and counted readback are implemented; actual reviewed modules, exact selected-source save identity and same-operation readback query are unbound. Native Node is not network-sandboxed.',
    'Private reviewed media source supports current UID and explicit65534 transfer of fresh0700/0600 nodes without permission widening. Actual R0 playback/readability/cleanup qualification is NOT_RUN.',
    'Six human observations and genuinely paid checkout remain separate NOT_RUN; no paid effects authorized at $0.'
  ],claim:'Source/control-logic repairs only. No product assertion, account access, deployment, model download or runtime GO is claimed.'};
}
if(require.main===module) {
  const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
  try {const r=preflight(); if(a.out) {const p=path.resolve(a.out);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n',{mode:0o600});} console.log(JSON.stringify(r,null,2));process.exitCode=r.result==='OFFLINE_PREFLIGHT_PASS'?0:1;}
  catch(e){console.error('OFFLINE_PREFLIGHT_FAIL: '+e.message);process.exitCode=1;}
}
module.exports={preflight,verifyManifest};
