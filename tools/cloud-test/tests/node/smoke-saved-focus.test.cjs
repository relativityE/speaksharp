'use strict';
// offline controls for the REAL short-window shape. Exercised points come ONLY from the immutable
// fixture speech windows against the reviewed recording window (the smokeTiming.focusWindowVerdict rule), never from the rail string.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const O = path.join(__dirname, '..', '..', 'harness', 'draft-adapters', 'oracles');
const { savedFocusIdentityVerdict } = require(path.join(O, 'pure', 'rwtSavedFocusIdentity.cjs'));
const { focusWindowVerdict } = require(path.join(O, 'pure', 'smokeTiming.cjs'));
const { smokeSavedFocusVerdict, inWindowOrdinals } = require(path.join(O, 'smoke-saved-focus.cjs'));

// Points 1-2 end inside the 22.85 s smoke window; points 3-4 end after it and were still pending at Stop.
const WINDOW = { windows: [[2.0, 6.5], [9.0, 14.0], [24.0, 29.0], [31.0, 36.0]], recordingWindowMs: 22850 };
function shortWindow(over = {}) {
  const labels = ['Open with the goal', 'Name the risk', 'Ask for the decision', 'Close with next steps'];
  const rails = ['covered', 'missing', 'pending', 'pending'];
  return {
    expectedBriefId: 'brief-1', savedBriefId: 'brief-1',
    expected: labels.map((label, i) => ({ label, railStatus: rails[i] })),
    savedPoints: labels.map((label, i) => ({ id: 'p' + i, brief_id: 'brief-1', sort_order: i, label })),
    evidence: [{ brief_point_id: 'p0', verdict: 'detected' }, { brief_point_id: 'p1', verdict: 'not_detected' },
               { brief_point_id: 'p2', verdict: 'not_detected' }, { brief_point_id: 'p3', verdict: 'not_detected' }],
    visibleEvidence: ['From this session', 'Detected: point 1 at 0:05.', 'Not detected: point 2, point 3, point 4.'],
    ...over,
  };
}
const rails = list => shortWindow().expected.map((p, i) => ({ ...p, railStatus: list[i] }));

test('compatibility gate: the full-mode verdict FAILS the real short-window shape, so it cannot be reused unchanged', () => {
  const full = savedFocusIdentityVerdict(shortWindow());
  assert.equal(full.verdict, 'FAIL');
  assert.deepEqual(full.mismatchedOrdinals, [3, 4]);
});

test('exercised points are exactly the window-scored ones of focusWindowVerdict, never chosen by rail strings', () => {
  assert.deepEqual(inWindowOrdinals(WINDOW.windows, WINDOW.recordingWindowMs), [1, 2]);
  const w = focusWindowVerdict({ windows: WINDOW.windows, expected: ['covered', 'missing', 'covered', 'covered'],
                                 statuses: ['covered', 'missing', 'pending', 'pending'], recordingWindowMs: WINDOW.recordingWindowMs });
  assert.equal(w.facts.eligiblePoints, 2);
  const r = smokeSavedFocusVerdict(shortWindow(), WINDOW);
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual([r.exercisedOrdinals, r.unexercisedOrdinals, r.errors], [[1, 2], [3, 4], []]);
});

test("Sam's reproduction: an unknown in-window rail, its missing evidence and missing review ordinal FAIL, never 'unexercised'", () => {
  const input = shortWindow({ expected: rails(['covered', 'BROKEN', 'pending', 'pending']),
                              evidence: shortWindow().evidence.filter(e => e.brief_point_id !== 'p1'),
                              visibleEvidence: ['Detected: point 1 at 0:05.', 'Not detected: point 3, point 4.'] });
  const r = smokeSavedFocusVerdict(input, WINDOW);
  assert.equal(r.verdict, 'FAIL');
  assert.ok(r.errors.includes('unknown rail status at point 2'));
  assert.ok(r.errors.some(e => /missing saved verdict at point 2|rail status is pending or unavailable at point 2/.test(e)));
  assert.deepEqual(r.unexercisedOrdinals, [3, 4]);
});

test('in-window pending or unsaved points FAIL; an unknown rail OUTSIDE the window still FAILS', () => {
  assert.equal(smokeSavedFocusVerdict(shortWindow({ expected: rails(['covered', 'pending', 'pending', 'pending']) }), WINDOW).verdict, 'FAIL');
  assert.equal(smokeSavedFocusVerdict(shortWindow({ evidence: shortWindow().evidence.filter(e => e.brief_point_id !== 'p0') }), WINDOW).verdict, 'FAIL');
  assert.equal(smokeSavedFocusVerdict(shortWindow({ expected: rails(['covered', 'missing', 'pending', 'weird']) }), WINDOW).verdict, 'FAIL');
});

test('an altered window or brief cannot pass: a longer window brings pending points into scope; another brief fails', () => {
  assert.equal(smokeSavedFocusVerdict(shortWindow(), { ...WINDOW, recordingWindowMs: 30000 }).verdict, 'FAIL');   // point 3 now in-window, pending
  assert.equal(smokeSavedFocusVerdict(shortWindow({ savedBriefId: 'brief-2' }), WINDOW).verdict, 'FAIL');
  assert.equal(smokeSavedFocusVerdict(shortWindow({ expectedBriefId: 'brief-0' }), WINDOW).verdict, 'FAIL');
});

test('identity is checked for ALL points, exercised or not', () => {
  const cases = {
    'an unexercised point label differs': shortWindow({ savedPoints: shortWindow().savedPoints.map((p, i) => i === 3 ? { ...p, label: 'Other' } : p) }),
    'order swapped': shortWindow({ savedPoints: shortWindow().savedPoints.map((p, i) => i === 0 ? { ...p, sort_order: 1 } : i === 1 ? { ...p, sort_order: 0 } : p) }),
    'a point count mismatch': shortWindow({ savedPoints: shortWindow().savedPoints.slice(0, 3) }),
    'evidence for an out-of-brief point': shortWindow({ evidence: [...shortWindow().evidence, { brief_point_id: 'x9', verdict: 'detected' }] }),
    'unparseable review evidence': shortWindow({ visibleEvidence: ['Something else.'] }),
    'no review evidence at all': shortWindow({ visibleEvidence: [] }),
  };
  for (const [name, input] of Object.entries(cases)) assert.equal(smokeSavedFocusVerdict(input, WINDOW).verdict, 'FAIL', name);
});

test('no in-window point, or no usable window, is NOT RUN, never PASS', () => {
  assert.equal(smokeSavedFocusVerdict(shortWindow(), { ...WINDOW, recordingWindowMs: 5000 }).verdict, 'NOT RUN');
  assert.equal(smokeSavedFocusVerdict(shortWindow(), { windows: WINDOW.windows.slice(0, 3), recordingWindowMs: 22850 }).verdict, 'NOT RUN');
  assert.equal(smokeSavedFocusVerdict(shortWindow(), {}).verdict, 'NOT RUN');
});
