'use strict';
// Sam 1794100227 / 1794101214 / 1794101506: the smoke Focus readback for ONE exact saved session. The full-mode verdict
// (rwtSavedFocusIdentity.savedFocusIdentityVerdict, transpiled product source, unchanged) rejects any point whose rail is still pending, but
// the short smoke window leaves points outside it pending by design. This wrapper calls that verdict UNCHANGED and keeps every identity check for
// ALL points (brief binding, count, ids, contiguous order, labels, out-of-brief evidence, visible-evidence parse errors). It drops ONLY the
// per-point verdict errors of points the window never exercised (rail pending/unavailable), which are reported as unexercised: never success.
// No exercised point -> NOT RUN (nothing was judged). This is a smoke-scoped readback, never full focus-live-durable acceptance.
const { savedFocusIdentityVerdict } = require('./pure/rwtSavedFocusIdentity.cjs');

const exercisedStatus = s => s === 'covered' || s === 'partial' || s === 'missing';
// The per-point reasons the full verdict emits that judge a point's VERDICT (not its identity).
const VERDICT_REASONS = new Set(['rail status is pending or unavailable', 'missing saved verdict', 'duplicate saved verdict',
  'saved verdict differs from rail status', 'visible evidence ordinal is missing', 'visible evidence verdict differs from rail status']);

function smokeSavedFocusVerdict(input) {
  const expected = Array.isArray(input?.expected) ? input.expected : [];
  const exercised = [], unexercised = [];
  expected.forEach((p, i) => (exercisedStatus(p?.railStatus) ? exercised : unexercised).push(i + 1));
  const full = savedFocusIdentityVerdict(input);
  const kept = full.errors.filter(e => {
    const m = /^(.*) at point (\d+)$/.exec(e);
    return !(m && VERDICT_REASONS.has(m[1]) && unexercised.includes(Number(m[2])));
  });
  const mismatched = [...new Set(kept.map(e => /at point (\d+)$/.exec(e)).filter(Boolean).map(m => Number(m[1])))].sort((a, b) => a - b);
  const verdict = kept.length ? 'FAIL' : exercised.length === 0 ? 'NOT RUN' : 'PASS';
  return { verdict, exercisedOrdinals: exercised, unexercisedOrdinals: unexercised, mismatchedOrdinals: mismatched, errors: kept,
           scope: 'smoke-saved-focus-readback' };
}

module.exports = { smokeSavedFocusVerdict, VERDICT_REASONS };
