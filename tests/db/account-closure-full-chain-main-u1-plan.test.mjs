import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAIN_MIGRATION_SNAPSHOT, buildMainU1ReplayPlan, parseMainProofArguments,
  observeC1ReleaseCatalog } from './account-closure-full-chain.mjs';
import { T2_VERSIONS, t2ReleaseContract } from '../../scripts/lib/t2MigrationPostflight.mjs';
import { c1CatalogQuery } from '../../scripts/lib/c1MigrationPostflight.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(join(root, path), 'utf8');

// Protocol controls only. The workflow must separately produce actual native
// post127/128 receipts; these fakes never count as database evidence.
for (const stage of [127, 128]) test(`post${stage} observer requires real validator results and separate restored negative controls`, () => {
  const ledger = [...T2_VERSIONS, '20261024083000', ...(stage === 128 ? ['20261025021046'] : [])];
  const contract = t2ReleaseContract(root, ledger);
  const production = t2ReleaseContract(root, ledger, { catalogContext: 'retained-production' });
  const rows = [JSON.stringify(ledger), JSON.stringify(contract.expected),
    JSON.stringify({ billing_disabled: true, completion_disabled: true }), 'true',
    JSON.stringify({ checks: c1CatalogQuery(contract.c1).names.map(name => ({ name, ok: true })),
      activation: [{ policy_version: 'newest_one_v1', activated_at: null }] }), 'true'];
  const changed = { ...contract.expected,
    'function:public.persist_ai_suggestion_with_authority_v1(uuid, uuid, jsonb, text, text, text, date, integer, integer)': '0'.repeat(32) };
  const queries = [], receipts = [];
  const sql = query => {
    queries.push(query);
    if (query.includes('ROLLBACK') && (query.includes('REVOKE EXECUTE ON FUNCTION public.record_progress_evaluation')
      || query.includes('REVOKE EXECUTE ON FUNCTION public.sessions_set_transcript_state'))) {
      const catalog = { ...contract.expected };
      for (const [name, signature] of [['record_progress_evaluation', 'uuid'], ['sessions_set_transcript_state', '']]) {
        const key = `function:public.${name}(${signature})`;
        if (query.includes(`REVOKE EXECUTE ON FUNCTION public.${name}`)) catalog[key] = production.expected[key];
      }
      if (query.includes('TO anon;') || query.includes('WITH GRANT OPTION')) {
        catalog['function:public.record_progress_evaluation(uuid)'] = '0'.repeat(32);
      }
      const altered = [...rows]; altered[1] = JSON.stringify(catalog); return altered.join('\n');
    }
    if (query.includes('ROLLBACK') && query.includes('CREATE FUNCTION public.settle_account_completion_billing_v1')) {
      const partial = [...rows]; partial[5] = 'false'; return partial.join('\n');
    }
    if (query.includes('ROLLBACK')) return JSON.stringify(changed);
    if (!query.includes('objects AS')) return JSON.stringify(ledger);
    if (!query.includes('checks AS')) return JSON.stringify(contract.expected);
    return rows.join('\n');
  };
  const result = observeC1ReleaseCatalog({ sql, root, stage, retain: value => receipts.push(value) });
  assert.equal(result.result.passed, true);
  assert.equal(result.restored, true);
  assert.equal(result.legacy126Rejected, true);
  assert.deepEqual(result.negatives.map(row => row.name), ['restored-service-execute', 'changed-delete-guard-body']);
  assert.equal(receipts.at(-1).status, 'PASS');
  assert.equal(receipts[0].status, 'INCOMPLETE');
  assert.equal(queries.filter(query => query.includes('ROLLBACK')).length, stage === 128 ? 9 : 4);
  assert.equal(queries.filter(query => query.includes('checks AS')).length, stage === 128 ? 9 : 4);
  assert.deepEqual(result.inheritedAclContexts.map(row => [row.name, row.accepted]), stage === 128 ? [
    ['retained-production-pair', true], ['mixed-progress-only', false], ['mixed-state-only', false],
    ['retained-extra-role', false], ['retained-grantable', false],
  ] : []);
  assert.deepEqual(result.absenceNegatives.map(row => row.name), ['actual129-without-ledger', 'known129-family-overload']);
  const broken = [...rows]; broken[3] = 'false';
  const failed = [];
  assert.throws(() => observeC1ReleaseCatalog({ root, stage, retain: value => failed.push(value),
    sql: query => query.includes('objects AS') ? broken.join('\n') : JSON.stringify(ledger) }), /admission prerequisite/);
  assert.equal(failed.at(-1).status, 'FAIL');
  assert.deepEqual(failed.at(-1).rows, broken);
  assert.ok(failed.every(value => value.status !== 'PASS'));
});

test('post-C1 native readbacks precede billing129 and do not relabel the historical seven-state observer', () => {
  const driver = read('tests/db/account-closure-full-chain.mjs');
  const historicalFinish = driver.indexOf('nativeT2Catalog.finish()');
  const fence = driver.indexOf('stage: 127,');
  const retention = driver.indexOf('stage: 128,');
  const billing = driver.indexOf('const billing=MAIN_COMPLETION_BILLING_MIGRATION;');
  assert.ok(historicalFinish < fence && fence < retention && retention < billing);
  assert.ok(driver.includes("'t2-release-post127.json'"));
  assert.ok(driver.includes("'t2-release-post128.json'"));
});

test('edited-take behavior uses the real post128 chain and cannot PASS before owned teardown', () => {
  const driver = read('tests/db/account-closure-full-chain.mjs');
  const hook = driver.indexOf('runRequiredEditedTakeProof({');
  assert.ok(hook > driver.indexOf('stage: 128,'));
  assert.ok(hook < driver.indexOf('const billing=MAIN_COMPLETION_BILLING_MIGRATION;'));
  const finalize = driver.lastIndexOf('const observed = finalizeEditedTakeProof(');
  assert.ok(finalize > driver.lastIndexOf('cleanupOwned({ id, stage, networkName, subnet })'));
  assert.ok(driver.includes("assert.equal(existsSync(editedTakeReceipt), false, 'stale edited-take receipt refused')"));
  assert.ok(driver.includes('parentPassed: !primaryError && !cleanupError'));
  assert.ok(driver.includes("assert.equal(observed.status, 'PASS'"));
  assert.ok(driver.includes('editedTakeReached = true;'));
  assert.ok(driver.includes('if (editedTakeReached) {'));
  assert.ok(!driver.includes('if (retentionT2 && existsSync(editedTakeReceipt))'));
});
// Independent pins reviewed from99585/e772, not values read back from the planner.
const U1 = Object.freeze({ name: '20261019010000_heartbeat_session_cap_keeps_take_open_1593.sql',
  version: '20261019010000', sha256: 'df02b867f5a4f29ee207a8b4359a82bb3b27abefd9eabe2eb5cd9960b4f0fb45' });
const ANALYTICS=Object.freeze({name:'20261018090000_analytics_summary_observed_filler_rate_1472.sql',
  version:'20261018090000',sha256:'72299dacc4bf2986b7d7e37299608de64fada0e4e70ba22aba4cee6d058d519f'});
const ACCOUNT = [
  {name:'20261018170000_account_closure_pending_checkout.sql',version:'20261018170000',sha256:'68eab9724083189f28eb7c048f259a80cedb9b3280801ee5f7b762c972f8dd19'},
  {name:'20261019055102_account_pending_recording_admission_1643.sql',version:'20261019055102',sha256:'e1f0534de3ca9b8ce9af291903064a6cf7c9c220db3354ab851a21eb31bd8ac4'},
  {name:'20261019202856_account_coaching_admission_1643.sql',version:'20261019202856',sha256:'f4acb882ce9a5d259b02b349461667c0d6c7a1b6b2d6548f59599e44e53b812e'},
  {name:'20261020230653_account_pending_completion_journal_1643.sql',version:'20261020230653',sha256:'76bffe1f7dc15efe487cd33faffbfd8d1b6c654a7b09508d427e53b4b88d83cf'},
];
// #1643 fence: pinned here independently of the planner's own constant.
const FENCE=Object.freeze({name:'20261024083000_account_coaching_unknown_fence_1643.sql',version:'20261024083000',
  sha256:'29548e27a0b33a303ff093569097367b1227251faff7e7df77af392cfa4b0d14'});
// Accepted retention SQL is pinned independently; extending the proof never changes its bytes.
const RETENTION=Object.freeze({name:'20261025021046_content_free_retention_evidence.sql',version:'20261025021046',
  sha256:'37af792f8abeeb0e073e229ec25cd294a20050058632f793c4635ba3af37f47d'});
// Corrected final SQL independently passed Sam's source review before this pin was added.
const BILLING=Object.freeze({name:'20261027192550_account_completion_billing_settlement.sql',version:'20261027192550',
  sha256:'398aa50b8db168acc0cee68a11a433b40bd3101af03e3051dcdc2c87b2bef45d'});
const baseTuplesSha256 = '601403209858cc31dba0f9125b1feebd535827d7e4bed469e2458e6ff7cda2b0';
const drain = '20261016180000_account_closure_drain_enforcement.sql';
const recovery = '20261017200000_checkout_rejection_recovery.sql';
const physical = readdirSync(join(root, 'backend/supabase/migrations')).filter(name => name.endsWith('.sql')).sort().map(name => ({
  name, version: name.match(/^(\d{8}|\d{14})_.+\.sql$/)?.[1] ?? null,
  sha256: hash(readFileSync(join(root, 'backend/supabase/migrations', name))),
}));
const main = physical.filter(row => ![U1.name, ANALYTICS.name, ...ACCOUNT.map(row=>row.name), FENCE.name, RETENTION.name, BILLING.name].includes(row.name));
const receiving = [...main, U1].sort((a, b) => a.name.localeCompare(b.name, 'en'));
const analyticsReceiving=[...receiving,ANALYTICS].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const fullReceiving=[...analyticsReceiving,...ACCOUNT].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const fenceReceiving=[...fullReceiving,FENCE].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const retentionReceiving=[...fenceReceiving,RETENTION].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const billingReceiving=[...retentionReceiving,BILLING].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const versionsWithout = names => receiving.filter(row => row.version !== null && !names.includes(row.name)).map(row => row.version);

test('frozen independent main identity and exact physical source count', () => {
  assert.equal(main.length, 122);
  assert.equal(main.filter(row => row.version !== null).length, 120);
  assert.equal(receiving.length, 123);
  assert.equal(receiving.filter(row => row.version !== null).length, 121);
  const tuples = rows => rows.map(row => [row.name, row.version, row.sha256]);
  assert.equal(hash(JSON.stringify(tuples(main))), baseTuplesSha256);
  assert.equal(hash(JSON.stringify(tuples(MAIN_MIGRATION_SNAPSHOT))), baseTuplesSha256);
  assert.deepEqual(MAIN_MIGRATION_SNAPSHOT, main);
  // On the combined receiving branch the real U1 bytes must match, not merely the virtual planning row.
  const actualU1 = physical.find(row => row.name === U1.name);
  if (actualU1) assert.deepEqual(actualU1, U1);
});

test('main120 is the default and retains all three original ordered stages', () => {
  const plan = buildMainU1ReplayPlan(main);
  assert.equal(plan.profile, 'main-120');
  assert.equal(plan.migrations, 120);
  assert.equal(plan.executed, false);
  assert.deepEqual(plan.stages.map(row => [row.name, row.versions.length]), [
    ['baseline-before-drain', 118], ['drain-enforcement', 119], ['checkout-rejection-recovery', 120],
  ]);
  assert.deepEqual(plan.stages[0].versions, versionsWithout([drain, recovery, U1.name]));
  assert.deepEqual(plan.stages[1].versions, versionsWithout([recovery, U1.name]));
  assert.deepEqual(plan.stages[2].versions, versionsWithout([U1.name]));
});

test('explicit main-u1 keeps original118/119/120 byte identities and adds only U1 last121', () => {
  const base = buildMainU1ReplayPlan(main);
  const plan = buildMainU1ReplayPlan(receiving, 'main-u1-121');
  assert.equal(plan.migrations, 121);
  assert.equal(plan.executed, false);
  assert.deepEqual(plan.stages.slice(0, 3), base.stages);
  assert.deepEqual(plan.stages[3], { name: 'heartbeat-u1', versions: versionsWithout([]) });
  assert.equal(plan.stages[3].versions.at(-1), U1.version);
  assert.equal(plan.unversioned.length, 2);
});

test('default rejects extra U1; explicit U1 refuses a missing dependency', () => {
  assert.throws(() => buildMainU1ReplayPlan(receiving), /unreviewed migration/);
  assert.throws(() => buildMainU1ReplayPlan(main, 'main-u1-121'), /reviewed migration missing/);
});

test('Analytics explicit122 orders original118/119/120 then Analytics121 then U1122',()=>{
  const plan=buildMainU1ReplayPlan(analyticsReceiving,'main-analytics-u1-122');
  assert.equal(plan.migrations,122);
  assert.deepEqual(plan.stages.slice(0,3),buildMainU1ReplayPlan(main).stages);
  assert.deepEqual(plan.stages.slice(3).map(s=>[s.name,s.versions.length]),[
    ['analytics-observed-rate',121],['heartbeat-u1',122],
  ]);
  assert.equal(plan.stages[3].versions.at(-1),ANALYTICS.version);
  assert.equal(plan.stages[4].versions.at(-1),U1.version);
  assert.deepEqual(plan.stages.at(-1).versions,analyticsReceiving.filter(r=>r.version!==null).map(r=>r.version));
});
test('Analytics bytes are independently pinned and legacy120/U1121 profiles refuse them',()=>{
  assert.equal(parseMainProofArguments(['--profile=main-analytics-u1-122']).profile,'main-analytics-u1-122');
  assert.equal(hash(readFileSync(join(root,'backend/supabase/migrations',ANALYTICS.name))),ANALYTICS.sha256);
  assert.throws(()=>buildMainU1ReplayPlan(analyticsReceiving),/unreviewed migration/);
  assert.throws(()=>buildMainU1ReplayPlan(analyticsReceiving,'main-u1-121'),/unreviewed migration/);
  assert.throws(()=>buildMainU1ReplayPlan(receiving,'main-analytics-u1-122'),/reviewed migration missing/);
});
test('Analytics runtime staging and same SQL oracle run before AND after U1',()=>{
  const driver=read('tests/db/account-closure-full-chain.mjs');
  const analytics=driver.indexOf('if(hasAnalytics) {');
  const u1=driver.indexOf("if (args.profile !== 'main-120')");
  assert.ok(analytics>driver.indexOf("console.log('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED')"));
  assert.ok(u1>analytics);
  assert.ok(driver.slice(analytics,u1).includes('verifyAnalytics()'));
  assert.ok(driver.slice(u1).includes('if(hasAnalytics) verifyAnalytics()'));
});
test('complete126 pins actual source and orders pending before U1, completion last',()=>{
  assert.deepEqual(physical.filter(r=>![FENCE.name,RETENTION.name,BILLING.name].includes(r.name)),fullReceiving);
  const plan=buildMainU1ReplayPlan(fullReceiving,'main-t2-account-126');
  assert.equal(plan.migrations,126);
  assert.equal(plan.executed,false);
  assert.deepEqual(plan.stages.slice(0,3),buildMainU1ReplayPlan(main).stages);
  assert.deepEqual(plan.stages.slice(3).map(s=>[s.name,s.versions.length,s.versions.at(-1)]),[
    ['analytics-observed-rate',121,ANALYTICS.version],
    ['account-pending',122,ACCOUNT[0].version],
    ['heartbeat-u1',123,U1.version],
    ['recording-admission',124,ACCOUNT[1].version],
    ['coaching-admission',125,ACCOUNT[2].version],
    ['account-completion',126,ACCOUNT[3].version],
  ]);
  for(let i=1;i<plan.stages.length;i++) {
    const before=plan.stages[i-1].versions, after=plan.stages[i].versions;
    assert.deepEqual(after.slice(0,-1),before,'each checkpoint adds exactly its next chronological migration');
  }
  assert.equal(parseMainProofArguments(['--profile=main-t2-account-126']).profile,'main-t2-account-126');
  for(const profile of ['main-120','main-u1-121','main-analytics-u1-122'])
    assert.throws(()=>buildMainU1ReplayPlan(fullReceiving,profile),/unreviewed migration/);
});
for(const member of fullReceiving) {
  test('complete126 refuses missing reviewed member: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(fullReceiving.filter(r=>r.name!==member.name),'main-t2-account-126'),/reviewed migration missing/);
  });
  test('complete126 refuses changed reviewed digest: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(fullReceiving.map(r=>r.name===member.name?{...r,sha256:'0'.repeat(64)}:r),'main-t2-account-126'),/reviewed migration digest changed/);
  });
}
test('fence127 pins actual source and adds only the fence after completion',()=>{
  assert.deepEqual(physical.filter(r=>![RETENTION.name,BILLING.name].includes(r.name)),fenceReceiving);
  assert.equal(hash(readFileSync(join(root,'backend/supabase/migrations',FENCE.name))),FENCE.sha256);
  const complete=buildMainU1ReplayPlan(fullReceiving,'main-t2-account-126');
  const plan=buildMainU1ReplayPlan(fenceReceiving,'main-t2-fence-127');
  assert.equal(plan.migrations,127);
  assert.equal(plan.executed,false);
  assert.deepEqual(plan.stages.slice(0,-1),complete.stages,'every 126 checkpoint is unchanged');
  assert.deepEqual(plan.stages.at(-1),{name:'coaching-unknown-fence',versions:[...complete.stages.at(-1).versions,FENCE.version]});
  assert.equal(parseMainProofArguments(['--profile=main-t2-fence-127']).profile,'main-t2-fence-127');
  for(const profile of ['main-120','main-u1-121','main-analytics-u1-122','main-t2-account-126'])
    assert.throws(()=>buildMainU1ReplayPlan(fenceReceiving,profile),/unreviewed migration/);
  assert.throws(()=>buildMainU1ReplayPlan(fullReceiving,'main-t2-fence-127'),/reviewed migration missing/);
  assert.throws(()=>buildMainU1ReplayPlan([...fenceReceiving,{name:'20261025000000_unreviewed.sql',version:'20261025000000',sha256:'a'.repeat(64)}],
    'main-t2-fence-127'),/unreviewed migration/);
});
test('retention128 remains the exact predecessor after every unchanged fence127 checkpoint',()=>{
  assert.deepEqual(physical.filter(r=>r.name!==BILLING.name),retentionReceiving);
  assert.equal(hash(readFileSync(join(root,'backend/supabase/migrations',RETENTION.name))),RETENTION.sha256);
  const fence=buildMainU1ReplayPlan(fenceReceiving,'main-t2-fence-127');
  const plan=buildMainU1ReplayPlan(retentionReceiving,'main-t2-retention-128');
  assert.equal(plan.migrations,128);
  assert.equal(plan.executed,false);
  assert.deepEqual(plan.stages.slice(0,-1),fence.stages);
  assert.deepEqual(plan.stages.at(-1),{name:'content-free-retention',versions:[...fence.stages.at(-1).versions,RETENTION.version]});
  assert.deepEqual(parseMainProofArguments(['--plan','--profile=main-t2-retention-128']),
    {profile:'main-t2-retention-128',plan:true,cleanup:false});
  for(const profile of ['main-120','main-u1-121','main-analytics-u1-122','main-t2-account-126','main-t2-fence-127'])
    assert.throws(()=>buildMainU1ReplayPlan(retentionReceiving,profile),/unreviewed migration/);
});
test('retention128 refuses missing, changed, aliased and extra migration bytes',()=>{
  for(const member of retentionReceiving) {
    assert.throws(()=>buildMainU1ReplayPlan(retentionReceiving.filter(r=>r.name!==member.name),'main-t2-retention-128'),/reviewed migration missing/);
    assert.throws(()=>buildMainU1ReplayPlan(retentionReceiving.map(r=>r.name===member.name?{...r,sha256:'0'.repeat(64)}:r),
      'main-t2-retention-128'),/reviewed migration digest changed/);
  }
  assert.throws(()=>buildMainU1ReplayPlan([...retentionReceiving,RETENTION],'main-t2-retention-128'),/duplicate migration name/);
  assert.throws(()=>buildMainU1ReplayPlan([...retentionReceiving,{...RETENTION,name:RETENTION.version+'_alias.sql'}],
    'main-t2-retention-128'),/duplicate migration version/);
  assert.throws(()=>buildMainU1ReplayPlan([...retentionReceiving,{name:'20261026000000_extra.sql',version:'20261026000000',sha256:'a'.repeat(64)}],
    'main-t2-retention-128'),/unreviewed migration/);
});
test('retention128 is staged after the fence with catalog and non-activation evidence',()=>{
  const driver=read('tests/db/account-closure-full-chain.mjs');
  const fence=driver.indexOf('if(fenceT2) {');
  const retention=driver.indexOf('if(retentionT2) {');
  assert.ok(retention>fence&&fence>driver.indexOf('nativeT2Catalog.finish();'));
  const tail=driver.slice(retention,driver.indexOf('} catch (error)',retention));
  for(const token of ['MAIN_T2_RETENTION_MIGRATION',"cli(['migration','up','--local'])",'retention history is incomplete',
    'retention_content_free_compatible()', 'retention-catalog.json', 'retention catalog/ACL',
    'completion must remain disabled after retention', 'CONTENT-FREE RETENTION FULL-CHAIN CATALOG PASSED'])
    assert.ok(tail.includes(token),token);
  assert.ok(driver.includes('MAIN_T2_FENCE_MIGRATION.name,MAIN_T2_RETENTION_MIGRATION.name,MAIN_COMPLETION_BILLING_MIGRATION.name].includes(name)'));
});
test('fence127 runtime applies the fence only after the completion proof and native catalog finish',()=>{
  const driver=read('tests/db/account-closure-full-chain.mjs');
  const finish=driver.indexOf('nativeT2Catalog.finish();');
  const fence=driver.indexOf('if(fenceT2) {');
  assert.ok(finish>0&&fence>finish,'fence stage must follow the completed 126 proof');
  for(const proof of ["'fence catalog/ACL'","account-coaching-admission-invariants.sql","'completion proof after the fence'",
    "'the migration fences nothing'","ACCOUNT COACHING UNKNOWN FENCE FULL-CHAIN INVARIANTS PASSED"])
    assert.ok(driver.slice(fence).includes(proof),'fence stage proof missing: '+proof);
});
for(const member of fenceReceiving) {
  test('fence127 refuses missing reviewed member: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(fenceReceiving.filter(r=>r.name!==member.name),'main-t2-fence-127'),/reviewed migration missing/);
  });
  test('fence127 refuses changed reviewed digest: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(fenceReceiving.map(r=>r.name===member.name?{...r,sha256:'0'.repeat(64)}:r),'main-t2-fence-127'),/reviewed migration digest changed/);
  });
}
test('complete126 refuses aliases, duplicate rows and unrelated additions',()=>{
  const profile='main-t2-account-126';
  assert.throws(()=>buildMainU1ReplayPlan([...fullReceiving,ACCOUNT[0]],profile),/duplicate migration name/);
  assert.throws(()=>buildMainU1ReplayPlan([...fullReceiving,{...ACCOUNT[0],name:ACCOUNT[0].version+'_alias.sql'}],profile),/duplicate migration version/);
  assert.throws(()=>buildMainU1ReplayPlan([...fullReceiving,{name:'20261022000000_unreviewed.sql',version:'20261022000000',sha256:'a'.repeat(64)}],profile),/unreviewed migration/);
});
for(const member of analyticsReceiving) {
  test('Analytics122 refuses missing reviewed member: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(analyticsReceiving.filter(r=>r.name!==member.name),'main-analytics-u1-122'),/reviewed migration missing/);
  });
  test('Analytics122 refuses changed reviewed digest: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(analyticsReceiving.map(r=>r.name===member.name?{...r,sha256:'0'.repeat(64)}:r),'main-analytics-u1-122'),/reviewed migration digest changed/);
  });
}

for (const member of receiving) {
  test('explicit U1 refuses missing reviewed member: ' + member.name, () => {
    assert.throws(() => buildMainU1ReplayPlan(receiving.filter(row => row.name !== member.name), 'main-u1-121'), /reviewed migration missing/);
  });
  test('explicit U1 refuses changed bytes: ' + member.name, () => {
    const changed = receiving.map(row => row.name === member.name ? { ...row, sha256: '0'.repeat(64) } : row);
    assert.throws(() => buildMainU1ReplayPlan(changed, 'main-u1-121'), /reviewed migration digest changed/);
  });
}

test('duplicate names and same-version aliases cannot enter the plan', () => {
  assert.throws(() => buildMainU1ReplayPlan([...receiving, U1], 'main-u1-121'), /duplicate migration name/);
  assert.throws(() => buildMainU1ReplayPlan([...receiving, { ...U1, name: U1.version + '_alias.sql' }], 'main-u1-121'), /duplicate migration version/);
});

test('a different late migration is not approved by count, filename order or valid digest shape', () => {
  assert.throws(() => buildMainU1ReplayPlan([...receiving, {
    name: '20261022000000_unreviewed.sql', version: '20261022000000', sha256: 'a'.repeat(64),
  }], 'main-u1-121'), /unreviewed migration/);
});

test('malformed rows and mismatched versions fail closed', () => {
  assert.throws(() => buildMainU1ReplayPlan(null), /manifest must be an array/);
  assert.throws(() => buildMainU1ReplayPlan([null]), /row must be an object/);
  assert.throws(() => buildMainU1ReplayPlan([{ ...main[0], sha256: '' }]), /migration digest missing/);
  assert.throws(() => buildMainU1ReplayPlan([{ ...main[0], version: '20260101000000' }]), /version does not match/);
});

test('profile parsing is explicit and refuses unknown or repeated selectors', () => {
  assert.deepEqual(parseMainProofArguments([]), { profile: 'main-120', plan: false, cleanup: false });
  assert.deepEqual(parseMainProofArguments(['--plan', '--profile=main-u1-121']), { profile: 'main-u1-121', plan: true, cleanup: false });
  assert.deepEqual(parseMainProofArguments(['--cleanup', '--profile=main-u1-121']), { profile: 'main-u1-121', plan: false, cleanup: true });
  assert.throws(() => parseMainProofArguments(['--profile=main-120', '--profile=main-u1-121']), /exactly one/);
  assert.throws(() => parseMainProofArguments(['--profile=main-120', '--profile=main-120']), /exactly one/);
  for (const profile of ['', 'completion-n3-u1', 'main-u1', 'unknown']) {
    assert.throws(() => parseMainProofArguments(['--profile=' + profile]), /unknown reviewed/);
    assert.throws(() => buildMainU1ReplayPlan(receiving, profile), /unknown reviewed/);
  }
  assert.throws(() => parseMainProofArguments(['--skip-invariants']), /unknown proof argument/);
});

const unchangedProofs = [
  {
    "path": "tests/db/account-closure-full-chain.sql",
    "sha256": "26b7fcfa8391224903e23b339e0ae06f1b32c6ed2573e9332d79b12d96cf0368",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-enforcement-full-chain.sql",
    "sha256": "ab579be545147a2c494dbc8686c7931f188c73793c4e3ef7f1e9bd03f10069fe",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-denial-control.sql",
    "sha256": "dccbf47df8ee43ca64add790a731d444d6a9fa5985cf28d9d4560304607e2ee5",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/checkout-rejection-recovery.sql",
    "sha256": "d1d32577cf750d84d1a1670653c7fdde0b4e954f92a0aeb7e3a2cf5326a905f7",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-concurrency-realpg.mjs",
    "sha256": "517dd04048e52ceeb0042ec8263ce91465878293d89270d9c3d508856444ed7a",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-attestation-realpg.mjs",
    "sha256": "c0297c1fd5deadce70d23336d15cfe5d5cb64103040360bd1772cba4cdaac4e3",
    "action": "UNCHANGED"
  },
  {
    "path": "tests/db/account-closure-full-chain-diagnostics.mjs",
    "sha256": "323a5b274605b8125cf861e64a87742bd034132f8c334bb80f600ae90a76e287",
    "action": "UNCHANGED"
  }
];
for (const { path, sha256 } of unchangedProofs) test('original proof/helper unchanged: ' + path, () => {
  assert.equal(hash(readFileSync(join(root, path))), sha256);
});

test('U1 is excluded from initial staging and all four final proof layers remain explicit', () => {
  const driver = read('tests/db/account-closure-full-chain.mjs');
  const replay = driver.indexOf("if (args.profile !== 'main-120')");
  assert.ok(driver.includes('![candidate,recovery,MAIN_U1_MIGRATION.name,MAIN_ANALYTICS_MIGRATION.name,...MAIN_T2_ACCOUNT_MIGRATIONS.map(row=>row.name),MAIN_T2_FENCE_MIGRATION.name,MAIN_T2_RETENTION_MIGRATION.name,MAIN_COMPLETION_BILLING_MIGRATION.name].includes(name)'));
  const final = driver.slice(replay, driver.indexOf('} catch (error)', replay));
  assert.ok(replay > driver.indexOf("console.log('CHECKOUT REJECTION RECOVERY INVARIANTS PASSED')"));
  for (const token of [
    "assertCheckoutRejection(sql(checkoutRejectionQuery('after'",
    "verifyEnforcement('after')",
    "readFileSync('tests/db/account-closure-enforcement-full-chain.sql'",
    "readFileSync('tests/db/checkout-rejection-recovery.sql'",
    'ACCOUNT CLOSURE ENFORCEMENT FULL-CHAIN INVARIANTS PASSED',
    'CHECKOUT REJECTION RECOVERY INVARIANTS PASSED',
    'U1 owned fixture Auth residue', 'U1 owned fixture journal residue',
    'U1 proof must restore disabled rollout gate', 'U1 rejection fixture residue',
  ]) assert.ok(final.includes(token), token);
  assert.ok(driver.lastIndexOf('captureOwnedDatabaseDiagnostics(') < driver.lastIndexOf('cleanupOwned({ id, stage, networkName, subnet })'));
  assert.ok(driver.includes("status: primaryError || cleanupError ? 'FAIL' : 'PASS'"));
  assert.ok(driver.includes('if (primaryError || cleanupError) throw primaryError ?? cleanupError'));
});

test('existing workflow collects Node tests and explicitly selects billing129 on replay AND cleanup', () => {
  const workflow = read('.github/workflows/account-closure-full-chain-proof.yml');
  const collection = workflow.indexOf('run: node --test tests/db/account-closure-full-chain-main-u1-plan.test.mjs');
  assert.ok(collection > workflow.indexOf('actions/setup-node@v6'));
  assert.ok(collection < workflow.indexOf('supabase/setup-cli@v2'));
  assert.ok(workflow.includes('run: node tests/db/account-closure-full-chain.mjs --profile=main-completion-billing-129'));
  assert.ok(workflow.includes('run: node tests/db/account-closure-full-chain.mjs --cleanup --profile=main-completion-billing-129'));
  assert.ok(!workflow.includes('--profile=main-t2-retention-128'),'the billing file makes retention128 refuse the real tree');
  assert.ok(workflow.includes("- 'tests/db/account-completion-billing-full-chain-invariants.sql'"));
  assert.ok(!workflow.includes('--profile=main-t2-fence-127'), 'the retention file makes fence127 refuse the real tree');
  assert.ok(!workflow.includes('--profile=main-t2-account-126'), 'the fence file makes complete126 refuse the real tree');
  assert.ok(workflow.includes('node tests/db/account-closure-concurrency-realpg.mjs'));
  assert.ok(workflow.includes('node tests/db/account-closure-attestation-realpg.mjs'));
  // #1643 fence: native proof runs on the exact head, a test-only change triggers it, and failures keep its receipts.
  assert.ok(workflow.indexOf('node tests/db/account-coaching-fence.realpg.mjs') > workflow.indexOf('[ "$actual_head" = "$PROOF_HEAD_SHA" ]'));
  for (const file of ['tests/db/account-coaching-fence.realpg.mjs', 'tests/db/account-coaching-fence.integration.test.ts',
    'tests/db/account-completion-fixture.mjs', 'tests/db/account-closure-pending-fixture.mjs',
    'backend/supabase/functions/get-ai-suggestions/contract.json'])
    assert.ok(workflow.includes("- '" + file + "'"), 'missing fence proof trigger: ' + file);
  assert.ok(workflow.includes('artifacts/account-coaching-fence/*.json'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('retention-days: 1'));
});
const accountProofs=[
  ['account-closure-pending-invariants.sql','e5224ecfb1009f244becac340486fe5ffeb545c21d2478df9f4c9f5f4040435f'],
  ['account-recording-admission-invariants.sql','5f919425355e10b6c06470ff78538e6929b5fc733f34ee72eae7b53fde2cda14'],
  ['account-coaching-admission-invariants.sql','b12464b760b6f6206f6f4449bc8cb5b0991ee59ee6771c6ca09b16c1d84f88e9'],
  // Hosted126 run39653894287 rejected the old synthetic-control next action.
  // Preserve that casualty as a negative control; use a valid structured action
  // for the positive save. Migration bytes and all other oracle pins are unchanged.
  // Native126 run39667772634 reached the real Storage direct-delete guard.
  // Preserve its denial; exact synthetic cleanup temporarily uses Storage's local opt-in.
  ['account-completion-full-chain-invariants.sql','29f01cf2178fdf8ceafd512bbb5622ebcaa37b75ded65ae740373c76701c29b9'],
];
for(const [file,sha] of accountProofs) test('pins exact reviewed account oracle or bounded fixture successor: '+file,()=>{
  assert.equal(hash(readFileSync(join(root,'tests/db',file))),sha);
  assert.ok(read('.github/workflows/account-closure-full-chain-proof.yml').includes("'tests/db/"+file+"'"));
});
test('complete126 reuses existing substantive account proofs and verifies disabled rollout/residue',()=>{
  const driver=read('tests/db/account-closure-full-chain.mjs');
  const pending=driver.indexOf("applyAccountStage(MAIN_T2_ACCOUNT_MIGRATIONS[0]");
  const u1=driver.indexOf("if (args.profile !== 'main-120')");
  const recording=driver.indexOf("applyAccountStage(MAIN_T2_ACCOUNT_MIGRATIONS[1]");
  const coaching=driver.indexOf("applyAccountStage(MAIN_T2_ACCOUNT_MIGRATIONS[2]");
  const completion=driver.indexOf('const completion=MAIN_T2_ACCOUNT_MIGRATIONS[3]');
  assert.ok(pending<u1 && u1<recording && recording<coaching && coaching<completion);
  for(const [file] of accountProofs) assert.ok(driver.includes("'tests/db/"+file+"'"));
  assert.ok(driver.includes("'-v', 'ON_ERROR_STOP=1'"));
  for(const token of ['completion leaked into an earlier account checkpoint',
    'completion proof must restore disabled configuration','synthetic coverage escaped rollback',
    'completion fixture Auth residue','completion fixture storage residue','completion fixture table escaped rollback'])
    assert.ok(driver.includes(token),token);
});

test('real Storage guard readback is retained with image and SQL identity before completion execution',()=>{
  const driver=read('tests/db/account-closure-full-chain.mjs');
  const receipt=driver.indexOf("writeFileSync(join(evidence,'storage-delete-guard.json')");
  const execution=driver.indexOf('const completionProof=sql(');
  assert.ok(receipt>driver.indexOf("'functionDefinition',pg_get_functiondef(p.oid)"));
  assert.ok(receipt<execution);
  const binding=driver.slice(receipt,execution);
  for(const token of ["'database-image.json'",'completionSqlSha256','trigger.enabled',"trigger.type===10"])
    assert.ok(binding.includes(token),token);
});

test('billing129 independently pins corrected SQL and appends exactly one stage after unchanged128',()=>{
  assert.deepEqual(physical,billingReceiving);
  assert.equal(hash(readFileSync(join(root,'backend/supabase/migrations',BILLING.name))),BILLING.sha256);
  const before=buildMainU1ReplayPlan(retentionReceiving,'main-t2-retention-128');
  const plan=buildMainU1ReplayPlan(physical,'main-completion-billing-129');
  assert.equal(plan.migrations,129); assert.equal(plan.executed,false);
  assert.deepEqual(plan.stages.slice(0,-1),before.stages);
  assert.deepEqual(plan.stages.at(-1),{name:'completion-billing',versions:[...before.stages.at(-1).versions,BILLING.version]});
  assert.deepEqual(parseMainProofArguments(['--plan','--profile=main-completion-billing-129']),
    {profile:'main-completion-billing-129',plan:true,cleanup:false});
  for(const profile of ['main-120','main-u1-121','main-analytics-u1-122','main-t2-account-126','main-t2-fence-127','main-t2-retention-128'])
    assert.throws(()=>buildMainU1ReplayPlan(physical,profile),/unreviewed migration/);
});
for(const member of billingReceiving) {
  test('billing129 refuses missing reviewed member: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(billingReceiving.filter(row=>row.name!==member.name),'main-completion-billing-129'),/reviewed migration missing/);
  });
  test('billing129 refuses changed reviewed bytes: '+member.name,()=>{
    assert.throws(()=>buildMainU1ReplayPlan(billingReceiving.map(row=>row.name===member.name?{...row,sha256:'0'.repeat(64)}:row),
      'main-completion-billing-129'),/reviewed migration digest changed/);
  });
}
test('billing129 refuses aliases, duplicates, and unknown extensions rather than accepting by count',()=>{
  const profile='main-completion-billing-129';
  assert.throws(()=>buildMainU1ReplayPlan([...billingReceiving,BILLING],profile),/duplicate migration name/);
  assert.throws(()=>buildMainU1ReplayPlan([...billingReceiving,{...BILLING,name:BILLING.version+'_alias.sql'}],profile),/duplicate migration version/);
  assert.throws(()=>buildMainU1ReplayPlan([...billingReceiving,{name:'20261028000000_unknown.sql',version:'20261028000000',sha256:'a'.repeat(64)}],profile),/unreviewed migration/);
});
test('billing129 runtime applies last and executes the real oracle with ACL, rollback and nonactivation evidence',()=>{
  const driver=read('tests/db/account-closure-full-chain.mjs');
  const billing=driver.indexOf('if(billingT2) {');
  assert.ok(billing>driver.indexOf("console.log('CONTENT-FREE RETENTION FULL-CHAIN CATALOG PASSED')"));
  const tail=driver.slice(billing,driver.indexOf('} catch (error)',billing));
  for(const token of ['MAIN_COMPLETION_BILLING_MIGRATION',"cli(['migration','up','--local'])",'billing history is incomplete',
    "readFileSync('tests/db/account-completion-billing-full-chain-invariants.sql'",'settlement must preserve existing table and base-RPC ACLs',
    'settlement proof must restore disabled unbound configuration','completion-billing-catalog.json']) assert.ok(tail.includes(token),token);
});
