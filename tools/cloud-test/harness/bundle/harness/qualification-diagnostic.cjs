'use strict';
// R10 A6 diagnosis (Sam 1793996137): when the R0 qualification stops, record WHERE it stopped as closed,
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
const CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}(\.[A-Za-z0-9_-]{1,64}){0,4}$/;
const GUARD_RUN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_IDS = 400;

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
function buildDiagnostic(state, { reason, error, results }) {
  const ids = (results || []).map(r => r && r.id).filter(id => typeof id === 'string' && CHECK_ID.test(id));
  const failed = (results || []).filter(r => r && r.ok === false).map(r => r.id).filter(id => typeof id === 'string' && CHECK_ID.test(id));
  const cleanupErrors = error && typeof error === 'object' && Array.isArray(error.cleanupErrors) ? error.cleanupErrors.length : 0;
  return {
    schema: 'speaksharp.cloud-test.qualification-diagnostic.v1',
    stopReason: STOP_REASONS.includes(reason) ? reason : 'qualification-error',
    phase: PHASES.includes(state.phase) ? state.phase : 'setup',
    guardRun: typeof state.guardRun === 'string' && GUARD_RUN.test(state.guardRun) ? state.guardRun : null,
    guardRuns: Number.isSafeInteger(state.guardRuns) && state.guardRuns >= 0 ? Math.min(state.guardRuns, 999) : 0,
    completedCheckIds: ids.slice(-MAX_IDS),
    failedCheckIds: failed.slice(-MAX_IDS),
    ...(() => { const c = classifyError(error); return { errorCategory: c.category, errorCode: c.code, errorSignatures: c.signatures }; })(),
    cleanupErrorCount: Math.min(cleanupErrors, 99),
    contentFree: true,
  };
}

const KEYS = ['schema', 'stopReason', 'phase', 'guardRun', 'guardRuns', 'completedCheckIds', 'failedCheckIds', 'errorCategory', 'errorCode', 'errorSignatures', 'cleanupErrorCount', 'contentFree'];
// Strict re-validation at the receiving side: unknown keys, out-of-set values or non-ID strings refuse.
function validateDiagnostic(d) {
  const fail = why => { throw new Error('qualification diagnostic refused: ' + why); };
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail('shape');
  const keys = Object.keys(d).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...KEYS].sort())) fail('keys');
  if (d.schema !== 'speaksharp.cloud-test.qualification-diagnostic.v1' || d.contentFree !== true) fail('schema');
  if (!STOP_REASONS.includes(d.stopReason) || !PHASES.includes(d.phase)) fail('reason/phase');
  if (!(d.guardRun === null || (typeof d.guardRun === 'string' && GUARD_RUN.test(d.guardRun)))) fail('guardRun');
  if (!Number.isSafeInteger(d.guardRuns) || d.guardRuns < 0 || d.guardRuns > 999) fail('guardRuns');
  for (const k of ['completedCheckIds', 'failedCheckIds']) if (!Array.isArray(d[k]) || d[k].length > MAX_IDS || d[k].some(id => typeof id !== 'string' || !CHECK_ID.test(id))) fail(k);
  if (!ERROR_CATEGORIES.includes(d.errorCategory) || !ERROR_CODES.includes(d.errorCode)) fail('error class');
  if (!Array.isArray(d.errorSignatures) || d.errorSignatures.some(s => !SIGNATURE_KEYS.includes(s)) || new Set(d.errorSignatures).size !== d.errorSignatures.length) fail('signatures');
  if (!Number.isSafeInteger(d.cleanupErrorCount) || d.cleanupErrorCount < 0 || d.cleanupErrorCount > 99) fail('cleanup count');
  return { ...d, completedCheckIds: [...d.completedCheckIds], failedCheckIds: [...d.failedCheckIds], errorSignatures: [...d.errorSignatures] };
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

module.exports = { PHASES, STOP_REASONS, ERROR_CATEGORIES, ERROR_CODES, SIGNATURE_KEYS, classifyError, createState, buildDiagnostic, validateDiagnostic, guardedRun };
