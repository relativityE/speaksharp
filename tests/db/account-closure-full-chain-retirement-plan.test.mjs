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
import { PAYMENT_WALL_T2_CATALOG_DELTA, PRACTICE_PRIVACY_T2_CATALOG_DELTA } from '../../scripts/lib/paymentWallPrivacyT2CatalogPins.mjs';

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
// #1863 payment wall: withheld by every profile before main-payment-wall-132 (ledger 12).
const paymentWall = '20261114170000';
// #1835 practice privacy: withheld by every profile before main-practice-privacy-133 (ledger 13).
const practicePrivacy = '20261117105700';
// #1827 D2 repeat tip: withheld by every profile until its own reviewed stage exists.
const repeatTip = '20261119120000';
// #1643 follow-up deleted-account save-journal cleanup: repository inventory withheld by every profile.
const saveJournalCleanup = '20261119200000';

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
  assert.equal(plan.repositoryMigrations, 137);
  assert.equal(plan.migrations, 129);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]),
    [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'], [abandonment, 'NOT REPLAYED'], [feedbackFence, 'NOT REPLAYED'],
      [paymentWall, 'NOT REPLAYED'], [practicePrivacy, 'NOT REPLAYED'], [repeatTip, 'NOT REPLAYED'], [saveJournalCleanup, 'NOT REPLAYED']]);
  assert.equal(plan.stages.at(-1).name, 'coaching-local-retirement');
  assert.equal(plan.stages.at(-2).name, 'content-free-retention');
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, retirement]);
  assert.ok(plan.stages.every(stage => !stage.versions.includes(billing)));
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(retirement)));
  assert.equal(plan.executed, false);
});

test('historical billing129 stays unchanged and retirement bytes remain separately withheld', () => {
  const historical = buildMainU1ReplayPlan(rows, 'main-completion-billing-129');
  assert.deepEqual(historical.withheld.map(row => row.version), [retirement, refund, abandonment, feedbackFence, paymentWall, practicePrivacy, repeatTip, saveJournalCleanup]);
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
    [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'], [feedbackFence, 'NOT REPLAYED'], [paymentWall, 'NOT REPLAYED'],
      [practicePrivacy, 'NOT REPLAYED'], [repeatTip, 'NOT REPLAYED'], [saveJournalCleanup, 'NOT REPLAYED']]);
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
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]), [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'],
    [paymentWall, 'NOT REPLAYED'], [practicePrivacy, 'NOT REPLAYED'], [repeatTip, 'NOT REPLAYED'], [saveJournalCleanup, 'NOT REPLAYED']]);
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

// #1863 payment wall (ledger 12) and #1835 practice privacy (ledger 13): each stages after its predecessor and is observed
// against the same release contract; the full-chain run retains the native catalog the pending T2 pins are taken from.
const paymentWallProfile = 'main-payment-wall-132';
const practicePrivacyProfile = 'main-practice-privacy-133';

test('payment-wall and practice-privacy T2 deltas name only existing ledger-11 objects the migrations alter', () => {
  const wall = readFileSync(new URL('20261114170000_payment_wall_product_access_1863.sql', directory), 'utf8');
  const privacy = readFileSync(new URL('20261117105700_practice_privacy_choices_1835.sql', directory), 'utf8');
  assert.deepEqual(Object.keys(PAYMENT_WALL_T2_CATALOG_DELTA).sort(),
    ['function:public.get_analytics_summary(uuid)', 'table:public.recording_start_abandonments']);
  assert.match(wall, /ALTER FUNCTION public\.get_analytics_summary\(p_user_id uuid\) RENAME TO get_analytics_summary__unguarded;/);
  assert.match(wall, /ALTER TABLE public\.recording_start_abandonments ADD CONSTRAINT recording_start_abandonments_outcome_check/);
  assert.deepEqual(Object.keys(PRACTICE_PRIVACY_T2_CATALOG_DELTA),
    ['function:public.persist_account_coaching_v1(uuid, boolean, uuid, uuid, jsonb, text, text, text, date, integer, integer)']);
  assert.match(privacy, /REVOKE EXECUTE ON FUNCTION public\.persist_account_coaching_v1\(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
});

test('the practice-privacy native proof restores the revoked legacy service_role grant as a rollback-only refusal control', () => {
  const driver = readFileSync(new URL('./account-closure-full-chain.mjs', import.meta.url), 'utf8');
  const observer = driver.slice(driver.indexOf('export function observePracticePrivacyReleaseCatalog'));
  assert.match(observer.slice(0, observer.indexOf('\n}\n')),
    /'GRANT EXECUTE ON FUNCTION public\.persist_account_coaching_v1\(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer\) TO service_role;'/);
  // Each control runs inside BEGIN ... ROLLBACK and must be refused before the restored catalog is re-verified.
  assert.ok(driver.includes('sql(`BEGIN; ${mutation}\\n${snapshot}\\nROLLBACK;`)'));
});

test('installed payment-wall profile replays the feedback fence then 20261114170000, withholding billing129, the refund and #1835', () => {
  assert.equal(parseMainProofArguments([`--profile=${paymentWallProfile}`]).profile, paymentWallProfile);
  const plan = buildMainU1ReplayPlan(rows, paymentWallProfile);
  assert.equal(plan.migrations, 132);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]), [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'],
    [practicePrivacy, 'NOT REPLAYED'], [repeatTip, 'NOT REPLAYED'], [saveJournalCleanup, 'NOT REPLAYED']]);
  assert.deepEqual(plan.stages.slice(-3).map(stage => stage.name), ['start-abandonment', 'feedback-fence', 'payment-wall']);
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, paymentWall]);
  assert.deepEqual(plan.stages.at(-2).versions, buildMainU1ReplayPlan(rows, feedbackFenceProfile).stages.at(-1).versions);
  assert.ok(plan.stages.every(stage => ![billing, refund, practicePrivacy, saveJournalCleanup].some(v => stage.versions.includes(v))));
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(paymentWall)));
  assert.equal(plan.executed, false);
});

test('installed practice-privacy profile replays the payment wall then 20261117105700, withholding billing129 and the refund', () => {
  assert.equal(parseMainProofArguments([`--profile=${practicePrivacyProfile}`]).profile, practicePrivacyProfile);
  const plan = buildMainU1ReplayPlan(rows, practicePrivacyProfile);
  assert.equal(plan.migrations, 133);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]), [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'],
    [repeatTip, 'NOT REPLAYED'], [saveJournalCleanup, 'NOT REPLAYED']]);
  assert.ok(plan.stages.every(stage => ![repeatTip, saveJournalCleanup].some(v => stage.versions.includes(v))));
  assert.deepEqual(plan.stages.slice(-3).map(stage => stage.name), ['feedback-fence', 'payment-wall', 'practice-privacy']);
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, practicePrivacy]);
  assert.deepEqual(plan.stages.at(-2).versions, buildMainU1ReplayPlan(rows, paymentWallProfile).stages.at(-1).versions);
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(practicePrivacy)));
  assert.equal(plan.executed, false);
});

test('payment-wall and practice-privacy profiles refuse changed installed or withheld bytes and unknown successors', () => {
  for (const [profile, versions] of [[paymentWallProfile, [paymentWall, feedbackFence, billing, refund, practicePrivacy, saveJournalCleanup]],
    [practicePrivacyProfile, [practicePrivacy, paymentWall, feedbackFence, billing, refund, saveJournalCleanup]]]) {
    for (const version of versions) {
      assert.throws(() => buildMainU1ReplayPlan(rows.map(row => row.version === version
        ? { ...row, sha256: '0'.repeat(64) } : row), profile), /digest changed/, `${profile} ${version}`);
    }
    assert.throws(() => buildMainU1ReplayPlan([...rows, {
      name: '20261118120000_unknown.sql', version: '20261118120000', sha256: '0'.repeat(64),
    }], profile), /unreviewed migration/);
  }
});

// #1827 outcome 4 D2 (ledger 14): stages after practice privacy; its objects are outside the T2 inventory (empty delta).
const repeatTipProfile = 'main-repeat-tip-134';

test('installed repeat-tip profile replays practice privacy then 20261119120000, withholding billing129 and the refund', () => {
  assert.equal(parseMainProofArguments([`--profile=${repeatTipProfile}`]).profile, repeatTipProfile);
  const plan = buildMainU1ReplayPlan(rows, repeatTipProfile);
  assert.equal(plan.migrations, 134);
  assert.deepEqual(plan.withheld.map(row => [row.version, row.status]), [[billing, 'NOT REPLAYED'], [refund, 'NOT REPLAYED'],
    [saveJournalCleanup, 'NOT REPLAYED']]);
  assert.ok(plan.stages.every(stage => !stage.versions.includes(saveJournalCleanup)));
  assert.deepEqual(plan.stages.slice(-3).map(stage => stage.name), ['payment-wall', 'practice-privacy', 'repeat-tip']);
  assert.deepEqual(plan.stages.at(-1).versions, [...plan.stages.at(-2).versions, repeatTip]);
  assert.deepEqual(plan.stages.at(-2).versions, buildMainU1ReplayPlan(rows, practicePrivacyProfile).stages.at(-1).versions);
  assert.ok(plan.stages.slice(0, -1).every(stage => !stage.versions.includes(repeatTip)));
  assert.equal(plan.executed, false);
});

test('repeat-tip profile refuses changed installed or withheld bytes and unknown successors', () => {
  for (const version of [repeatTip, practicePrivacy, paymentWall, billing, refund, saveJournalCleanup]) {
    assert.throws(() => buildMainU1ReplayPlan(rows.map(row => row.version === version
      ? { ...row, sha256: '0'.repeat(64) } : row), repeatTipProfile), /digest changed/, version);
  }
  assert.throws(() => buildMainU1ReplayPlan([...rows, {
    name: '20261120120000_unknown.sql', version: '20261120120000', sha256: '0'.repeat(64),
  }], repeatTipProfile), /unreviewed migration/);
});
