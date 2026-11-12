import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { buildMainU1ReplayPlan, parseMainProofArguments } from './account-closure-full-chain.mjs';
import { functionDefinitions } from '../../scripts/lib/c1MigrationPostflight.mjs';
import { RETIREMENT_CATALOG_DELTA } from '../../scripts/lib/retirementCatalogPins.mjs';

const directory = new URL('../../backend/supabase/migrations/', import.meta.url);
const rows = readdirSync(directory).filter(name => name.endsWith('.sql')).map(name => ({
  name, version: name.match(/^(\d{8}|\d{14})_/)?.[1] ?? null,
  sha256: createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex'),
}));
const profile = 'main-coaching-retirement-129';
const retirement = '20261110173548';
const billing = '20261027192550';
// #1829's refund follow-up table: outside the account-closure chain, withheld by every profile.
const refund = '20261112130000';

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
  assert.equal(plan.repositoryMigrations, 131);
  assert.equal(plan.migrations, 129);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]), [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED']]);
  assert.equal(plan.stages.at(-1).name, 'coaching-local-retirement');
  assert.equal(plan.stages.at(-2).name, 'content-free-retention');
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, retirement]);
  assert.ok(plan.stages.every(stage => !stage.versions.includes(billing)));
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(retirement)));
  assert.equal(plan.executed, false);
});

test('historical billing129 stays unchanged and retirement bytes remain separately withheld', () => {
  const historical = buildMainU1ReplayPlan(rows, 'main-completion-billing-129');
  assert.deepEqual(historical.withheld.map(row => row.version), [retirement, refund]);
  assert.equal(historical.stages.at(-1).name, 'completion-billing');
  assert.ok(historical.stages.every(stage => !stage.versions.includes(retirement)));
});

test('retirement profile refuses changed installed or withheld bytes and unknown successors', () => {
  for (const version of [retirement, billing, refund, '20261025021046']) {
    assert.throws(() => buildMainU1ReplayPlan(rows.map(row => row.version === version
      ? { ...row, sha256: '0'.repeat(64) } : row), profile), /digest changed/);
  }
  assert.throws(() => buildMainU1ReplayPlan([...rows, {
    name: '20261111120000_unknown.sql', version: '20261111120000', sha256: '0'.repeat(64),
  }], profile), /unreviewed migration/);
});
