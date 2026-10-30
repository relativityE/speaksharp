#!/usr/bin/env node
'use strict';
// Default: offline preflight only, exit 78. --execute-r0 true enables sequential A0-A7 only
// after actual selected Claude R0 task provenance, approvals and complete evidence bindings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runAdmission}=require('./admission-core.cjs');
const {preflight,verifyManifest}=require('./preflight.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function args(argv){const a={},allowed=new Set(['config','bundle','out','execute-r0']);if(argv.length%2)throw new Error('arguments need explicit values');for(let i=0;i<argv.length;i+=2){const k=argv[i].replace(/^--/,'');if(argv[i]!=='--'+k||!allowed.has(k)||k in a)throw new Error('unknown/repeated argument');a[k]=argv[i+1];}if(a['execute-r0']!==undefined&&!['true','false'].includes(a['execute-r0']))throw new Error('--execute-r0 must be true or false');return a;}
function regular(p){const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(p)!==path.resolve(p))throw new Error('noncanonical evidence file');return p;}
function privateDir(dir){let ancestor=path.resolve(dir);while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);if(fs.lstatSync(ancestor).isSymbolicLink()||!fs.lstatSync(ancestor).isDirectory()||fs.realpathSync(ancestor)!==ancestor)throw new Error('BLOCKED_SETUP: noncanonical output ancestor; no directory created');fs.mkdirSync(dir,{recursive:true,mode:0o700});const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||s.uid!==process.getuid()||fs.realpathSync(dir)!==path.resolve(dir))throw new Error('admission output needs current-owned canonical private 0700 directory');}
function inspectLighthouseCli(file,packageCli){const observed=require('./launch-boundary.cjs').observeExecutable(file);return {lighthouseCliSha256:observed.sha256,lighthouseCliMatches:observed.path===fs.realpathSync(packageCli)};}
function safeEnv(){const out={};for(const k of ['PATH','HOME','TMPDIR','HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy','LANG','LC_ALL'])if(process.env[k]!==undefined)out[k]=process.env[k];out.COREPACK_ENABLE_NETWORK='0';out.COREPACK_ENABLE_AUTO_PIN='0';return out;}
function supervisedCommand(cmd,argv,options,deps={}){
  // Own one isolated process group; never signal unrelated browser/system processes.
  const spawn=deps.spawn||require('node:child_process').spawn,owner=deps.owner||process;
  const kill=deps.killGroup||((pid,sig)=>process.kill(-pid,sig));
  const env=deps.env||safeEnv();const grace=Math.max(1,Math.min(5000,(options.cleanupReserveMs||10000)/2));
  return new Promise(resolve=>{
    let child,closed=false,settled=false,forced=null,stdout='',stderr='',killTimer,finalTimer,poll;
    const parent=owner.ppid;
    const alive=()=>{if(!child?.pid)return false;try{kill(child.pid,0);return true;}catch{return false;}};
    const cleanup=()=>{clearTimeout(deadline);clearTimeout(killTimer);clearTimeout(finalTimer);clearInterval(poll);for(const[s,fn]of signals)owner.removeListener(s,fn);};
    const finish=(status,extra={})=>{if(settled)return;settled=true;cleanup();resolve({status:forced?.code??status,stdout,stderr,reason:forced?.reason||null,...extra});};
    const stop=(reason,code)=>{
      if(forced||settled)return;forced={reason,code};
      try{if(child?.pid)kill(child.pid,'SIGTERM');}catch{}
      killTimer=setTimeout(()=>{try{if(child?.pid)kill(child.pid,'SIGKILL');}catch{}},grace);
      finalTimer=setTimeout(()=>finish(code,{cleanupIncomplete:alive()}),2*grace);
    };
    const signals=[['SIGTERM',15],['SIGINT',2],['SIGHUP',1]].map(([s,n])=>[s,()=>stop('signal:'+s,128+n)]);
    for(const[s,fn]of signals)owner.on(s,fn);
    const deadline=setTimeout(()=>stop('command-deadline',124),options.timeout);
    poll=setInterval(()=>{if(owner.ppid!==parent)stop('parent-lost',5);if(closed&&forced&&!alive())finish(forced.code,{cleanupIncomplete:false});},Math.min(100,grace));
    try{child=spawn(cmd,argv,{cwd:options.cwd,env,detached:true,stdio:['ignore','pipe','pipe']});}
    catch{finish(127,{spawnError:true});return;}
    const capture=(kind,bytes)=>{const value=String(bytes);if(kind==='stdout')stdout+=value;else stderr+=value;if(stdout.length+stderr.length>16*1024*1024){stdout=stdout.slice(0,1024);stderr='';stop('command-output-limit',78);}};
    child.stdout?.on('data',b=>capture('stdout',b));child.stderr?.on('data',b=>capture('stderr',b));
    child.once('error',()=>{if(!forced)forced={reason:'spawn-error',code:127};});
    child.once('close',(code,signal)=>{closed=true;if(alive()){stop('owned-descendants-remain',78);}else finish(code,{signal:signal||null,cleanupIncomplete:false});});
  });
}
function adapter(out){
  const readJson=p=>JSON.parse(fs.readFileSync(regular(p),'utf8'));
  let interrupted=null;
  const command=async(cmd,argv,options={})=>{if(interrupted)return{status:interrupted.status,reason:'admission-cancelled',stdout:'',stderr:''};const r=await supervisedCommand(cmd,argv,options);if(r.reason?.startsWith('signal:')||r.reason==='parent-lost')interrupted=r;return r;};
  const writePrivate=(name,value)=>{privateDir(out);const file=path.join(out,name),bytes=JSON.stringify(value,null,2)+'\n',tmp=file+'.tmp-'+process.pid+'-'+crypto.randomBytes(8).toString('hex');const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);const d=fs.openSync(out,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}return{file,sha256:sha(bytes)};};
  return {now:Date.now,nodeExecutable:process.execPath,offlinePreflight:preflight,readJson,hashFile:p=>sha(fs.readFileSync(regular(p))),command,readEnvironment:()=>({...process.env}),
    validateOperatorPaths:(c,bundle,output)=>require('./operator-paths.cjs').validateOperatorPaths({checkoutDir:c.checkoutDir,packetRoot:path.resolve(bundle,'..'),output,privateInputs:[c.policyFile,c.securityApprovalFile,c.reviewedStepManifest,c.qualificationStepManifest,c.runtimeAttestationFile,c.providerAttemptContractEvidence.file,c.campaignLedger,c.identityLedger]}),
    initializeCampaignLedger:(file,caps)=>require('./campaign-ledger.cjs').Ledger.initialize(file,caps),validatePolicy:p=>require('./guard-proxy.cjs').validatePolicy(p),validateApproval:(...a)=>require('./approval-gate.cjs').validateSecurityApproval(...a),verifyCode:root=>verifyManifest(root,'CODE.sha256'),
    verifyStepManifest:(file,digest,root)=>{const m=readJson(file);if(!Array.isArray(m.steps)||!m.steps.length)throw new Error('reviewed step manifest empty');for(const s of m.steps)require('./reviewed-step.cjs').verifyReviewedStep({manifestFile:file,expectedManifestSha256:digest,stepRoot:root,stepFile:path.resolve(root,s.path)});},
    hashSafeEvidence:(root,relative)=>{const file=path.resolve(root,relative);if(!file.startsWith(path.resolve(root)+path.sep))throw new Error('qualification evidence outside output');return sha(fs.readFileSync(regular(file)));},
    writeReceipt:r=>writePrivate('admission-receipt.json',r),
    writeCommandEvidence:r=>({...writePrivate(r.stage+'.command.private.json',r),exitCode:r.exitCode,signal:r.signal,reason:r.reason,cleanupIncomplete:r.cleanupIncomplete}),
    inspectTools:async(c,timeout)=>{
      const pkg=name=>{const p=require.resolve(name+'/package.json',{paths:[c.checkoutDir]});return {path:p,json:readJson(p)};};
      const pw=pkg('playwright'),pc=pkg('playwright-core'),lh=c.lighthouseSelection==='required'?pkg('lighthouse'):null;
      const browsers=readJson(path.join(path.dirname(pc.path),'browsers.json')).browsers,chromium=browsers.find(b=>b.name==='chromium');
      const toolDeadline=Math.min(Date.now()+timeout,Date.parse(c.approvedDeadlineAt)-c.cleanupReserveMs);
      const versionCommand=(cmd,argv)=>{const left=toolDeadline-Date.now();return left>0?command(cmd,argv,{cwd:c.checkoutDir,timeout:left,cleanupReserveMs:c.cleanupReserveMs}):Promise.resolve({status:124,stdout:'',reason:'tool-inspection-deadline'});};
      const pv=await versionCommand('pnpm',['--version']);const available=async(cmd,argv)=>(await versionCommand(cmd,argv)).status===0;
      return {node:process.version.replace(/^v/,''),pnpm:pv.status===0?String(pv.stdout||'').trim():null,playwright:pw.json.version,chromiumRevision:chromium?'chromium-'+chromium.revision:null,lighthouse:lh?lh.json.version:null,lighthouseResult:lh?'SELECTED_NOT_YET_QUALIFIED':'NOT_RUN',
        ...(lh?inspectLighthouseCli(c.lighthouseCli,path.join(path.dirname(lh.path),'cli/index.js')):{lighthouseCliSha256:null,lighthouseCliMatches:false}),opensslAvailable:await available('openssl',['version']),setprivAvailable:await available('setpriv',['--version']),curlAvailable:await available('curl',['--version'])};
    }
  };
}
async function main(argv){try{const a=args(argv),bundle=path.resolve(a.bundle||path.join(__dirname,'..')),execute=a['execute-r0']==='true';if(execute&&(!a.config||!a.out))throw new Error('explicit R0 execution requires --config and --out');const out=a.out?path.resolve(a.out):null;
  // Default offline path does not read supplied config or inspect credential/environment values.
  const config=execute?JSON.parse(fs.readFileSync(regular(path.resolve(a.config)),'utf8')):null;
  if(execute)require('./operator-paths.cjs').validateOperatorPaths({checkoutDir:fs.realpathSync(config.checkoutDir),packetRoot:path.resolve(bundle,'..'),output:out,privateInputs:[path.resolve(a.config)]});
  const result=await runAdmission({config,bundle,out,executeR0:execute},adapter(out));console.log(JSON.stringify(result.receipt,null,2));return result.exitCode;
}catch(e){console.error('BLOCKED_SETUP: '+e.message);return 78;}}
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;});
module.exports={main,args,adapter,supervisedCommand,inspectLighthouseCli};
