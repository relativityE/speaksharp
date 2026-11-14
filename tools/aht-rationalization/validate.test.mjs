import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMapping } from './validate.mjs';

const catalog = JSON.parse(readFileSync(new URL('./catalog.fixture.json', import.meta.url), 'utf8'));
const original = JSON.parse(readFileSync(new URL('./mapping.json', import.meta.url), 'utf8'));
const mutate = change => { const map = structuredClone(original); change(map); return validateMapping(catalog, map); };
test('all 204 original rows map exactly once without a fixed journey count', () => {
  assert.equal(original.rows.length, 204);
  assert.deepEqual(validateMapping(catalog, original), []);
  const map = structuredClone(original);
  const old = map.journeys.find(j => j.cases.includes('AHT-15'));
  old.cases = old.cases.filter(id => id !== 'AHT-15');
  map.journeys.push({ ...old, id: 'J-extra', cases: ['AHT-15'] });
  map.rows.filter(r => r.caseId === 'AHT-15').forEach(r => { r.journey = 'J-extra'; });
  assert.deepEqual(validateMapping(catalog, map), []);
});
test('dropping a historical assertion fails closed', () => {
  assert.match(mutate(m => m.rows.pop()).join('\n'), /missing assertion/);
});
test('duplicating a row cannot conceal a missing row', () => {
  assert.match(mutate(m => { m.rows.pop(); m.rows.push(m.rows[0]); }).join('\n'), /duplicate assertion/);
});
test('unknown rows do not expand the denominator silently', () => {
  assert.match(mutate(m => { m.rows[0].assertion = 'invented-pass'; }).join('\n'), /unknown assertion/);
});
test('each live journey must explain risk, isolation and pass evidence', () => {
  for (const field of ['uniqueRisk', 'isolation', 'passEvidence']) {
    assert.match(mutate(m => { m.journeys[0][field] = ''; }).join('\n'), /missing/);
  }
});
test('fast destination is not itself demotion proof', () => {
  assert.match(mutate(m => { m.rows.find(r => r.candidateFastTests.length).disposition = 'demote-with-reviewed-proof'; }).join('\n'), /demotion lacks/);
});
test('reviewed demotion requires exact source, baseline and causal evidence', () => {
  const map = structuredClone(original);
  const row = map.rows.find(r => r.candidateFastTests.length);
  row.disposition = 'demote-with-reviewed-proof';
  row.replacementProof = { sourceSha: 'a'.repeat(40), testPath: 'synthetic.test.ts', behavioralAssertion: 'specific assertion', baselineEvidence: 'synthetic baseline', mutationEvidence: 'synthetic intended failure', reviewEvidence: 'synthetic review' };
  assert.deepEqual(validateMapping(catalog, map), []);
  delete row.replacementProof.mutationEvidence;
  assert.match(validateMapping(catalog, map).join('\n'), /demotion lacks/);
});
test('live safety checks cannot be demoted even with proof fields', () => {
  assert.match(mutate(m => { m.rows.find(r => r.assertion === 'owner-bound').disposition = 'keep-live'; }).join('\n'), /safety observation/);
});
test('case cannot silently move to another scenario or be assigned twice', () => {
  assert.match(mutate(m => { m.rows[0].journey = 'J02'; }).join('\n'), /wrong journey/);
  assert.match(mutate(m => { m.journeys[1].cases.push('AHT-01'); }).join('\n'), /case assigned twice/);
});
test('billing cannot disappear from the plan', () => {
  assert.match(mutate(m => { m.additionalRequirements = []; }).join('\n'), /billing needs/);
});
test('proposal cannot be relabelled as executable or release evidence', () => {
  assert.match(mutate(m => { m.status = 'passed'; }).join('\n'), /non-executable/);
});
