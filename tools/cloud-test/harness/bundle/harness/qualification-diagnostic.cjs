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
const CHECK_SECTIONS = Object.freeze(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S9a', 'S10', 'S11', 'S12', 'S13', 'S14', 'S14b', 'S15']);
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
function groupCounts(ids) {
  const out = [];
  for (const id of ids) { const g = checkGroup(id); if (!g) continue; const last = out[out.length - 1]; if (last && last.group === g) last.count = Math.min(last.count + 1, MAX_COUNT); else out.push({ group: g, count: 1 }); }
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
    ...(() => { const c = classifyError(error); return { errorCategory: c.category, errorCode: c.code, errorSignatures: c.signatures }; })(),
    cleanupErrorCount: Math.min(launchErrors + shutdownErrors, 99), // launch cleanup + qualification shutdown errors; no text kept
    contentFree: true,
  };
}

const KEYS = ['schema', 'stopReason', 'phase', 'guardRun', 'guardRuns', 'completedCheckGroups', 'failedCheckGroups', 'errorCategory', 'errorCode', 'errorSignatures', 'cleanupErrorCount', 'contentFree'];
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
  if (!ERROR_CATEGORIES.includes(d.errorCategory) || !ERROR_CODES.includes(d.errorCode)) fail('error class');
  if (!Array.isArray(d.errorSignatures) || d.errorSignatures.some(s => !SIGNATURE_KEYS.includes(s)) || new Set(d.errorSignatures).size !== d.errorSignatures.length) fail('signatures');
  if (!Number.isSafeInteger(d.cleanupErrorCount) || d.cleanupErrorCount < 0 || d.cleanupErrorCount > 99) fail('cleanup count');
  const copy = a => a.map(g => ({ group: g.group, count: g.count }));
  return { ...d, completedCheckGroups: copy(d.completedCheckGroups), failedCheckGroups: copy(d.failedCheckGroups), errorSignatures: [...d.errorSignatures] };
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

module.exports = { GUARD_RUNS, GUARD_RUN_KEYS, CHECK_SECTIONS, CHECK_GROUPS, guardRunKey, checkGroup, PHASES, STOP_REASONS, ERROR_CATEGORIES, ERROR_CODES, SIGNATURE_KEYS, classifyError, createState, buildDiagnostic, validateDiagnostic, guardedRun };
