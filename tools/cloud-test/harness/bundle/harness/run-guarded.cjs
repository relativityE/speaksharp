#!/usr/bin/env node
'use strict';
// run-guarded.cjs --browser <browser.json> --policy <policy.json> --run-dir <dir> --ledger <file>
//                 --max-ms <n> --script <step.cjs> [--faults <faults.json>] [--media-file <reviewed.wav>] [--out <summary.json>]
// Supervisor for one guarded browser step. Starts guard + sandboxed browser, verifies the browser's
// processes (uid/gid 65534, no groups/capabilities, no sandbox-weakening flags, chrome://sandbox
// adequate) BEFORE running the step, then runs the step's exported async function({context, guard,
// browser, log}) under a hard deadline = min(--max-ms, policy.deadlineAt).
// Cancellation: SIGTERM/SIGINT/SIGHUP, the deadline, or loss of this process's parent all cancel
// in-flight guard work, close the browser, verify no owned descendant remains (SIGKILL + reap if
// needed) and write the summary. Exit: 0 step ok; 1 step threw; 3 sandbox/containment check failed;
// 4 deadline; 128+N signal; 5 parent lost; 2 usage/setup.
const fs = require('fs');
const crypto = require('crypto');
const {ActionBudget}=require('./action-budget.cjs');
const {createPrivateEvidenceReader,createPdfTextExtractor}=require('./private-evidence.cjs');
const {loadReviewedProducerReceiver,createProducerEvidenceReader}=require('./producer-evidence.cjs');
const {validateCaseConfig,createCaseRecorder,credentialBinding}=require('./case-results.cjs');
const { admitQualificationSupervisor } = require('./qualification-gate.cjs');
const { requireRuntimeQualification } = require('./runtime-admission.cjs');
const { loadReviewedOracle } = require('./reviewed-oracle-loader.cjs');
const { verifyReviewedStep } = require('./reviewed-step.cjs');
const path = require('path');
const { launchGuarded, inspectDescendants, checkSandboxedProcesses, sandboxReport } = require('./launch.cjs');

const a = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
for (const k of ['browser', 'policy', 'run-dir', 'ledger', 'max-ms', 'script']) if (!a[k]) { console.error('run-guarded: missing --' + k); process.exit(2); }
const policy = JSON.parse(fs.readFileSync(a.policy, 'utf8'));
if(a['case-request-allowance']!==undefined&&!/^[1-9][0-9]{0,8}$/.test(a['case-request-allowance'])){console.error('run-guarded: --case-request-allowance must be a positive integer');process.exit(2);}
let dispatchAdmission=null;
try { if(a['qualification-local-only']==='true') admitQualificationSupervisor(a,policy); else dispatchAdmission=requireRuntimeQualification(a['runtime-qualification'],{admissionReceiptFile:a['admission-receipt'],admissionReceiptSha256:a['admission-receipt-sha256'],campaignId:a['campaign-id'],policyFile:a.policy,ledgerFile:a.ledger,browserFile:a.browser}); verifyReviewedStep({manifestFile:a['step-manifest'],expectedManifestSha256:a['step-manifest-sha256'],stepRoot:a['step-root'],stepFile:a.script}); } catch(e) { console.error(e.message); process.exit(78); }
const runDir = path.resolve(a['run-dir']);
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
const out = a.out || path.join(runDir, 'summary.json');
const startedAt = Date.now();
const hardMs = Math.min(Number(a['max-ms']), Date.parse(policy.deadlineAt) - Date.now());
const parent0 = process.ppid;
const producerAbort=new AbortController();
const launchAbort=new AbortController();
let pendingLaunch=null;
let authenticationRejected=false,actionBudget=null;
let h = null; let stopping = null; let caseRecorder=null; let caseConfig=null;

function stepLog(msg) { fs.appendFileSync(path.join(runDir, 'step.log'), new Date().toISOString() + ' ' + msg + '\n'); }

async function stop(reason, code) {
  if (stopping) return stopping;
  stopping = (async () => {
    producerAbort.abort(); launchAbort.abort();
    // On cancellation during setup, stop existing owned children now; a late launch
    // handle remains awaited below, rather than abandoned until a parent kill.
    if(!h&&pendingLaunch)for(const p of inspectDescendants()){try{process.kill(p.pid,'SIGKILL');}catch{}}
    if(caseRecorder) {try{caseRecorder.preserve();}catch{code=3;}}
    const res = { reason, authenticationRejected, exitCode: code, startedAt: new Date(startedAt).toISOString(), endedAt: null };
    if(h){try{h.cleanupMedia();}catch{res.mediaCleanupFailure=true;res.exitCode=3;}}
    try {
      if(pendingLaunch){try{h=await pendingLaunch;}catch(e){if(e?.cleanupErrors?.length){res.launchCleanupFailure=true;res.exitCode=3;}}}
      if (h) {
        h.guard.cancelAll(reason); // cancel at the boundary first, so in-flight work is recorded as cancelled
        const cl = h.browser.close().catch((e) => { res.browserCloseError = 'BROWSER_CLOSE_FAILED'; });
        await Promise.race([cl, new Promise((r) => setTimeout(r, 10000))]);
        try { res.guard = await h.guard.close(reason); } finally { h.cleanupMedia(); }
      }
    } catch (e) { res.stopError = 'OWNED_CLEANUP_FAILED';res.exitCode=3; }
    // Owned-process cleanup: anything still alive under us is killed and reaped.
    let left = inspectDescendants();
    if (left.length) {
      res.killedLeftovers = left.map((p) => ({ pid: p.pid, name: p.name }));
      for (const p of left) { try { process.kill(p.pid, 'SIGKILL'); } catch {} }
      for (let i = 0; i < 50 && inspectDescendants().length; i++) await new Promise((r) => setTimeout(r, 100));
    }
    left = inspectDescendants();
    res.ownedProcessesRemaining = left.map((p) => ({ pid: p.pid, name: p.name }));
    const attempts=require('./final-attempts.cjs').finalAttemptViolations(res.guard);if(attempts.completion)res.completionAttemptsViolation=true;if(attempts.feedback)res.feedbackAttemptsViolation=true;if(attempts.unsafe)res.exitCode=3;
    if(actionBudget){try{res.actionBudget=actionBudget.summary();if(res.actionBudget.exceeded)res.exitCode=3;}catch{res.actionBudgetIntegrityFailure=true;res.exitCode=3;}}
    if(left.length && res.exitCode===0)res.exitCode=3;
    res.endedAt = new Date().toISOString();
    fs.writeFileSync(out, JSON.stringify(res, null, 2) + '\n',{mode:0o600});
    stepLog(`stop ${reason} exit ${code} remaining ${left.length}`);
    process.exit(res.exitCode);
  })();
  return stopping;
}
for(const event of ['uncaughtException','unhandledRejection'])process.on(event,()=>{void stop('fatal:'+event,3);});
for (const [sig, n] of [['SIGTERM', 15], ['SIGINT', 2], ['SIGHUP', 1]]) process.on(sig, () => stop('signal:' + sig, 128 + n));
setInterval(() => { if (process.ppid !== parent0) stop('parent-lost', 5); }, 500).unref();
if (!(hardMs > 0)) { console.error('run-guarded: deadline already passed'); process.exit(4); }
setTimeout(() => stop('deadline', 4), hardMs).unref();

(async () => {
  try {
    if(a['case-config']) {const bytes=fs.readFileSync(a['case-config']);if(crypto.createHash('sha256').update(bytes).digest('hex')!==a['case-config-sha256'])throw new Error('NOT_RUN: case config hash unbound or changed');caseConfig=validateCaseConfig(JSON.parse(bytes));if(caseConfig.campaignId!==a['campaign-id'])throw new Error('NOT_RUN: case campaign identity differs from admitted campaign');caseRecorder=createCaseRecorder(caseConfig,runDir,{interrupted:()=>h?.guard?.ledger?.caseAllowanceState?.()?.exhausted===true});}
    verifyReviewedStep({manifestFile:a['step-manifest'],expectedManifestSha256:a['step-manifest-sha256'],stepRoot:a['step-root'],stepFile:a.script});
    const readbackOracle = a['oracle-config'] ? loadReviewedOracle(JSON.parse(fs.readFileSync(a['oracle-config'],'utf8'))) : null;
    const producerReceiver=a['producer-receiver']?loadReviewedProducerReceiver({manifestFile:a['step-manifest'],expectedManifestSha256:a['step-manifest-sha256'],stepRoot:a['step-root'],receiverFile:a['producer-receiver']}):null;
    const step = require(path.resolve(a.script));
    if(caseConfig){if(typeof step.preflight!=='function')throw new Error('NOT_RUN: driver pure preflight unavailable');await step.preflight(caseConfig);actionBudget=new ActionBudget({runDir,caseId:caseConfig.caseId,startPressCap:caseConfig.startPressCap,takeCap:caseConfig.takeCap});}
    const credentials=caseConfig?credentialBinding(caseConfig):null;
    if(caseConfig?.privateEvidenceProducers&&!producerReceiver)throw new Error('NOT_RUN: existing authenticated producer receiving capability unavailable before browser launch');
    const readPrivateEvidence=producerReceiver?createProducerEvidenceReader({caseConfig,notBefore:new Date(startedAt).toISOString(),receiver:producerReceiver,writeEvidence:caseRecorder?.writeEvidence,privateEvidenceDir:path.join(runDir,'private-producer'),signal:producerAbort.signal}):createPrivateEvidenceReader({caseConfig,campaignId:a['campaign-id'],notBefore:new Date(startedAt).toISOString()});
    if(stopping||launchAbort.signal.aborted)return;
    pendingLaunch = launchGuarded({signal:launchAbort.signal,downloadPrefixObservation:caseConfig?.caseId==='AHT-14',onFatal:()=>{void stop('guard-fatal',3);},onAllowanceExhausted:()=>{void stop('allowance-exhausted',6);},expectedLedgerIdentity:dispatchAdmission?.expectedLedgerIdentity,reserveTake:actionBudget?()=>actionBudget.reserveTake():null,readbackOracle, browserJson: a.browser, policy, runDir, ledgerFile: a.ledger, caseRequestAllowance: a['case-request-allowance']!==undefined?Number(a['case-request-allowance']):undefined, logFile: path.join(runDir, 'guard.jsonl'), securityApprovalFile: a['security-approval'], privateMediaParent: a['private-media-parent'], media: a['media-file'] ? { file: a['media-file'], sha256: a['media-sha256'] } : null });
    h=await pendingLaunch; if(stopping)return;
    if (a.faults) for (const f of JSON.parse(fs.readFileSync(a.faults, 'utf8'))) h.guard.armFault(f);
    const sb = await sandboxReport(h.context);
    const procs = checkSandboxedProcesses(inspectDescendants());
    fs.writeFileSync(path.join(runDir, 'sandbox.json'), JSON.stringify({ sandboxReport: sb, processes: procs, detail: inspectDescendants() }, null, 2));
    if (!sb.adequate || !procs.ok) { stepLog('sandbox check failed: ' + JSON.stringify({ adequate: sb.adequate, problems: procs.problems })); return stop('sandbox-check-failed', 3); }
    stepLog(`sandbox ok: ${procs.chromeProcesses} chrome processes, chrome://sandbox adequate`);
    verifyReviewedStep({manifestFile:a['step-manifest'],expectedManifestSha256:a['step-manifest-sha256'],stepRoot:a['step-root'],stepFile:a.script});
    let oracles=Object.freeze({});
    if(a['case-oracles']) {verifyReviewedStep({manifestFile:a['step-manifest'],expectedManifestSha256:a['step-manifest-sha256'],stepRoot:a['step-root'],stepFile:a['case-oracles']}); const factory=require(path.resolve(a['case-oracles']));if(typeof factory.createOracles!=='function')throw new Error('NOT_RUN: oracle factory unavailable');oracles=await factory.createOracles({context:h.context,guard:h.guard,caseConfig,writeEvidence:caseRecorder?.writeEvidence,readPrivateEvidence,pdfTextExtractor:createPdfTextExtractor(runDir)});}
    const capabilities=Object.freeze({recordStartPress:actionBudget?input=>actionBudget.reserveStart(input):undefined,credentials,oracles,recordAssertion:caseRecorder?.recordAssertion,writeEvidence:caseRecorder?.writeEvidence});
    const returned=await step({ context: h.context, browser: h.browser, guard: h.guard, log: stepLog, runDir,caseConfig,capabilities });
    authenticationRejected=returned?.executionSignals?.authenticationRejected===true;
    if(caseRecorder) caseRecorder.finish(returned);
    stepLog('step completed');
    await stop('completed', 0);
  } catch (e) {
    if(e?.code==='AUTH_REJECTED')authenticationRejected=true;
    stepLog('step error category: ' + String(e && (e.code || e.name) || 'unclassified').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,64));
    await stop('step-error', 1);
  }
})();
