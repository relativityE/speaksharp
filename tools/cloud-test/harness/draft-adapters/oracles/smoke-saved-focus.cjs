'use strict';
// Sam 1794100227 / 1794101214 / 1794101506 / 1794103587: the smoke Focus readback for ONE exact saved session. The full-mode verdict
// (rwtSavedFocusIdentity.savedFocusIdentityVerdict, transpiled product source, unchanged) rejects any point whose rail is still pending, but the
// short smoke window leaves points OUTSIDE it pending by design. Which points are exercised is decided ONLY by the immutable fixture speech
// windows against the reviewed recording window, with exactly the rule smokeTiming.focusWindowVerdict scores (a point whose window ends within
// recordingWindowMs), never by the rail string: an in-window point that is pending, unknown or unsaved FAILS. Every rail value must be a known
// product status. This wrapper calls the full verdict UNCHANGED, keeps every identity check for ALL points, and drops ONLY the per-point
// verdict errors of out-of-window points, reported as unexercised (never success). No in-window point, or no usable window -> NOT RUN.
const { savedFocusIdentityVerdict } = require('./pure/rwtSavedFocusIdentity.cjs');

const KNOWN_RAIL = new Set(['covered', 'partial', 'missing', 'pending']);
// The per-point reasons the full verdict emits that judge a point's VERDICT (not its identity).
const VERDICT_REASONS = new Set(['rail status is pending or unavailable', 'missing saved verdict', 'duplicate saved verdict',
  'saved verdict differs from rail status', 'visible evidence ordinal is missing', 'visible evidence verdict differs from rail status']);

function inWindowOrdinals(windows, recordingWindowMs) {
  if (!Array.isArray(windows) || !Number.isInteger(recordingWindowMs) || recordingWindowMs <= 0) return null;
  const out = [];
  windows.forEach((w, i) => { if (Array.isArray(w) && Number.isFinite(w[1]) && Math.ceil(w[1] * 1000) <= recordingWindowMs) out.push(i + 1); });
  return out;
}

function smokeSavedFocusVerdict(input, { windows, recordingWindowMs } = {}) {
  const expected = Array.isArray(input?.expected) ? input.expected : [];
  const scored = inWindowOrdinals(windows, recordingWindowMs);
  if (scored === null || windows.length !== expected.length)
    return { verdict: 'NOT RUN', exercisedOrdinals: [], unexercisedOrdinals: [], mismatchedOrdinals: [], errors: ['window unavailable'],
             scope: 'smoke-saved-focus-readback' };
  const exercised = scored, unexercised = expected.map((_, i) => i + 1).filter(n => !scored.includes(n));
  const unknown = expected.map((p, i) => [i + 1, p?.railStatus]).filter(([, s]) => !KNOWN_RAIL.has(s)).map(([n]) => `unknown rail status at point ${n}`);
  const full = savedFocusIdentityVerdict(input);
  const kept = unknown.concat(full.errors.filter(e => {
    const m = /^(.*) at point (\d+)$/.exec(e);
    return !(m && VERDICT_REASONS.has(m[1]) && unexercised.includes(Number(m[2])));
  }));
  const mismatched = [...new Set(kept.map(e => /at point (\d+)$/.exec(e)).filter(Boolean).map(m => Number(m[1])))].sort((a, b) => a - b);
  const verdict = kept.length ? 'FAIL' : exercised.length === 0 ? 'NOT RUN' : 'PASS';
  return { verdict, exercisedOrdinals: exercised, unexercisedOrdinals: unexercised, mismatchedOrdinals: mismatched, errors: kept,
           scope: 'smoke-saved-focus-readback' };
}

module.exports = { smokeSavedFocusVerdict, inWindowOrdinals, VERDICT_REASONS, KNOWN_RAIL };
