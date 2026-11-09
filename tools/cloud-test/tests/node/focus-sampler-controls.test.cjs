'use strict';
// Proof v2, live-sampler correction (Sam 1793383008): the ACTUAL in-page Focus sampler of the vendored presentation-controls.cjs is run in a
// vm sandbox over a fake rail (as the vendored presentation-controls test does), so the marker count per sample is produced by the sampler
// itself, never handed to the oracle. PRESENTATION_CONTROLS points at a mutated temp copy for the mutation controls.
// Run: node --test --test-reporter=tap tools/cloud-test/tests/node/focus-sampler-controls.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const p = require(process.env.PRESENTATION_CONTROLS || path.join(__dirname, '..', '..', 'harness', 'draft-adapters', 'presentation-controls.cjs'));

// A four-point rail. `marked` lists the rows showing "Still to cover" at each sample; statuses follow the first marked row.
function rail(marked) {
  let tick = null;
  const state = { marked };
  const sandbox = {
    window: {},
    document: {
      querySelector: (selector) => {
        const i = Number((selector.match(/focus-point-(\d+)/) || [])[1]);
        return {
          getAttribute: () => (i < Math.min(...state.marked) ? 'covered' : 'pending'),
          querySelectorAll: () => [{ textContent: state.marked.includes(i) ? 'Still to cover' : 'other' }],
        };
      },
      querySelectorAll: () => [],
    },
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
  };
  const page = { evaluate: async (fn, arg) => vm.runInNewContext('(' + fn.toString() + ')(arg)', { ...sandbox, arg }) };
  return { page, state, sample: () => tick && tick() };
}

test('FS1 the live sampler counts two Still-to-cover markers in one sample and the marker row FAILs as duplicate-marker', async () => {
  const r = rail([0]);
  const w = await p.beginFocusLive(r.page, 4);
  assert.equal(w.armed, true);
  r.state.marked = [1, 2];
  r.sample();
  const { rows, observed } = await p.freezeFocusLiveDetailed(r.page, w);
  // The freeze takes one more sample of the same rail, so every recorded sample carries exactly two markers.
  assert.ok(observed.multiMarker.length >= 1);
  assert.ok(Array.from(observed.multiMarker).every((m) => m[1] === 2));
  const marker = rows.find((x) => x.id === 'focus-next-point-marked');
  assert.equal(marker.result, 'FAIL');
  assert.equal(marker.facts.resultBasis, 'duplicate-marker');
  assert.equal(marker.facts.maxMarkersInASample, 2);
});

test('FS2 one Still-to-cover marker per sample is never counted as a duplicate and the marker row PASSes', async () => {
  const r = rail([0]);
  const w = await p.beginFocusLive(r.page, 4);
  r.state.marked = [1];
  r.sample();
  const { rows, observed } = await p.freezeFocusLiveDetailed(r.page, w);
  assert.equal(observed.multiMarker.length, 0);
  const marker = rows.find((x) => x.id === 'focus-next-point-marked');
  assert.equal(marker.result, 'PASS');
  assert.equal(marker.facts.duplicateMarkerSamples, 0);
});
