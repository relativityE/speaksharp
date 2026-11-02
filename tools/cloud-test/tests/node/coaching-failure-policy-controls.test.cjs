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

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_ID = 'a'.repeat(40);
const attempt = (over = {}) => policy.newAttempt(1, {
  sessionId: '33333333-3333-4333-8333-333333333333', diagnostic_request_id: REQUEST_ID,
  diagnostic_attempt_id: ATTEMPT_ID, client_attempt: 1, client_release_id: RELEASE_ID, ...over,
});
const diagnosticBody = (over = {}) => JSON.stringify({ suggestions: { private: 'not retained' }, diagnostics: {
  schema_version: 'coaching_diagnostic_v1', request_id: REQUEST_ID, attempt_id: ATTEMPT_ID,
  client_attempt: 1, client_release_id: RELEASE_ID, status: 200, outcome: 'success', ...over,
} });

test('RC1 exact browser request and Edge response diagnostics correlate without retaining identifiers or prose', () => {
  const a = attempt();
  const result = policy.classifyResponseCorrelation(a, { contentType: 'application/json', body: diagnosticBody(), status: 200 });
  assert.deepEqual(result, { basis: 'browser-request-response', authority: 'browser-correlation-only', available: true, matched: true,
    schemaMatched: true, requestIdMatched: true, attemptIdMatched: true, clientAttemptMatched: true,
    releaseMatched: true, statusMatched: true, outcomeMatched: true });
  assert.ok(!JSON.stringify(result).includes(REQUEST_ID));
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('RC2 every bounded identity, status and outcome mismatch fails correlation closed', () => {
  const cases = [
    ['request_id', '44444444-4444-4444-8444-444444444444', 'requestIdMatched'],
    ['attempt_id', '55555555-5555-4555-8555-555555555555', 'attemptIdMatched'],
    ['client_attempt', 2, 'clientAttemptMatched'], ['client_release_id', 'b'.repeat(40), 'releaseMatched'],
    ['status', 201, 'statusMatched'], ['outcome', 'failure', 'outcomeMatched'],
  ];
  for (const [field, value, flag] of cases) {
    const result = policy.classifyResponseCorrelation(attempt(), { contentType: 'application/json', body: diagnosticBody({ [field]: value }), status: 200 });
    assert.equal(result.available, true, field); assert.equal(result.matched, false, field); assert.equal(result[flag], false, field);
  }
});

test('RC3 malformed, oversized, non-JSON and incomplete inputs are unavailable, never matched', () => {
  const inputs = [
    { contentType: 'application/json', body: '{', status: 200 },
    { contentType: 'text/plain', body: diagnosticBody(), status: 200 },
    { contentType: 'application/json', body: JSON.stringify({ diagnostics: { request_id: 'secret-token' } }), status: 200 },
    { contentType: 'application/json', body: 'x'.repeat(262145), status: 200 },
  ];
  for (const input of inputs) { const result=policy.classifyResponseCorrelation(attempt(), input);assert.deepEqual([result.available,result.matched],[false,null]); }
  const empty=policy.classifyResponseCorrelation(policy.newAttempt(1, {}), { contentType: 'application/json', body: diagnosticBody(), status: 200 });
  assert.deepEqual([empty.available,empty.matched],[false,null]);
  assert.equal(policy.classifyResponseCorrelation(attempt({ client_release_id: 'not-a-release' }), { contentType: 'application/json', body: diagnosticBody(), status: 200 }).available,false);
});

test('RC3b an exact non-null release is mandatory; paired missing releases never match', () => {
  const missingRequest = attempt({ client_release_id: undefined });
  const missingResponse = diagnosticBody({ client_release_id: null });
  const result = policy.classifyResponseCorrelation(missingRequest, { contentType: 'application/json', body: missingResponse, status: 200 });
  assert.deepEqual([result.available,result.matched,result.releaseMatched],[false,null,null]);
  const exactRequest = attempt();
  const absentResponse = policy.classifyResponseCorrelation(exactRequest, { contentType: 'application/json', body: missingResponse, status: 200 });
  assert.deepEqual([absentResponse.available,absentResponse.matched,absentResponse.releaseMatched],[true,false,false]);
});

test('RC4 closed attempt evidence carries only the correlation verdict and labels its limited authority', () => {
  const a = attempt(); policy.finish(a, 200);
  a.correlation = policy.classifyResponseCorrelation(a, { contentType: 'application/json', body: diagnosticBody(), status: 200 });
  const value = policy.closed(a, { first: '33333333-3333-4333-8333-333333333333' });
  assert.equal(value.correlation.available, true); assert.equal(value.correlation.matched, true); assert.equal(value.correlation.authority, 'browser-correlation-only');
  const encoded = JSON.stringify(value); assert.ok(!encoded.includes(REQUEST_ID)); assert.ok(!encoded.includes(ATTEMPT_ID));
});

// PO 2026-11-02 / Sam 1793655489.910839: a provider-caused coaching failure is recorded by the Edge's own decoded code and is NOT RUN, never PASS.
const take = (ordinal, status, body) => {
  const a = policy.newAttempt(ordinal, { sessionId: 'take-1' });
  policy.finish(a, status);
  if (body) a.diag = policy.classifyFailureResponse({ ...json(body), startedAt: 1, respondedAt: 2 });
  return a;
};
const ids = { first: 'take-1', second: null };
// The coaching Edge's failure body: get-ai-suggestions returns `diagnostics` (coaching_diagnostic_v1) with providerDecode's fields.
const edge = (diag) => ({ error: 'Coaching is unavailable.', diagnostics: { schema_version: 'coaching_diagnostic_v1', outcome: 'failure', ...diag } });
const providerLimit = edge({ phase: 'provider', reason: 'provider_http_4xx', provider_status: 429, provider_error_status: 'RESOURCE_EXHAUSTED',
  provider_error_reason: 'RATE_LIMIT_EXCEEDED', provider_attempts: 3 });
const providerDown = edge({ phase: 'provider', reason: 'provider_http_5xx', provider_status: 503, provider_error_status: 'UNAVAILABLE', provider_attempts: 3 });

test('PC1 an Edge-decoded provider limit or outage is NOT RUN with its exact code, never FAIL', () => {
  for (const [body, code] of [[providerLimit, 'RESOURCE_EXHAUSTED/429'], [providerDown, 'UNAVAILABLE/503']]) {
    const decision = policy.decideGrounded({ attempts: [take(1, 502, body)], ids, oracleResult: null });
    assert.deepEqual([decision.result, decision.facts.basis, decision.facts.providerCodes], ['NOT RUN', 'provider-condition-recorded', [code]]);
  }
  const attempt = take(1, 502, providerLimit);
  assert.deepEqual(attempt.diag.provider, { providerStatus: 429, canonicalStatus: 'RESOURCE_EXHAUSTED', providerAttempts: 3 });
  assert.equal(JSON.stringify(attempt.diag).includes('RATE_LIMIT_EXCEEDED'), false, 'only the closed canonical status is kept');
});

test('PC2 SpeakSharp\'s own quota, a product failure, any other provider status or a mix stays FAIL', () => {
  const ownQuota = edge({ phase: 'quota', reason: 'quota_exceeded', provider_status: null, provider_error_status: null });
  const badShape = edge({ phase: 'provider', reason: 'invalid_shape', provider_status: 200, provider_error_status: null });
  const denied = edge({ phase: 'provider', reason: 'provider_http_4xx', provider_status: 403, provider_error_status: 'PERMISSION_DENIED' });
  for (const attempts of [[take(1, 429, ownQuota)], [take(1, 502, badShape)], [take(1, 502, denied)], [take(1, 500)],
    [take(1, 502, providerLimit), take(2, 502, badShape)]]) {
    const decision = policy.decideGrounded({ attempts, ids, oracleResult: null });
    assert.deepEqual([decision.result, decision.facts.basis, decision.facts.providerCodes], ['FAIL', 'failed-coaching-attempt-preserved', undefined]);
  }
});

test('PC3 a provider condition stays NOT RUN even after a verified later success, never PASS', () => {
  for (const oracle of ['PASS', 'FAIL']) {
    const decision = policy.decideGrounded({ attempts: [take(1, 502, providerLimit), take(2, 200)], ids, oracleResult: { result: oracle } });
    assert.deepEqual([decision.result, decision.facts.providerCodes], ['NOT RUN', ['RESOURCE_EXHAUSTED/429']], oracle);
  }
});
