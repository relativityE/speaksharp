#!/usr/bin/env node
'use strict';
// Strict selected-Lighthouse supervisor. No freeform Lighthouse or Chrome override arguments.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {admitQualificationSupervisor}=require('./qualification-gate.cjs');
const {requireRuntimeQualification}=require('./runtime-admission.cjs');
const {startGuard}=require('./guard-proxy.cjs');
const {browserFlags,inspectDescendants,checkSandboxedProcesses}=require('./launch.cjs');
const {childEnvironment,strictPairs,hashExecutable,lighthouseChromeFlags}=require('./launch-boundary.cjs');
const allowed=['browser','policy','run-dir','ledger','lighthouse-cli','lighthouse-cli-sha256','url','max-ms','qualification-local-only','security-approval','runtime-qualification','admission-receipt','admission-receipt-sha256','campaign-id'];
let a;try{a=strictPairs(process.argv.slice(2),allowed,['browser','policy','run-dir','ledger','lighthouse-cli','lighthouse-cli-sha256','url','max-ms','security-approval']);if(!/^\d+$/.test(a['max-ms'])||+a['max-ms']<=0)throw new Error('positive finite max-ms required');if(a['qualification-local-only']&&a['qualification-local-only']!=='true')throw new Error('invalid qualification mode');}catch(e){console.error('lighthouse-run: '+e.message);process.exit(2);}
const policy=JSON.parse(fs.readFileSync(a.policy,'utf8'));
let cli,dispatch;
try{
 cli=hashExecutable(path.resolve(a['lighthouse-cli']),a['lighthouse-cli-sha256']);
 if(a['qualification-local-only']==='true'){
  admitQualificationSupervisor(a,policy);require('./qualification-capabilities.cjs').validateSelectionApproval('required',JSON.parse(fs.readFileSync(a['security-approval'],'utf8')));
  const u=new URL(a.url);if(u.protocol!=='https:'||!policy.hosts[u.hostname]||u.port||u.username||u.password)throw new Error('BLOCKED_SETUP: Lighthouse qualification URL outside fixture');
 }else dispatch=requireRuntimeQualification(a['runtime-qualification'],{requiredCapability:'lighthouse',lighthouseCli:cli.path,lighthouseCliSha256:cli.sha256,admissionReceiptFile:a['admission-receipt'],admissionReceiptSha256:a['admission-receipt-sha256'],campaignId:a['campaign-id'],policyFile:a.policy,ledgerFile:a.ledger,browserFile:a.browser});
}catch(e){console.error(e.message);process.exit(78);}
const b=JSON.parse(fs.readFileSync(a.browser,'utf8'));
const runDir=path.resolve(a['run-dir']);fs.mkdirSync(runDir,{recursive:true,mode:0o700});
const setupAbort=new AbortController();
const parent0=process.ppid;let child=null,guard=null,guardPending=null,stopping=false,stopPromise=null,sampler=null;const samples=[];
async function stop(reason,code){
 if(stopPromise)return stopPromise;stopping=true;setupAbort.abort();
 // Do not exit while startGuard is pending. The eventual handle is owned and closed here.
 stopPromise=(async()=>{
  if(guardPending)try{await guardPending;}catch{}
  try{guard?.cancelAll(reason);}catch{}
  if(sampler)clearInterval(sampler);
  if(child&&child.exitCode===null){try{process.kill(-child.pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,1500));try{process.kill(-child.pid,'SIGKILL');}catch{}}
  for(let i=0;i<50&&inspectDescendants().length;i++){for(const p of inspectDescendants())try{process.kill(p.pid,'SIGKILL');}catch{}await new Promise(r=>setTimeout(r,100));}
  let g=null,cleanupError=false;try{g=guard?await guard.close(reason):null;}catch{cleanupError=true;}
  const priv=checkSandboxedProcesses(samples.flat()),remaining=inspectDescendants().map(p=>({pid:p.pid,name:p.name}));
  const capDenied=Object.entries(g?.counters?.denied||{}).some(([name,count])=>name.startsWith('cap:')&&count>0);
  const finalCode=code===0&&(!priv.ok||remaining.length||cleanupError||g?.fatal||capDenied)?3:code;
  fs.writeFileSync(path.join(runDir,'summary.json'),JSON.stringify({reason,exitCode:finalCode,guard:g,privilege:{...priv,samples:samples.length},ownedProcessesRemaining:remaining,cleanupError,lighthouseCliSha256:cli.sha256},null,2)+'\n',{mode:0o600});
  process.exit(finalCode);
 })();return stopPromise;
}
for(const[sig,n]of [['SIGTERM',15],['SIGINT',2],['SIGHUP',1]])process.on(sig,()=>void stop('signal:'+sig,128+n));
setInterval(()=>{if(process.ppid!==parent0)void stop('parent-lost',5);},500).unref();
const hardMs=Math.min(Number(a['max-ms']),Date.parse(policy.deadlineAt)-Date.now());
if(!(hardMs>0)){console.error('lighthouse-run: deadline already passed');process.exit(4);}
setTimeout(()=>void stop('deadline',4),hardMs).unref();
(async()=>{
 guardPending=startGuard(policy,{signal:setupAbort.signal,runDir,ledgerFile:a.ledger,logFile:path.join(runDir,'guard.jsonl'),securityApprovalFile:a['security-approval'],expectedLedgerIdentity:dispatch?.expectedLedgerIdentity,reserveTake:()=>{const e=new Error('Lighthouse take creation forbidden');e.code='TAKE_CAP';queueMicrotask(()=>void stop('case-take-cap',3));throw e;},onFatal:()=>void stop('guard-fatal',3)}).then(g=>{guard=g;return g;});
 await guardPending;if(stopping)return;
 // Check again at use; selected runtime/admission also binds this observed local executable hash.
 hashExecutable(cli.path,cli.sha256);
 const flags=lighthouseChromeFlags(browserFlags(guard.port,guard.spki).concat(['--headless=new']));
 const lhArgs=[cli.path,a.url,'--output=json','--output-path='+path.join(runDir,'lhr.json'),'--chrome-ignore-default-flags','--chrome-flags='+flags,'--only-categories=performance,accessibility','--max-wait-for-load=20000','--quiet'];
 child=spawn(process.execPath,lhArgs,{env:childEnvironment({node:process.execPath,bundleRoot:path.resolve(__dirname,'..'),approvalFile:path.resolve(a['security-approval']),port:guard.port,spki:guard.spki,chromePath:b.wrapperPath}),stdio:['ignore','pipe','pipe'],detached:true});
 const errLog=fs.createWriteStream(path.join(runDir,'lighthouse.stderr.log'),{mode:0o600});child.stdout.pipe(errLog);child.stderr.pipe(errLog);
 sampler=setInterval(()=>{if(Object.entries(guard.c?.denied||{}).some(([name,count])=>name.startsWith('cap:')&&count>0)){void stop('cap-denied',3);return;}const s=inspectDescendants().filter(p=>p.isChrome);if(s.length)samples.push(s);},250);
 child.on('error',()=>void stop('child-spawn-error',2));child.on('exit',code=>void stop(code===0?'completed':'lighthouse-exit',code===0?0:1));
})().catch(()=>{void stop('setup-error',2);});
