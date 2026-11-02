'use strict';
// Proof v2, diagnostic-code and latency corrections: asserted directly against the vendored coaching-failure-policy.cjs (read-only).
// COACHING_FAILURE_POLICY points at a mutated temp copy for the mutation controls.
// Run: node --test --test-reporter=tap tools/cloud-test/tests/node/coaching-failure-policy-controls.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const policy = require(process.env.COACHING_FAILURE_POLICY || path.join(__dirname, '..', '..', 'harness', 'draft-adapters', 'coaching-failure-policy.cjs'));
const json = (o) => ({ contentType: 'application/json', body: JSON.stringify(o) });

test('CF1 a listed error code is kept only as a closed allowlist value', () => {
  assert.equal(policy.classifyFailureResponse(json({ code: 'upstream_timeout' })).errorCode, 'code-upstream_timeout');
  assert.equal(policy.classifyFailureResponse(json({ error: 'Upstream-Timeout' })).errorCode, 'code-upstream_timeout');
});

test('CF2 an identifier-shaped code that is not on the allowlist becomes code-unlisted', () => {
  for (const code of ['user_8f3a2b91', 'session-abc123', 'token.fragment']) {
    assert.equal(policy.classifyFailureResponse(json({ code })).errorCode, 'code-unlisted', code);
  }
});

test('CF3 no message text, header or body content survives classification', () => {
  const r = policy.classifyFailureResponse({ ...json({ code: 'bad_gateway', message: 'PRIVATE transcript text', detail: 'secret-token-value' }), retryAfter: '30' });
  const text = JSON.stringify(r);
  for (const leaked of ['PRIVATE', 'transcript', 'secret-token-value']) assert.ok(!text.includes(leaked), leaked);
  assert.equal(r.errorCode, 'code-bad_gateway');
  assert.equal(r.retryAfterPresent, true);
});

test('CF4 a code that is not identifier-shaped is not recorded at all', () => {
  assert.equal(policy.classifyFailureResponse(json({ code: 'has spaces in it' })).errorCode, null);
  assert.equal(policy.classifyFailureResponse({ contentType: 'text/html', body: '<html>bad_gateway</html>' }).errorCode, null);
});

test('LT1 latency is measured from the request event to the response event', () => {
  const r = policy.classifyFailureResponse({ ...json({ code: 'bad_gateway' }), startedAt: 1000, respondedAt: 1450, browserTimingMs: 999 });
  assert.equal(r.elapsedMs, 450);
  assert.equal(r.latencyBasis, 'request-event-to-response-event');
  assert.equal(r.browserTimingMs, 999);
});

test('LT2 a missing measurement is null, never a fallback from another clock', () => {
  for (const timing of [{}, { startedAt: 1000 }, { respondedAt: 1450 }, { startedAt: 1000, browserTimingMs: 450 }]) {
    const r = policy.classifyFailureResponse({ ...json({ code: 'bad_gateway' }), ...timing });
    assert.equal(r.elapsedMs, null, JSON.stringify(timing));
    assert.equal(r.latencyBasis, 'unavailable', JSON.stringify(timing));
  }
});

test('LT3 a response event before the request event is null, never a negative or clamped latency', () => {
  const r = policy.classifyFailureResponse({ ...json({ code: 'bad_gateway' }), startedAt: 2000, respondedAt: 1500 });
  assert.equal(r.elapsedMs, null);
  assert.equal(r.latencyBasis, 'unavailable');
});
