import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { buildMainU1ReplayPlan, parseMainProofArguments } from './account-closure-full-chain.mjs';
import { functionDefinitions } from '../../scripts/lib/c1MigrationPostflight.mjs';
import { RETIREMENT_CATALOG_DELTA } from '../../scripts/lib/retirementCatalogPins.mjs';
import { ABANDONMENT_CATALOG_DELTA } from '../../scripts/lib/abandonmentCatalogPins.mjs';
import { FEEDBACK_FENCE_CATALOG_DELTA } from '../../scripts/lib/feedbackFenceCatalogPins.mjs';

const directory = new URL('../../backend/supabase/migrations/', import.meta.url);
const rows = readdirSync(directory).filter(name => name.endsWith('.sql')).map(name => ({
  name, version: name.match(/^(\d{8}|\d{14})_/)?.[1] ?? null,
  sha256: createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex'),
}));
const profile = 'main-coaching-retirement-129';
const retirement = '20261110173548';
const billing = '20261027192550';
const abandonment = '20261112133000';
// #1829's refund follow-up table: outside the account-closure chain, withheld by every profile.
const refund = '20261112130000';
// #1811 AHT-02/07/08 feedback fence (ledger 11): withheld by every profile before main-feedback-fence-131.
const feedbackFence = '20261114100000';

test('successor delta covers every source-defined function and changed table exactly', () => {
  const source = readFileSync(new URL('20261110173548_account_coaching_local_retirement.sql', directory), 'utf8');
  const functions = functionDefinitions(source);
  assert.equal(functions.length, 6);
  const keys = functions.map(fn => `function:${fn.signature.replaceAll(',', ', ')}`);
  keys.push('table:public.account_coaching_operations', ...[...source.matchAll(/CREATE TABLE public\.([a-z_0-9]+)/g)]
    .map(match => `table:public.${match[1]}`));
  assert.deepEqual(Object.keys(RETIREMENT_CATALOG_DELTA).sort(), keys.sort());
});

test('installed retirement profile replays exact128 then retirement, withholding billing129', () => {
  assert.equal(parseMainProofArguments([`--profile=${profile}`]).profile, profile);
  const plan = buildMainU1ReplayPlan(rows, profile);
  assert.equal(plan.repositoryMigrations, 133);
  assert.equal(plan.migrations, 129);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]),
    [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'], [abandonment, 'NOT REPLAYED'], [feedbackFence, 'NOT REPLAYED']]);
  assert.equal(plan.stages.at(-1).name, 'coaching-local-retirement');
  assert.equal(plan.stages.at(-2).name, 'content-free-retention');
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, retirement]);
  assert.ok(plan.stages.every(stage => !stage.versions.includes(billing)));
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(retirement)));
  assert.equal(plan.executed, false);
});

test('historical billing129 stays unchanged and retirement bytes remain separately withheld', () => {
  const historical = buildMainU1ReplayPlan(rows, 'main-completion-billing-129');
  assert.deepEqual(historical.withheld.map(row => row.version), [retirement, refund, abandonment, feedbackFence]);
  assert.equal(historical.stages.at(-1).name, 'completion-billing');
  assert.ok(historical.stages.every(stage => !stage.versions.includes(retirement)));
});

test('retirement profile refuses changed installed or withheld bytes and unknown successors', () => {
  for (const version of [retirement, billing, refund, abandonment, '20261025021046']) {
    assert.throws(() => buildMainU1ReplayPlan(rows.map(row => row.version === version
      ? { ...row, sha256: '0'.repeat(64) } : row), profile), /digest changed/);
  }
  assert.throws(() => buildMainU1ReplayPlan([...rows, {
    name: '20261111120000_unknown.sql', version: '20261111120000', sha256: '0'.repeat(64),
  }], profile), /unreviewed migration/);
});

const abandonmentProfile = 'main-start-abandonment-130';

test('abandonment delta covers exactly its source-defined functions and created table', () => {
  const source = readFileSync(new URL('20261112133000_recording_start_abandonment_1643.sql', directory), 'utf8');
  const keys = functionDefinitions(source).map(fn => `function:${fn.signature.replaceAll(',', ', ')}`);
  assert.equal(keys.length, 3);
  keys.push(...[...source.matchAll(/CREATE TABLE public\.([a-z_0-9]+)/g)].map(match => `table:public.${match[1]}`));
  assert.deepEqual(Object.keys(ABANDONMENT_CATALOG_DELTA).sort(), keys.sort());
});

test('installed abandonment profile replays retirement then 20261112133000, withholding billing129 and the refund', () => {
  assert.equal(parseMainProofArguments([`--profile=${abandonmentProfile}`]).profile, abandonmentProfile);
  const plan = buildMainU1ReplayPlan(rows, abandonmentProfile);
  assert.equal(plan.migrations, 130);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]),
    [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'], [feedbackFence, 'NOT REPLAYED']]);
  assert.equal(plan.stages.at(-1).name, 'start-abandonment');
  assert.equal(plan.stages.at(-2).name, 'coaching-local-retirement');
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, abandonment]);
  assert.deepEqual(plan.stages.at(-2).versions, buildMainU1ReplayPlan(rows, profile).stages.at(-1).versions);
  assert.ok(plan.stages.every(stage => !stage.versions.includes(billing) && !stage.versions.includes(refund)));
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(abandonment)));
  assert.equal(plan.executed, false);
});

test('abandonment profile refuses changed installed or withheld bytes and unknown successors', () => {
  for (const version of [abandonment, retirement, billing, refund]) {
    assert.throws(() => buildMainU1ReplayPlan(rows.map(row => row.version === version
      ? { ...row, sha256: '0'.repeat(64) } : row), abandonmentProfile), /digest changed/);
  }
  assert.throws(() => buildMainU1ReplayPlan([...rows, {
    name: '20261113120000_unknown.sql', version: '20261113120000', sha256: '0'.repeat(64),
  }], abandonmentProfile), /unreviewed migration/);
});

const feedbackFenceProfile = 'main-feedback-fence-131';

test('feedback-fence delta covers exactly its source-defined functions, created table and write trigger', () => {
  const source = readFileSync(new URL('20261114100000_rwt_feedback_fence_1811.sql', directory), 'utf8');
  const keys = functionDefinitions(source).map(fn => `function:${fn.signature.replaceAll(',', ', ')}`);
  assert.equal(keys.length, 6);
  keys.push(...[...source.matchAll(/CREATE TABLE public\.([a-z_0-9]+)/g)].map(match => `table:public.${match[1]}`));
  keys.push(...[...source.matchAll(/CREATE TRIGGER ([a-z_0-9]+)\s+BEFORE INSERT ON public\.([a-z_0-9]+)/g)]
    .map(match => `trigger:public.${match[2]}.${match[1]}`));
  assert.deepEqual(Object.keys(FEEDBACK_FENCE_CATALOG_DELTA).sort(), keys.sort());
});

test('installed feedback-fence profile replays the abandonment then 20261114100000, withholding billing129 and the refund', () => {
  assert.equal(parseMainProofArguments([`--profile=${feedbackFenceProfile}`]).profile, feedbackFenceProfile);
  const plan = buildMainU1ReplayPlan(rows, feedbackFenceProfile);
  assert.equal(plan.migrations, 131);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]), [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED']]);
  assert.equal(plan.stages.at(-1).name, 'feedback-fence');
  assert.equal(plan.stages.at(-2).name, 'start-abandonment');
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, feedbackFence]);
  assert.deepEqual(plan.stages.at(-2).versions, buildMainU1ReplayPlan(rows, abandonmentProfile).stages.at(-1).versions);
  assert.ok(plan.stages.every(stage => !stage.versions.includes(billing) && !stage.versions.includes(refund)));
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(feedbackFence)));
  assert.equal(plan.executed, false);
});

test('feedback-fence profile refuses changed installed or withheld bytes and unknown successors', () => {
  for (const version of [feedbackFence, abandonment, retirement, billing, refund]) {
    assert.throws(() => buildMainU1ReplayPlan(rows.map(row => row.version === version
      ? { ...row, sha256: '0'.repeat(64) } : row), feedbackFenceProfile), /digest changed/);
  }
  assert.throws(() => buildMainU1ReplayPlan([...rows, {
    name: '20261115120000_unknown.sql', version: '20261115120000', sha256: '0'.repeat(64),
  }], feedbackFenceProfile), /unreviewed migration/);
});
