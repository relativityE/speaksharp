'use strict';
// Proof v2, marker corrections (Sam 1793382389): the original live Focus marker behaviours, asserted directly against the vendored
// focus-oracle.cjs (read-only; the harness bytes stay pinned). FOCUS_ORACLE points at a mutated temp copy for the mutation controls.
// Run: node --test --test-reporter=tap tools/cloud-test/tests/node/focus-oracle-controls.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const oracle = require(process.env.FOCUS_ORACLE || path.join(__dirname, '..', '..', 'harness', 'draft-adapters', 'focus-oracle.cjs'));
const P = 'pending', PA = 'partial', C = 'covered';
const observed = (timeline, multiMarker = []) => ({ frozen: true, samples: 40, unreadable: 0, timeline, multiMarker });
const STEADY = [[0, 0, [P, P, P, P]], [12003, 0, [P, P, PA, P]], [23501, 0, [P, P, PA, C]]];

test('FO1 a duplicate marker in one sample FAILs as duplicate-marker', () => {
  const r = oracle.markerVerdict(observed(STEADY, [[5000, 2]]));
  assert.equal(r.result, 'FAIL');
  assert.equal(r.facts.resultBasis, 'duplicate-marker');
  assert.equal(r.facts.firstDuplicateMarkerMs, 5000);
});

test('FO2 the live sampler counts markers per sample', () => {
  const r = oracle.markerVerdict(observed(STEADY, [[5000, 2], [6000, 3], [7000, 1]]));
  assert.equal(r.facts.duplicateMarkerSamples, 2);
  assert.equal(r.facts.maxMarkersInASample, 3);
});

test('FO3 one marker per sample on the first pending point stays PASS', () => {
  const r = oracle.markerVerdict(observed(STEADY, [[5000, 1]]));
  assert.equal(r.result, 'PASS');
  assert.equal(r.facts.duplicateMarkerSamples, 0);
  assert.equal(r.facts.maxMarkersInASample, 1);
});

test('FO4 a status that goes backwards is NOT RUN, never PASS', () => {
  const r = oracle.markerVerdict(observed([[0, 0, [P, C, P, P]], [1000, 0, [P, P, P, P]]]));
  assert.equal(r.result, 'NOT RUN');
  assert.equal(r.facts.resultBasis, 'contradictory-state');
  assert.deepEqual(r.facts.contradictionKinds, ['status-went-backwards']);
  assert.equal(r.facts.statusRegressions, 1);
});

test('FO5 a real marker defect is never hidden by a contradiction', () => {
  const r = oracle.markerVerdict(observed([[0, 0, [P, C, P, P]], [1000, 2, [P, P, P, P]]]));
  assert.equal(r.result, 'FAIL');
  assert.equal(r.facts.resultBasis, 'marker-wrong');
  assert.ok(r.facts.contradictionKinds.includes('status-went-backwards'));
});

test('FO6 timestamps that go backwards are a contradiction, never PASS', () => {
  const r = oracle.markerVerdict(observed([[5000, 0, [P, P, P, P]], [1000, 0, [P, P, PA, P]]]));
  assert.equal(r.result, 'NOT RUN');
  assert.ok(r.facts.contradictionKinds.includes('timestamps-went-backwards'));
});
