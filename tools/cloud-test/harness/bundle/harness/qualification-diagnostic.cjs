'use strict';
// R10 A6 diagnosis : when the R0 qualification stops, record WHERE it stopped as closed,
// content-free identifiers only. Never an exception message, stack, command, URL, stdout or private file.
// Every emitted value is either a member of a closed set below, a bounded integer, or a source-literal
// check ID that must match CHECK_ID. Admission re-validates the file before it enters the receipt.
const PHASES = Object.freeze(['setup', 'fixture-start', 'media-prepare', 'guard-start', 'browser-launch', 'context-create', 'page-create', 'test-body', 'browser-close', 'guard-close', 'between-runs', 'verdict']);
const STOP_REASONS = Object.freeze(['qualification-error', 'qualification-deadline', 'parent-lost', 'signal:SIGTERM', 'signal:SIGINT', 'signal:SIGHUP', 'verdict-fail']);
const ERROR_CATEGORIES = Object.freeze(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'AbortError', 'SystemError', 'other', 'none']);
const ERROR_CODES = Object.freeze(['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ENOTDIR', 'EISDIR', 'ENOSPC', 'EMFILE', 'EADDRINUSE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ABORT_ERR', 'ERR_INVALID_ARG_TYPE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'other', 'none']);
// Fixed message signatures. Only the KEY is emitted; the message itself never leaves this function.
const SIGNATURES = Object.freeze([
  ['playwright-timeout', /Timeout \d+ms exceeded/],
  ['browser-closed', /Target page, context or browser has been closed|Browser has been closed|browser has disconnected/i],
  ['launch-failed', /Failed to launch|Process failed to launch|browserType\.launch/i],
  ['browser-process-exit', /exited with code|exitCode=|signal=SIG/i],
  ['sandbox', /sandbox/i],
  ['shared-library', /error while loading shared libraries/i],
  ['wrapper-refused', /chrome-wrapper: refused|chrome-wrapper: profile/],
  ['approval', /APPROVAL_REQUIRED|security approval|approval (expired|mismatch|required)/i],
  ['permission', /EACCES|EPERM|Permission denied|Operation not permitted/i],
  ['address-in-use', /EADDRINUSE/],
  ['ledger-locked', /ledger locked/],
  ['fixture', /fixture/i],
  ['cleanup-timeout', /cleanup timeout/],
  ['qualification-stopping', /qualification stop/],
  ['context-override', /context proxy\/certificate override/],
  ['use-guarded-context', /use the guarded context/],
]);
const SIGNATURE_KEYS = Object.freeze(SIGNATURES.map(([k]) => k));
// membership, not syntax. Guard runs are the exact withGuard IDs in selftest.cjs and
// feedback-controls.cjs (pinned to source by tests/node/qualification-diagnostic.test.cjs); the three
// loop-built feedback families are recorded by family only. Check IDs reduce to a known group: the
// S-section prefix, or the guard run that prefixes its reconcile/no-leak checks. Nothing else survives.
const GUARD_RUNS = Object.freeze(['sandbox', 'redirects', 'methods', 'mechanisms', 'caps-1', 'caps-2-cumulative', 'coaching-cap', 'concurrency', 'queue-limit', 'deadline', 'campaign-deadline', 'env-proxy', 'faults', 'model-download-compressed', 'model-download-faults', 'feedback-three-modes', 'feedback-error-status-negative', 'feedback-changed-retry-negative', 'feedback-hidden-retry-negative', 'feedback-third-attempt-negative', 'feedback-insert-only-no-read-grant', 'feedback-preexisting-counterfactual']);
const GUARD_RUN_FAMILIES = Object.freeze([['feedback-initial-status-', 'feedback-initial-status-*'], ['feedback-prefer-', 'feedback-prefer-*'], ['feedback-', 'feedback-*']]);
const GUARD_RUN_KEYS = Object.freeze([...GUARD_RUNS, ...GUARD_RUN_FAMILIES.map(([, k]) => k)]);
const CHECK_SECTIONS = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S5a', 'S6', 'S6a', 'S6b', 'S6c', 'S7', 'S8', 'S9', 'S9a', 'S10', 'S11', 'S12', 'S13', 'S14', 'S14b', 'S15']);
const CHECK_GROUPS = Object.freeze([...CHECK_SECTIONS, ...GUARD_RUN_KEYS]);
const MAX_COUNT = 999;
function guardRunKey(id) {
  if (typeof id !== 'string') return null;
  if (GUARD_RUNS.includes(id)) return id;
  for (const [prefix, key] of GUARD_RUN_FAMILIES) if (id.startsWith(prefix) && /^[a-z0-9=-]{1,40}$/.test(id.slice(prefix.length))) return key;
  return null;
}
function checkGroup(id) {
  if (typeof id !== 'string') return null;
  const head = id.split('.')[0];
  return CHECK_SECTIONS.includes(head) ? head : guardRunKey(head);
}
// A failed check's own code identifier (e.g. S6.queue-wait-denied), so a refusal names the check, not only its group. Closed form:
// a known group prefix, then lowercase code segments; never free text. At most MAX_FAILED_CHECKS, in failure order.
const MAX_FAILED_CHECKS = 20;
// Review of 7e07474b: a prefix and a shape are not membership. CHECK_IDS is the EXACT set the self-test can emit: every literal
// check/reconcile/withGuard id in qualification/selftest.cjs and feedback-controls.cjs, plus the ids its loops build from closed
// source lists (feedback MODES, initial statuses, labels, prefer cases) and the reconcile/no-leak/no-exception suffixes. It is pinned
// to that source by tests/node/qualification-diagnostic.test.cjs; anything else (any free text, even under a known prefix) is refused.
const CHECK_IDS = Object.freeze(["S0.precondition", "S1.node-network-disabled", "S1.one-browser-process", "S1.process-privileges", "S1.renderer-seccomp", "S1.sandbox-page", "S1.wrapper-refuses-no-sandbox", "S10.lighthouse", "S10.lighthouse-cleanup", "S10.lighthouse-privilege", "S10.no-leak", "S10.reconcile.a.test", "S10.reconcile.c.test", "S11.final-no-chrome", "S11.final-no-leak", "S11.final-owned-processes", "S11.fixtures-stopped", "S12.media-hash-logged", "S12.media-launch-failure-cleanup", "S12.media-private-owner", "S12.media-success-cleanup", "S12.mic-allow", "S12.mic-deny", "S12.no-leak", "S12.reconcile.a.test", "S12.reconcile.c.test", "S13.final-code-integrity", "S13.native-node-scope-review", "S14.browser-offline-applied", "S14.download-fails-explicit-retry", "S14.download-fails-zero-receipts", "S14.error-status-negative", "S14.exact-fault-log", "S14.exact-fault-summary", "S14.negative-not-fired-log", "S14.network-restored", "S14.no-implicit-duplicates", "S14.no-leak", "S14.offline-explicit-retry", "S14.offline-prefix-and-error", "S14.reconcile.a.test", "S14.reconcile.c.test", "S14b.compressed-fault-fires", "S14b.fault-is-single-shot", "S14b.unfaulted-keeps-encoding", "S14b.unrelated-download-still-compressed-while-armed", "S15.changed-retry-denied", "S15.changed-retry.no-leak", "S15.changed-retry.reconcile.a.test", "S15.changed-retry.reconcile.c.test", "S15.created-error-body", "S15.created-error-body-denied", "S15.created-error-body.no-leak", "S15.created-error-body.reconcile.a.test", "S15.created-error-body.reconcile.c.test", "S15.denied-select-not-prerequisite", "S15.duplicate-schema", "S15.duplicate-schema-denied", "S15.duplicate-schema.no-leak", "S15.duplicate-schema.reconcile.a.test", "S15.duplicate-schema.reconcile.c.test", "S15.error-status-not-response-lost", "S15.error-status.no-leak", "S15.error-status.reconcile.a.test", "S15.error-status.reconcile.c.test", "S15.final-observe-once", "S15.hidden-retry-denied-before-send", "S15.hidden-retry.no-leak", "S15.hidden-retry.reconcile.a.test", "S15.hidden-retry.reconcile.c.test", "S15.incomplete-created-response", "S15.incomplete-created-response-denied", "S15.incomplete-created-response.no-leak", "S15.incomplete-created-response.reconcile.a.test", "S15.incomplete-created-response.reconcile.c.test", "S15.initial-status-200", "S15.initial-status-200.no-leak", "S15.initial-status-200.reconcile.a.test", "S15.initial-status-200.reconcile.c.test", "S15.initial-status-202", "S15.initial-status-202.no-leak", "S15.initial-status-202.reconcile.a.test", "S15.initial-status-202.reconcile.c.test", "S15.initial-status-204", "S15.initial-status-204.no-leak", "S15.initial-status-204.reconcile.a.test", "S15.initial-status-204.reconcile.c.test", "S15.initial-status-400", "S15.initial-status-400.no-leak", "S15.initial-status-400.reconcile.a.test", "S15.initial-status-400.reconcile.c.test", "S15.initial-status-401", "S15.initial-status-401.no-leak", "S15.initial-status-401.reconcile.a.test", "S15.initial-status-401.reconcile.c.test", "S15.initial-status-403", "S15.initial-status-403.no-leak", "S15.initial-status-403.reconcile.a.test", "S15.initial-status-403.reconcile.c.test", "S15.initial-status-409", "S15.initial-status-409.no-leak", "S15.initial-status-409.reconcile.a.test", "S15.initial-status-409.reconcile.c.test", "S15.initial-status-500", "S15.initial-status-500.no-leak", "S15.initial-status-500.reconcile.a.test", "S15.initial-status-500.reconcile.c.test", "S15.insert-only-confirmation", "S15.insert-only.no-leak", "S15.insert-only.reconcile.a.test", "S15.insert-only.reconcile.c.test", "S15.other-schema", "S15.other-schema-denied", "S15.other-schema.no-leak", "S15.other-schema.reconcile.a.test", "S15.other-schema.reconcile.c.test", "S15.positive.no-leak", "S15.positive.reconcile.a.test", "S15.positive.reconcile.c.test", "S15.preexisting-no-initial-create", "S15.preexisting.no-leak", "S15.preexisting.reconcile.a.test", "S15.preexisting.reconcile.c.test", "S15.prefer-40", "S15.prefer-40.no-leak", "S15.prefer-40.reconcile.a.test", "S15.prefer-40.reconcile.c.test", "S15.prefer-41", "S15.prefer-41.no-leak", "S15.prefer-41.reconcile.a.test", "S15.prefer-41.reconcile.c.test", "S15.prefer-42", "S15.prefer-42.no-leak", "S15.prefer-42.reconcile.a.test", "S15.prefer-42.reconcile.c.test", "S15.retry201", "S15.retry201-denied", "S15.retry201.no-leak", "S15.retry201.reconcile.a.test", "S15.retry201.reconcile.c.test", "S15.rollback-response", "S15.rollback-response-denied", "S15.rollback-response.no-leak", "S15.rollback-response.reconcile.a.test", "S15.rollback-response.reconcile.c.test", "S15.stored-response-lost.before-retry", "S15.stored-response-lost.initial", "S15.stored-response-lost.retry", "S15.synthetic-42501.before-retry", "S15.synthetic-42501.initial", "S15.synthetic-42501.retry", "S15.third-attempt-denied", "S15.third-attempt.no-leak", "S15.third-attempt.reconcile.a.test", "S15.third-attempt.reconcile.c.test", "S15.three-modes-summary", "S15.transport-before-send.before-retry", "S15.transport-before-send.initial", "S15.transport-before-send.retry", "S15.wrong-constraint", "S15.wrong-constraint-denied", "S15.wrong-constraint.no-leak", "S15.wrong-constraint.reconcile.a.test", "S15.wrong-constraint.reconcile.c.test", "S15.wrong-key", "S15.wrong-key-denied", "S15.wrong-key.no-leak", "S15.wrong-key.reconcile.a.test", "S15.wrong-key.reconcile.c.test", "S2.allowed-page", "S2.chain-hops-counted", "S2.counted-cross-refusals", "S2.fetch-chain", "S2.fetch-redirect-cross", "S2.forbidden-path-denied", "S2.nav-chain", "S2.nav-redirect-cross", "S2.no-leak", "S2.reconcile.a.test", "S2.reconcile.c.test", "S2.redirect-allowed-cross", "S2.redirect-events", "S2.redirect-forbidden-path", "S2.redirect-loopback", "S3.cors-preflight", "S3.gzip", "S3.head", "S3.method-allowed", "S3.method-denied", "S3.no-leak", "S3.preflight-logged", "S3.put-denied", "S3.reconcile.a.test", "S3.reconcile.c.test", "S4.beacon", "S4.ip-literal", "S4.ip-literal-logged", "S4.loopback-direct", "S4.no-leak", "S4.plain-http-logged", "S4.reconcile.a.test", "S4.reconcile.c.test", "S4.service-worker", "S4.upgrade-logged", "S4.websocket", "S4.websocket-forbidden-host", "S4.worker", "S4.ws-not-forwarded", "S5.coaching-cap", "S5.coaching-not-sent", "S5.cumulative", "S5.cumulative-not-sent", "S5.ledger", "S5.nav-cap", "S5.nav3-not-sent", "S5.single-run-lock", "S5.total-cap", "S5a.no-leak", "S5a.reconcile.a.test", "S5a.reconcile.c.test", "S6.campaign-deadline", "S6.campaign-deadline-cancels", "S6.campaign-deadline-denial-logged", "S6.concurrency", "S6.deadline-logged", "S6.inflight-max", "S6.queue-wait-denied", "S6.request-deadline", "S6.upstream-error", "S6.upstream-error-logged", "S6a.no-leak", "S6a.reconcile.a.test", "S6a.reconcile.c.test", "S6b.no-leak", "S6b.reconcile.a.test", "S6b.reconcile.c.test", "S6c.no-leak", "S6c.reconcile.a.test", "S6c.reconcile.c.test", "S7.error-not-fired", "S7.error-status-negative", "S7.fault-correlated", "S7.no-leak", "S7.one-shot", "S7.readback-counted", "S7.reconcile.a.test", "S7.reconcile.c.test", "S7.request-lost", "S7.request-lost-retry", "S7.response-lost", "S8.env-proxy", "S8.env-proxy-tunnels", "S8.no-leak", "S8.reconcile.a.test", "S8.reconcile.c.test", "S9.deadline", "S9.ok", "S9.ok-sandbox-file", "S9.parent-lost", "S9.sigkill", "S9.sigterm", "S9.step-error", "S9a.affected-not-run", "S9a.allowance-state", "S9a.boundary", "S9a.case-result", "S9a.cleanup", "S9a.control", "S9a.control-boundary", "S9a.exit-code", "S9a.gate-continues", "S9a.gate-stops-on-cleanup-failure", "S9a.nothing-beyond-allowance", "S9a.prior-fails-remain", "S9a.signal-once", "campaign-deadline.no-exception", "caps-1.no-exception", "caps-2-cumulative.no-exception", "coaching-cap.no-exception", "concurrency.no-exception", "deadline.no-exception", "env-proxy.no-exception", "faults.no-exception", "feedback-changed-retry-negative.no-exception", "feedback-created-error-body.no-exception", "feedback-duplicate-schema.no-exception", "feedback-error-status-negative.no-exception", "feedback-hidden-retry-negative.no-exception", "feedback-incomplete-created-response.no-exception", "feedback-initial-status-200.no-exception", "feedback-initial-status-202.no-exception", "feedback-initial-status-204.no-exception", "feedback-initial-status-400.no-exception", "feedback-initial-status-401.no-exception", "feedback-initial-status-403.no-exception", "feedback-initial-status-409.no-exception", "feedback-initial-status-500.no-exception", "feedback-insert-only-no-read-grant.no-exception", "feedback-other-schema.no-exception", "feedback-preexisting-counterfactual.no-exception", "feedback-prefer-40.no-exception", "feedback-prefer-41.no-exception", "feedback-prefer-42.no-exception", "feedback-retry201.no-exception", "feedback-rollback-response.no-exception", "feedback-third-attempt-negative.no-exception", "feedback-three-modes.no-exception", "feedback-wrong-constraint.no-exception", "feedback-wrong-key.no-exception", "mechanisms.no-exception", "methods.no-exception", "model-download-compressed.no-exception", "model-download-faults.no-exception", "queue-limit.no-exception", "redirects.no-exception", "sandbox.no-exception"]);
const CHECK_ID_SET = new Set(CHECK_IDS);
function isCheckId(id) { return typeof id === 'string' && CHECK_ID_SET.has(id) && checkGroup(id) !== null; }
function failedCheckIds(ids) { return [...new Set(ids.filter(isCheckId))].slice(0, MAX_FAILED_CHECKS); }
function groupCounts(ids) {
  const out = [];
  for (const id of ids) { const g = isCheckId(id) ? checkGroup(id) : null; if (!g) continue; const last = out[out.length - 1]; if (last && last.group === g) last.count = Math.min(last.count + 1, MAX_COUNT); else out.push({ group: g, count: 1 }); }
  return out.slice(-200);
}

function classifyError(error) {
  if (error == null) return { category: 'none', code: 'none', signatures: [] };
  const name = typeof error === 'object' && typeof error.name === 'string' ? error.name : '';
  const code = typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
  let text = '';
  try { text = String(typeof error === 'object' && 'message' in error ? error.message : error); } catch { text = ''; }
  return {
    category: ERROR_CATEGORIES.includes(name) && name !== 'none' ? name : 'other',
    code: ERROR_CODES.includes(code) && code !== 'none' ? code : (code ? 'other' : 'none'),
    signatures: SIGNATURES.filter(([, re]) => re.test(text)).map(([k]) => k),
  };
}

function createState() { return { phase: 'setup', guardRun: null, guardRuns: 0 }; }

// Build the content-free diagnostic. `results` are the self-test's check records; only their IDs survive.
function buildDiagnostic(state, { reason, error, results, shutdownErrorCount = 0 }) {
  const ids = (results || []).map(r => r && r.id);
  const failed = (results || []).filter(r => r && r.ok === false).map(r => r.id);
  const launchErrors = error && typeof error === 'object' && Array.isArray(error.cleanupErrors) ? error.cleanupErrors.length : 0;
  const shutdownErrors = Number.isSafeInteger(shutdownErrorCount) && shutdownErrorCount > 0 ? shutdownErrorCount : 0;
  return {
    schema: 'speaksharp.cloud-test.qualification-diagnostic.v1',
    stopReason: STOP_REASONS.includes(reason) ? reason : 'qualification-error',
    phase: PHASES.includes(state.phase) ? state.phase : 'setup',
    guardRun: guardRunKey(state.guardRun),
    guardRuns: Number.isSafeInteger(state.guardRuns) && state.guardRuns >= 0 ? Math.min(state.guardRuns, 999) : 0,
    completedCheckGroups: groupCounts(ids),
    failedCheckGroups: groupCounts(failed),
    failedChecks: failedCheckIds(failed),
    ...(() => { const c = classifyError(error); return { errorCategory: c.category, errorCode: c.code, errorSignatures: c.signatures }; })(),
    cleanupErrorCount: Math.min(launchErrors + shutdownErrors, 99), // launch cleanup + qualification shutdown errors; no text kept
    contentFree: true,
  };
}

const KEYS = ['schema', 'stopReason', 'phase', 'guardRun', 'guardRuns', 'completedCheckGroups', 'failedCheckGroups', 'failedChecks', 'errorCategory', 'errorCode', 'errorSignatures', 'cleanupErrorCount', 'contentFree'];
// Strict re-validation at the receiving side: unknown keys, out-of-set values or non-ID strings refuse.
function validateDiagnostic(d) {
  const fail = why => { throw new Error('qualification diagnostic refused: ' + why); };
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail('shape');
  const keys = Object.keys(d).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...KEYS].sort())) fail('keys');
  if (d.schema !== 'speaksharp.cloud-test.qualification-diagnostic.v1' || d.contentFree !== true) fail('schema');
  if (!STOP_REASONS.includes(d.stopReason) || !PHASES.includes(d.phase)) fail('reason/phase');
  if (!(d.guardRun === null || GUARD_RUN_KEYS.includes(d.guardRun))) fail('guardRun');
  if (!Number.isSafeInteger(d.guardRuns) || d.guardRuns < 0 || d.guardRuns > 999) fail('guardRuns');
  for (const k of ['completedCheckGroups', 'failedCheckGroups']) if (!Array.isArray(d[k]) || d[k].length > 200 || d[k].some(g => !g || typeof g !== 'object' || Array.isArray(g) || JSON.stringify(Object.keys(g).sort()) !== '["count","group"]' || !CHECK_GROUPS.includes(g.group) || !Number.isSafeInteger(g.count) || g.count < 1 || g.count > MAX_COUNT)) fail(k);
  if (!Array.isArray(d.failedChecks) || d.failedChecks.length > MAX_FAILED_CHECKS || d.failedChecks.some(id => !isCheckId(id))
      || new Set(d.failedChecks).size !== d.failedChecks.length) fail('failed checks');
  if (!ERROR_CATEGORIES.includes(d.errorCategory) || !ERROR_CODES.includes(d.errorCode)) fail('error class');
  if (!Array.isArray(d.errorSignatures) || d.errorSignatures.some(s => !SIGNATURE_KEYS.includes(s)) || new Set(d.errorSignatures).size !== d.errorSignatures.length) fail('signatures');
  if (!Number.isSafeInteger(d.cleanupErrorCount) || d.cleanupErrorCount < 0 || d.cleanupErrorCount > 99) fail('cleanup count');
  const copy = a => a.map(g => ({ group: g.group, count: g.count }));
  return { ...d, completedCheckGroups: copy(d.completedCheckGroups), failedCheckGroups: copy(d.failedCheckGroups), failedChecks: [...d.failedChecks],
    errorSignatures: [...d.errorSignatures] };
}

// One guarded self-test run with its lifecycle phases recorded. Exceptions outside the test body escape
// (fail closed, as before); the phase in `state` then names where.
async function guardedRun(state, { id, launch, fn, onBodyError }) {
  state.guardRun = id; state.guardRuns += 1; state.phase = 'browser-launch';
  const h = await launch(phase => { if (PHASES.includes(phase)) state.phase = phase; });
  state.phase = 'page-create';
  const page = await h.context.newPage();
  state.phase = 'test-body';
  let err = null;
  try { await fn({ ...h, page }); } catch (e) { err = e; }
  state.phase = 'browser-close';
  h.guard.cancelAll('test-end');
  await h.browser.close();
  state.phase = 'guard-close';
  const summary = await h.guard.close('test-end');
  state.phase = 'between-runs';
  if (err && onBodyError) onBodyError(err);
  return { h, summary };
}

module.exports = { CHECK_IDS, GUARD_RUNS, GUARD_RUN_KEYS, CHECK_SECTIONS, CHECK_GROUPS, guardRunKey, checkGroup, isCheckId, MAX_FAILED_CHECKS, PHASES, STOP_REASONS, ERROR_CATEGORIES, ERROR_CODES, SIGNATURE_KEYS, classifyError, createState, buildDiagnostic, validateDiagnostic, guardedRun };
