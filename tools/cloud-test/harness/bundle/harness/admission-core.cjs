'use strict';
// Sequential admission with injected IO. Tests never dispatch subprocesses or network requests.
const path=require('node:path');
const {selection,validateSelectionApproval,verifyCapabilityReceipt}=require('./qualification-capabilities.cjs');
const SHA40=/^[a-f0-9]{40}$/,SHA64=/^[a-f0-9]{64}$/;
const RUNTIME='Claude SpeakSharp R4';
const runtimeSelection=require('./runtime-selection.cjs');
const QUALIFICATION_CHECKS=['sandboxProcesses','defaultDenyAllBrowserMechanisms','independentFixtureReconciliation','redirectChains','nativeNodeScopeReview','durableOperationFaults','errorStatusNegativeControl','privateMediaLifecycle','deadlinesCancellationAndCleanup','modelDownloadFaults','cumulativeCapsLedgerAndLocks','environmentProxyDns','feedbackOperationFaults'];
const PAIRS={throwaway:['THROWAWAY_TEST_EMAIL','THROWAWAY_TEST_PASSWORD'],free:['FREE_TEST_EMAIL','FREE_TEST_PASSWORD'],pro:['PRO_TEST_EMAIL','PRO_TEST_PASSWORD']};
const STAGES=['A0.config','A1.bundle','A2.source','A3.tools','A4.credentials','A5.browser','A6.guard-selftest','A7.identity'];
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
function utc(s){if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s))return NaN;const n=Date.parse(s),v=s.includes('.')?s:s.replace(/Z$/,'.000Z');return Number.isFinite(n)&&new Date(n).toISOString()===v?n:NaN;}
function validateConfig(c,now){
  const missing=[];
  try{selection(c.lighthouseSelection);}catch(e){missing.push(e.message);}
  if(c.lighthouseSelection==='required'&&!nonempty(c.lighthouseCli))missing.push('selected lighthouseCli');
  if(c.lighthouseSelection==='not-selected'&&c.lighthouseCli!=null)missing.push('unselected Lighthouse must not bind an executable');
  for(const k of ['campaignId','campaignLedger','checkoutDir','identityLedger','policyFile','securityApprovalFile','reviewedStepManifest','reviewedStepRoot','qualificationStepManifest','privateMediaParent','runtimeAttestationFile','ownerApprovalReference'])if(!nonempty(c[k]))missing.push(k);
  for(const k of ['sourceSha','sourceTree','expectedServedSha'])if(!SHA40.test(c[k]||''))missing.push(k);
  for(const k of ['lockSha256','policySha256','securityApprovalSha256','reviewedStepManifestSha256','qualificationStepManifestSha256','runtimeAttestationSha256'])if(!SHA64.test(c[k]||''))missing.push(k);
  if(!runtimeSelection.supported(c.runtime))missing.push('runtime must be Claude SpeakSharp R4 or GitHub Actions SpeakSharp (not Codex SpeakSharp)');
  if(c.runtimePolicy!=='record-and-qualify-current')missing.push('runtimePolicy must be record-and-qualify-current under current owner scope');
  if(c.expectedSupabaseHost!=='yxlapjuovrsvjswkwnrk.supabase.co'||c.identityUrl!=='https://speaksharp-public.vercel.app/')missing.push('exact approved frontend/backend');
  if(c.sourceSha!==c.expectedServedSha)missing.push('source/served identity reconciliation (no automatic repin)');
  if(!Number.isSafeInteger(c.identityCap)||c.identityCap<1)missing.push('positive approved identityCap');
  if(!Number.isSafeInteger(c.qualificationMaxMs)||c.qualificationMaxMs<1200000||!Number.isSafeInteger(c.cleanupReserveMs)||c.cleanupReserveMs<60000)missing.push('qualificationMaxMs/cleanupReserveMs');
  const start=utc(c.approvedStartAt),end=utc(c.approvedDeadlineAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start)missing.push('current explicitly approved UTC window');
  if(c.costCeilingUsd!==0)missing.push('$0 cost ceiling');
  if(!['prefer-throwaway','throwaway','free','pro'].includes(c.accountSelection))missing.push('accountSelection');
  if(!nonempty(c.publishableKeyVar)||!nonempty(c.supabaseUrlVar)||!Array.isArray(c.requiredCredentialVars)||!Array.isArray(c.forbiddenVars))missing.push('credential variable-name bindings');
  if(!c.providerAttemptContractEvidence||!nonempty(c.providerAttemptContractEvidence.file)||!SHA64.test(c.providerAttemptContractEvidence.sha256||''))missing.push('providerAttemptContractEvidence {file,sha256} for $0 scope');
  if(missing.length)throw new Error('unbound: '+missing.join(', '));
}
function validateRuntimeSelection(r,c,now){
  if(c.runtime===runtimeSelection.GITHUB)return runtimeSelection.validateGitHubSelection(r,c,now);
  // No verified immutable R0 UUID was available during preparation. Never substitute Codex.
  if(!r||r.kind!=='authoritative-claude-task-environment-receipt'||r.platformUrl!=='https://claude.ai/code'||r.environmentSelector!=='SpeakSharp R4'||r.runtime!==RUNTIME||!nonempty(r.taskId)||!nonempty(r.sourceReference)||!/^https:\/\/claude\.ai\//.test(r.sourceReference))throw new Error('authoritative Claude task/environment selection receipt missing; a runtime label alone cannot prove R0');
  if(!Number.isFinite(utc(r.observedAt))||utc(r.observedAt)<utc(c.approvedStartAt)||utc(r.observedAt)>now)throw new Error('Claude selection observation is not in this approved window');
  if(c.runtimeEnvironmentId!=null&&c.runtimeEnvironmentId!==r.immutableEnvironmentId)throw new Error('selected immutable environment ID mismatch');
  if(r.immutableEnvironmentId!=null&&!nonempty(r.immutableEnvironmentId))throw new Error('invalid immutable environment ID');
  return {platformUrl:r.platformUrl,environmentSelector:r.environmentSelector,taskId:r.taskId,immutableEnvironmentId:r.immutableEnvironmentId||null,sourceReference:r.sourceReference,observedAt:r.observedAt,note:'Externally supplied authoritative task receipt; Node cannot independently discover or cryptographically attest the Claude environment.'};
}
function checkCredentials(c,env){
  const allPairNames=Object.values(PAIRS).flat();
  const selected=c.accountSelection==='prefer-throwaway'?Object.keys(PAIRS).find(k=>PAIRS[k].every(n=>nonempty(env[n]))):c.accountSelection;
  const names=selected?PAIRS[selected]:[];
  const absent=[...new Set([...(c.requiredCredentialVars||[]).filter(n=>!allPairNames.includes(n)),c.publishableKeyVar,c.supabaseUrlVar,...names])].filter(n=>!nonempty(env[n]));
  const forbidden=[...new Set(['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY',...(c.forbiddenVars||[])])].filter(n=>nonempty(env[n]));
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0'&&!forbidden.includes('NODE_TLS_REJECT_UNAUTHORIZED'))forbidden.push('NODE_TLS_REJECT_UNAUTHORIZED');
  if(nonempty(env.NODE_OPTIONS)&&!forbidden.includes('NODE_OPTIONS'))forbidden.push('NODE_OPTIONS');
  let role='unrecognized';const key=env[c.publishableKeyVar]||'';
  if(/^sb_publishable_.+/.test(key))role='publishable';else if(/^sb_secret_/.test(key))role='SECRET';else if(key.split('.').length===3){try{const v=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role;role=v==='anon'?'anon':v==='service_role'?'SERVICE_ROLE':'jwt-other';}catch{role='jwt-unreadable';}}
  let hostMatches=false;try{const u=new URL(env[c.supabaseUrlVar]||'');hostMatches=u.protocol==='https:'&&u.hostname===c.expectedSupabaseHost&&!u.port&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;}catch{}
  const ok=!!selected&&names.every(n=>nonempty(env[n]))&&!absent.length&&!forbidden.length&&['anon','publishable'].includes(role)&&hostMatches;
  return {ok,selectedAccountKind:selected||null,selectedVariableNames:names,missingNames:absent,forbiddenPresentNames:forbidden,publishableKeyRole:role,supabaseHostMatches:hostMatches,accountAccess:'NOT_PROVEN',effectiveFeatures:'NOT_PROVEN; never excluded solely by Free tier label',paidCheckout:'NOT_AUTHORIZED ($0)'};
}
function usableRuntime(v,lighthouseSelection='required'){const semver=/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;return !!v&&['node','pnpm','playwright',...(lighthouseSelection==='required'?['lighthouse']:[])].every(k=>semver.test(v[k]||''))&&/^chromium-\d+$/.test(v.chromiumRevision||'');}
function verifyQualification(receipt,{codeManifestSha256,startedAt,endedBy,evidence,expectedRuntime,expectedRuntimeName=RUNTIME,expectedSelection,ownerApprovalReference,requiredCapability='browser-guard'}){
  if(!expectedRuntime||!['node','playwright','chromiumRevision'].every(k=>nonempty(expectedRuntime[k])))throw new Error('actual admitted runtime tuple required for qualification comparison');
  if(!runtimeSelection.supported(expectedRuntimeName)||!receipt||receipt.result!=='PASS'||receipt.runtime!==expectedRuntimeName||['node','playwright','chromiumRevision'].some(k=>receipt[k]!==expectedRuntime[k])||receipt.codeManifestSha256!==codeManifestSha256)throw new Error('qualifier result/actual-runtime/current-code binding mismatch');
  if(expectedSelection==='required'&&(!SHA64.test(expectedRuntime.lighthouseCliSha256||'')||receipt.lighthouseCliSha256!==expectedRuntime.lighthouseCliSha256))throw new Error('qualified Lighthouse CLI bytes differ from admission');
  if(!Number.isFinite(utc(receipt.startedAt))||!Number.isFinite(utc(receipt.endedAt))||utc(receipt.startedAt)<startedAt||utc(receipt.endedAt)<utc(receipt.startedAt)||utc(receipt.endedAt)>endedBy)throw new Error('qualifier receipt stale or times invalid');
  const verifyEvidence=(c,key)=>{if(!SHA64.test(c?.evidenceSha256||'')||!nonempty(c?.evidencePath)||path.isAbsolute(c.evidencePath)||c.evidencePath.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw new Error('qualifier evidence missing: '+key);if(evidence(c.evidencePath)!==c.evidenceSha256)throw new Error('qualifier evidence bytes differ: '+key);};
  for(const key of QUALIFICATION_CHECKS){const c=receipt.checks?.[key];if(c?.result!=='PASS')throw new Error('qualifier evidence missing: '+key);verifyEvidence(c,key);}
  const capabilities=verifyCapabilityReceipt(receipt,{expectedSelection,ownerApprovalReference,requiredCapability,verifyEvidence});
  return {result:'PASS',checks:QUALIFICATION_CHECKS.length,codeManifestSha256,...capabilities};
}
async function runAdmission(options,io){
  const now=()=>io.now();
  if(options.executeR0!==true){const offline=await io.offlinePreflight(options.bundle);return {exitCode:78,receipt:{result:'BLOCKED_SETUP',stage:'OFFLINE_ONLY',offline,productionTrafficSent:0,credentials:'NOT_INSPECTED',reason:'Default is offline only. Explicit R0 execution requires actual Claude task provenance and complete bindings.'}};}
  const c=options.config,B=options.bundle,OUT=options.out;
  const receipt={schemaVersion:3,startedAt:new Date(now()).toISOString(),runtime:c.runtime,steps:STAGES.map(id=>({id,result:'NOT_RUN'})),productionTrafficSent:0,identityDispatch:'NOT_RUN',accountAccess:'NOT_PROVEN',productAcceptance:'NOT_TESTED'};
  const save=()=>io.writeReceipt(receipt);
  const step=async(id,fn)=>{const record=receipt.steps.find(s=>s.id===id);record.startedAt=new Date(now()).toISOString();try{record.detail=await fn();record.result='PASS';}catch(e){record.result='BLOCKED';record.reason=String(e.message);receipt.result='BLOCKED_SETUP';receipt.stage=id;receipt.endedAt=new Date(now()).toISOString();await save();throw e;}record.endedAt=new Date(now()).toISOString();await save();};
  let policy,approval,codeHash,runtimeVariant;
  const hashBound=(file,expected,label)=>{if(io.hashFile(file)!==expected)throw new Error(label+' bytes differ');};
  const remaining=ceiling=>{const available=utc(c.approvedDeadlineAt)-now()-c.cleanupReserveMs;if(available<=0)throw new Error('approved window exhausted (cleanup reserved)');return Math.min(ceiling,available);};
  const command=(cmd,args,opts={})=>io.command(cmd,args,{...opts,cwd:c.checkoutDir,timeout:remaining(opts.timeout||60000),cleanupReserveMs:c.cleanupReserveMs});
  const recordedCommand=async(stage,cmd,args,opts)=>{const startedAt=new Date(now()).toISOString();const r=await command(cmd,args,opts);const record={stage,command:cmd,args,cwd:c.checkoutDir,startedAt,endedAt:new Date(now()).toISOString(),exitCode:r.status??null,signal:r.signal||null,reason:r.reason||null,cleanupIncomplete:r.cleanupIncomplete===true,stdout:String(r.stdout||'').slice(0,4194304),stderr:String(r.stderr||'').slice(0,4194304),environment:'NOT_RECORDED; application-account credential variables excluded'};receipt.commandEvidence||={};receipt.commandEvidence[stage]=await io.writeCommandEvidence(record);return r;};
  try{
    await step('A0.config',async()=>{
      validateConfig(c,now());io.validateOperatorPaths(c,B,OUT);hashBound(c.runtimeAttestationFile,c.runtimeAttestationSha256,'Claude selection receipt');receipt.runtimeSelection=validateRuntimeSelection(io.readJson(c.runtimeAttestationFile),c,now());
      hashBound(c.policyFile,c.policySha256,'policy');policy=io.readJson(c.policyFile);io.validatePolicy(policy);if(policy.testOnly!==undefined&&policy.testOnly!==false)throw new Error('testOnly policy is forbidden for production admission');
      if(policy.deadlineAt!==c.approvedDeadlineAt||Object.keys(policy.hosts).sort().join(',')!=='speaksharp-public.vercel.app,yxlapjuovrsvjswkwnrk.supabase.co')throw new Error('policy deadline/hosts differ from campaign');
      for(const h of Object.values(policy.hosts))for(const rule of h.rules)if(rule.review===true||rule.reviewedSourceSha!==c.sourceSha)throw new Error('policy rule not reviewed against selected source');
      if(policy.caps['account-closure']!==0)throw new Error('account closure must remain capped at zero');
      hashBound(c.securityApprovalFile,c.securityApprovalSha256,'security approval');approval=io.readJson(c.securityApprovalFile);if(approval.ownerApprovalReference!==c.ownerApprovalReference)throw new Error('owner approval reference mismatch');validateSelectionApproval(c.lighthouseSelection,approval);
      hashBound(c.reviewedStepManifest,c.reviewedStepManifestSha256,'reviewed step manifest');hashBound(c.qualificationStepManifest,c.qualificationStepManifestSha256,'qualification step manifest');io.verifyStepManifest(c.reviewedStepManifest,c.reviewedStepManifestSha256,c.reviewedStepRoot);
      hashBound(c.providerAttemptContractEvidence.file,c.providerAttemptContractEvidence.sha256,'provider attempt/$0 contract evidence');
      receipt.binding={lighthouseSelection:c.lighthouseSelection,lighthouseOwnerApprovalReference:c.ownerApprovalReference,campaignId:c.campaignId,campaignLedger:path.resolve(c.campaignLedger),identityLedger:path.resolve(c.identityLedger),identityCap:c.identityCap,runtimePolicy:c.runtimePolicy,sourceSha:c.sourceSha,servedSha:c.expectedServedSha,policySha256:c.policySha256,securityApprovalSha256:c.securityApprovalSha256,approvedStartAt:c.approvedStartAt,approvedDeadlineAt:c.approvedDeadlineAt};
      return {runtimeSelection:receipt.runtimeSelection,window:{start:c.approvedStartAt,deadline:c.approvedDeadlineAt,cleanupReserveMs:c.cleanupReserveMs},costCeilingUsd:0,policySha256:c.policySha256,accountSelection:c.accountSelection};
    });
    await step('A1.bundle',async()=>{const r=io.verifyCode(B);if(r.result!=='PASS')throw new Error('actual CODE manifest/file verification failed');codeHash=io.hashFile(path.join(B,'CODE.sha256'));io.validateApproval(approval,{runtime:c.runtime,codeManifestSha256:codeHash,hosts:[...Object.keys(policy.hosts),'a.test','c.test','d.test']},now());if(!Number.isFinite(utc(approval.notBefore))||!Number.isFinite(utc(approval.expiresAt))||utc(c.approvedStartAt)<utc(approval.notBefore)||utc(c.approvedDeadlineAt)>utc(approval.expiresAt))throw new Error('campaign window extends outside owner approval');receipt.binding.codeManifestSha256=codeHash;return {files:r.files,codeManifestSha256:codeHash};});
    await step('A2.source',async()=>{const git=async args=>{const r=await command('git',['-C',c.checkoutDir,...args]);if(r.status!==0)throw new Error('git source inspection failed');return String(r.stdout||'').trim();};const head=await git(['rev-parse','--verify','HEAD']),tree=await git(['rev-parse','--verify','HEAD^{tree}']),dirty=await git(['status','--porcelain']),lock=io.hashFile(path.join(c.checkoutDir,'pnpm-lock.yaml'));if(head!==c.sourceSha||tree!==c.sourceTree||dirty||lock!==c.lockSha256)throw new Error('source HEAD/tree/clean-worktree/lock mismatch');return {head,tree,clean:true,lockSha256:lock};});
    await step('A3.tools',async()=>{const v=await io.inspectTools(c,remaining(60000));if(!usableRuntime(v,c.lighthouseSelection)||(c.lighthouseSelection==='required'&&(!v.lighthouseCliMatches||!SHA64.test(v.lighthouseCliSha256||'')))||!v.opensslAvailable||!v.setprivAvailable||!v.curlAvailable)throw new Error('current usable tool metadata/browser revision unavailable; no installation or alternate-browser substitution attempted');runtimeVariant=Object.fromEntries(['node','pnpm','playwright','chromiumRevision','lighthouse','lighthouseCliSha256'].map(k=>[k,v[k]]));receipt.binding.runtimeVariant=runtimeVariant;return {...v,policy:'record-and-qualify-current',historicalPinsEnforced:false};});
    await step('A4.credentials',async()=>{const r=checkCredentials(c,io.readEnvironment());if(!r.ok){receipt.credentialCheck=r;throw new Error('credential presence/role/host/global-TLS safety gate failed; see name-only credentialCheck');}receipt.selectedAccountVariableNames=r.selectedVariableNames;return r;});
    const browserFile=path.join(OUT,'browser.json');
    await step('A5.browser',async()=>{const r=await recordedCommand('A5.browser',io.nodeExecutable,[path.join(B,'harness/browser-setup.cjs'),'--playwright',runtimeVariant.playwright,'--revision',runtimeVariant.chromiumRevision,'--security-approval',c.securityApprovalFile,'--out',browserFile],{timeout:180000});if(r.status!==0||r.cleanupIncomplete)throw new Error('approved browser discovery/wrapper check failed: exit '+r.status+' '+(r.reason||'')+'; see private command evidence; no fallback/install');const b=io.readJson(browserFile);if(b.playwrightVersion!==runtimeVariant.playwright||b.revision!==runtimeVariant.chromiumRevision||!SHA64.test(b.chromeSha256||'')||!SHA64.test(b.wrapperSha256||'')||b.runAsUid!==65534)throw new Error('browser differs from recorded current Playwright expected build');Object.assign(runtimeVariant,{chromeSha256:b.chromeSha256,wrapperSha256:b.wrapperSha256,chromeVersion:b.chromeVersion||null});receipt.binding.browserArtifactSha256=io.hashFile(browserFile);return {playwrightVersion:b.playwrightVersion,revision:b.revision,chromeSha256:b.chromeSha256,wrapperSha256:b.wrapperSha256,runAsUid:b.runAsUid};});
    const qualificationOut=path.join(OUT,'qualification'),qualificationFile=path.join(qualificationOut,'qualification-receipt.json');
    await step('A6.guard-selftest',async()=>{if(remaining(c.qualificationMaxMs)<c.qualificationMaxMs)throw new Error('full approved qualification duration plus cleanup no longer fits; no shortened run');const started=now();const r=await recordedCommand('A6.guard-selftest',io.nodeExecutable,[path.join(B,'qualification/selftest.cjs'),'--browser',browserFile,'--out',qualificationOut,'--security-approval',c.securityApprovalFile,'--private-media-parent',c.privateMediaParent,'--lighthouse-selection',c.lighthouseSelection,...(c.lighthouseSelection==='required'?['--lighthouse-cli',c.lighthouseCli,'--lighthouse-cli-sha256',runtimeVariant.lighthouseCliSha256]:[]),'--step-manifest',c.qualificationStepManifest,'--step-manifest-sha256',c.qualificationStepManifestSha256],{timeout:c.qualificationMaxMs});if(r.status!==0||r.cleanupIncomplete)throw new Error('current R0 qualification failed: exit '+r.status+' '+(r.reason||'')+'; see private command evidence; identity GET remains NOT_RUN');const result=verifyQualification(io.readJson(qualificationFile),{codeManifestSha256:codeHash,startedAt:started,endedBy:now(),expectedRuntime:runtimeVariant,expectedRuntimeName:c.runtime,expectedSelection:c.lighthouseSelection,ownerApprovalReference:c.ownerApprovalReference,evidence:relative=>io.hashSafeEvidence(qualificationOut,relative)});receipt.runtimeQualificationReceipt=qualificationFile;receipt.runtimeQualificationSha256=io.hashFile(qualificationFile);receipt.binding.campaignLedgerIdentity=io.initializeCampaignLedger(c.campaignLedger,policy.caps);return result;});
    await step('A7.identity',async()=>{
      if(remaining(25000)<25000)throw new Error('insufficient approved time for bounded identity GET plus cleanup');
      if(io.verifyCode(B).result!=='PASS'||io.hashFile(path.join(B,'CODE.sha256'))!==codeHash||io.hashFile(c.policyFile)!==c.policySha256)throw new Error('helper/policy bytes changed during qualification');
      for(const [args,expected]of [[['rev-parse','--verify','HEAD'],c.sourceSha],[['rev-parse','--verify','HEAD^{tree}'],c.sourceTree],[['status','--porcelain'],'']]){const r=await command('git',['-C',c.checkoutDir,...args]);if(r.status!==0||String(r.stdout||'').trim()!==expected)throw new Error('source changed during qualification');}
      if(io.hashFile(path.join(c.checkoutDir,'pnpm-lock.yaml'))!==c.lockSha256)throw new Error('source lock changed during qualification');
      receipt.identityDispatch='ATTEMPTED_OR_AMBIGUOUS';receipt.productionTrafficSent='UNKNOWN_PENDING_IDENTITY_RECEIPT';await save();
      const r=await command(io.nodeExecutable,[path.join(B,'harness/identity-check.cjs'),'--authorize-identity-read','true','--url',c.identityUrl,'--expect-sha',c.expectedServedSha,'--ledger',c.identityLedger,'--cap',String(c.identityCap),'--phase','admission'],{timeout:25000});
      let id;try{id=JSON.parse(String(r.stdout||'').trim().split('\n').pop());}catch{throw new Error('identity receipt unavailable; outcome ambiguous; no automatic retry');}receipt.identityReceipt=id;
      if(r.status!==0||id.result!=='MATCH'||id.servedSha!==c.expectedServedSha)throw new Error('served identity mismatch; no product journeys admitted');
      receipt.identityDispatch='MATCH';receipt.productionTrafficSent=1;return id;
    });
    receipt.result='ADMISSION PASS';receipt.endedAt=new Date(now()).toISOString();receipt.productAcceptance='NOT_TESTED; admission is not product GO';await save();return {exitCode:0,receipt};
  }catch(e){receipt.result='BLOCKED_SETUP';if(!receipt.stage){receipt.stage='receipt-write';receipt.reason=String(e.message);}receipt.endedAt=new Date(now()).toISOString();return {exitCode:78,receipt};}
}
module.exports={runAdmission,validateConfig,validateRuntimeSelection,checkCredentials,verifyQualification,usableRuntime,QUALIFICATION_CHECKS,STAGES};
