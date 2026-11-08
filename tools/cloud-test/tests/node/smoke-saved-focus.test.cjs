'use strict';
// Sam 1794101214 / 1794101506: offline controls for the REAL short-window shape before any reuse of the full-mode saved-Focus verdict.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const P = path.join(__dirname, '..', '..', 'harness', 'draft-adapters', 'oracles', 'pure');
const { savedFocusIdentityVerdict } = require(path.join(P, 'rwtSavedFocusIdentity.cjs'));
const { smokeSavedFocusVerdict } = require(path.join(P, '..', 'smoke-saved-focus.cjs'));

// Two points inside the short window (one covered, one missed) and two outside it, still pending when the smoke recording stopped.
function shortWindow(over = {}) {
  const labels = ['Open with the goal', 'Name the risk', 'Ask for the decision', 'Close with next steps'];
  const rails = ['covered', 'missing', 'pending', 'pending'];
  const base = {
    expectedBriefId: 'brief-1', savedBriefId: 'brief-1',
    expected: labels.map((label, i) => ({ label, railStatus: rails[i] })),
    savedPoints: labels.map((label, i) => ({ id: 'p' + i, brief_id: 'brief-1', sort_order: i, label })),
    evidence: [{ brief_point_id: 'p0', verdict: 'detected' }, { brief_point_id: 'p1', verdict: 'not_detected' },
               { brief_point_id: 'p2', verdict: 'not_detected' }, { brief_point_id: 'p3', verdict: 'not_detected' }],
    visibleEvidence: ['From this session', 'Detected: point 1 at 0:05.', 'Not detected: point 2, point 3, point 4.'],
  };
  return { ...base, ...over };
}

test('compatibility gate: the full-mode verdict FAILS the real short-window shape, so it cannot be reused unchanged', () => {
  const full = savedFocusIdentityVerdict(shortWindow());
  assert.equal(full.verdict, 'FAIL');
  assert.deepEqual(full.mismatchedOrdinals, [3, 4]);
  assert.ok(full.errors.every(e => /at point [34]$/.test(e)));
});

test('the smoke readback passes the exercised points and reports the others as unexercised, never successful', () => {
  const r = smokeSavedFocusVerdict(shortWindow());
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual([r.exercisedOrdinals, r.unexercisedOrdinals, r.errors], [[1, 2], [3, 4], []]);
  assert.equal(r.scope, 'smoke-saved-focus-readback');
});

test('identity is checked for ALL points, exercised or not', () => {
  const cases = {
    'another brief (another session objective)': shortWindow({ savedBriefId: 'brief-2' }),
    'an unexercised point label differs': shortWindow({ savedPoints: shortWindow().savedPoints.map((p, i) => i === 3 ? { ...p, label: 'Other' } : p) }),
    'order swapped': shortWindow({ savedPoints: shortWindow().savedPoints.map((p, i) => i === 0 ? { ...p, sort_order: 1 } : i === 1 ? { ...p, sort_order: 0 } : p) }),
    'a point count mismatch': shortWindow({ savedPoints: shortWindow().savedPoints.slice(0, 3) }),
    'evidence for an out-of-brief point': shortWindow({ evidence: [...shortWindow().evidence, { brief_point_id: 'x9', verdict: 'detected' }] }),
    'unparseable review evidence': shortWindow({ visibleEvidence: ['Something else.'] }),
  };
  for (const [name, input] of Object.entries(cases)) assert.equal(smokeSavedFocusVerdict(input).verdict, 'FAIL', name);
});

test('exercised points must match exactly', () => {
  const cases = {
    'exercised saved verdict differs from the rail': shortWindow({ evidence: [{ brief_point_id: 'p0', verdict: 'not_detected' }, ...shortWindow().evidence.slice(1)] }),
    'exercised point missing its saved verdict': shortWindow({ evidence: shortWindow().evidence.slice(1) }),
    'exercised point missing on the reopened review': shortWindow({ visibleEvidence: ['Not detected: point 2, point 3, point 4.'] }),
    'no saved evidence rows at all': shortWindow({ evidence: [] }),
  };
  for (const [name, input] of Object.entries(cases)) assert.equal(smokeSavedFocusVerdict(input).verdict, 'FAIL', name);
});

test('no exercised point is NOT RUN, not PASS', () => {
  const input = shortWindow({ expected: shortWindow().expected.map(p => ({ ...p, railStatus: 'pending' })) });
  const r = smokeSavedFocusVerdict(input);
  assert.equal(r.verdict, 'NOT RUN');
  assert.deepEqual(r.unexercisedOrdinals, [1, 2, 3, 4]);
});
