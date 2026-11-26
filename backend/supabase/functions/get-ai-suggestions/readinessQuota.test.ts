import { strict as assert } from 'node:assert';
import { readGeminiReadinessQuota } from './readinessQuota.ts';
const model = 'gemini-3.6-flash';
const known = { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
  quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaDimensions: { model } };
const quota = (violations: unknown[]) => ({ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations });
const retry = (retryDelay: unknown) => ({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay });
const body = (...details: unknown[]) => JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details } });
Deno.test('only explicit per-model quota evidence allows a model-scoped 429', () => {
  assert.deepEqual(readGeminiReadinessQuota(body(quota([known])), model), { scope: 'model', retryAfterMs: undefined });
  for (const detail of [quota([]), quota([{ ...known, quotaDimensions: {} }]), quota([known, { ...known, quotaId: 'ProjectWide' }]),
    quota([{ ...known, quotaDimensions: { model: 'gemini-other' } }])]) {
    assert.equal(readGeminiReadinessQuota(body(detail), model)?.scope, 'unknown');
  }
  assert.equal(readGeminiReadinessQuota('fake or malformed', model), null);
});
Deno.test('bounded structured RetryInfo is retained even on model-specific quota; malformed hint never permits switching', () => {
  assert.deepEqual(readGeminiReadinessQuota(body(quota([known]),retry('31.025s')), model), { scope: 'model', retryAfterMs: 31025 });
  assert.equal(readGeminiReadinessQuota(body(quota([known]),retry('later')), model)?.scope,'unknown');
});
