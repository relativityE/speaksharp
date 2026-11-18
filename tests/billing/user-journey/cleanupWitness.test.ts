// @vitest-environment node
// Runs 44302168905 / 44316016932: Auth refused to delete the run's account. The witness reads only bounded counts from the exact
// recorded disposable database, for the exact run-bound owner. Docker is a fake whose `psql` executes the witness's own single
// statement on PGlite loaded with the real migrated schema (tests/db bootstrap + the 11-12 abandonment migration), so the counts
// come from the real guard, obligation, lease and session rules.
import { strict as assert } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, test } from 'vitest';
import { bootstrapSql, candidate, seed } from '../../db/content-free-retention-evidence.realpg.mjs';
import { REQUIRED_STEPS } from './journeySteps.mjs';
import { RECEIPT_KEYS } from './localStackReceipt.mjs';
import { StackProofError, WITNESS_RECEIPT_KEYS, ownerBindingRecord, witnessCleanupRefusal, type DockerAnswer, type StackIdentity } from './localStackResources.mjs';

const PROJECT = 'billing-local-stack-123456-1';
const OTHER_PROJECT = 'billing-local-stack-123456-2';
const SYSID = '7300000000000000001';
const LABEL = 'com.supabase.cli.project';
const RELEASE = 'a'.repeat(40);
const MARKER = `rwt-journey-billing-${randomUUID()}`;
const identity: StackIdentity = { schema: 'billing-local-stack-identity/v1', project: PROJECT,
  database: { container: 'c_db', volume: `supabase_db_${PROJECT}`, systemIdentifier: SYSID },
  containers: ['c_auth', 'c_db'], volumes: [`supabase_db_${PROJECT}`], networks: ['n_net'] };
const ok = (stdout = ''): DockerAnswer => ({ code: 0, stdout, stderr: '' });
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** The receipt run 44316016932 produced: every journey step PASSED, cleanup NOT_PROVEN, refused by Auth. */
const fullReceipt = () => ({ schema: 'billing-user-journey/v1', journey: 'conversion', stripeMode: 'test', result: 'INCOMPLETE',
  steps: REQUIRED_STEPS.conversion.map(step => ({ step, result: step === 'cleanup' ? 'NOT_PROVEN' : 'PASSED' })),
  failureStage: null, reason: 'account_cleanup_deleteuser_failed', cleanup: 'UNPROVEN',
  billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF', testedRelease: RELEASE, stackRun: PROJECT });
const receiptText = (over: Record<string, unknown> = {}) => JSON.stringify([{ ...fullReceipt(), ...over }]);
const PREFLIGHT = { dispatch_check: 'success', stripe_account: 'success', stack_start: 'success', stack_identity: 'success' };
const evidence = (over: Record<string, unknown> = {}, receipt = receiptText()) => ({ receiptText: receipt, receiptSha256: sha(receipt),
  binding: ownerBindingRecord(PROJECT, MARKER), journey: 'conversion', release: RELEASE, preflight: PREFLIGHT, ...over });

let db: PGlite;
let user: string;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(bootstrapSql());
  await db.exec(`SET ROLE closure_owner;${candidate()}\nRESET ROLE;`);
  await db.exec(`SET ROLE closure_owner;${readFileSync('backend/supabase/migrations/20261112133000_recording_start_abandonment_1643.sql', 'utf8')}\nRESET ROLE;`);
  user = (await seed(db, 0)).user;
  await db.query('UPDATE auth.users SET email = $1 WHERE id = $2', [`${MARKER}@example.com`, user]);
}, 240_000);
afterEach(async () => { await db.close().catch(() => undefined); });

/** A fake daemon for this run's stack. psql runs the one statement on PGlite; `over` replaces an answer by its args. */
function daemon(over: Record<string, DockerAnswer> = {}, logs: Record<string, string> = {}) {
  const calls: string[] = [];
  const execOut: string[] = [];
  const run = async (args: string[]): Promise<DockerAnswer> => {
    const key = args.join(' ');
    calls.push(key);
    if (key in over) return over[key];
    if (args[0] === 'container' && args[1] === 'inspect') {
      const service = /^supabase_(db|auth)_/.exec(args[4])?.[1];
      return service ? ok(`c_${service} /${args[4]} ${PROJECT}\n`) : { code: 1, stdout: '', stderr: 'No such container' };
    }
    if (args[0] === 'exec') {
      assert.deepEqual(args.slice(0, 3), ['exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000']);
      // PGlite has no control file; the one statement is otherwise executed exactly as sent.
      const sql = args[args.length - 1].replace('(SELECT system_identifier::text FROM pg_control_system())', `'${SYSID}'`);
      await db.exec('RESET ROLE');
      const r = await db.query<Record<string, unknown>>(sql);
      const out = r.rows.map(row => Object.values(row).join('|')).join('\n');
      execOut.push(out);
      return ok(out);
    }
    if (args[0] === 'logs') return { code: 0, stdout: logs[args[1]] ?? '', stderr: '' };
    throw new Error(`unexpected docker call: ${key}`);
  };
  return { run, calls, execOut };
}

/** The witness is synchronous over Docker; resolve every fake answer first by replaying until none is pending. */
async function witness(d: ReturnType<typeof daemon>, ev: unknown = evidence(), id: unknown = identity) {
  const answers = new Map<string, DockerAnswer>();
  for (;;) {
    const pending: string[][] = [];
    const sync = (args: string[]) => {
      const a = answers.get(args.join('\u0000'));
      if (a) return a;
      pending.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    let result: unknown; let error: unknown;
    try { result = witnessCleanupRefusal(ev, id, PROJECT, sync); } catch (e) { error = e; }
    const fresh = pending.filter(a => !answers.has(a.join('\u0000')));
    if (fresh.length === 0) { if (error) throw error; return result as ReturnType<typeof witnessCleanupRefusal>; }
    answers.set(fresh[0].join('\u0000'), await d.run(fresh[0]));
  }
}

async function asOwner(sql: string, params: unknown[] = []) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await db.query<Record<string, unknown>>(sql, params); } finally { await db.exec('RESET ROLE'); }
}
const FINAL = JSON.stringify({ reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'wpm', value: 100, comparator: 'within_target', templateVersion: 'rec_v1' });
async function savedTake(lease: string) {
  const c = (await asOwner("SELECT create_session_and_update_usage($1::jsonb,'private') AS r",
    [JSON.stringify({ title: 't', duration: 0, product: 'open_mic', lease_id: lease })])).rows[0].r as { new_session: { id: string } };
  await asOwner("SELECT complete_session_v2($1,'completed',60,NULL,$2::jsonb,100,NULL,100,'{}',NULL,$3)", [c.new_session.id, FINAL, 'x']);
}
const refusedWith = (code: string) => (e: unknown) => e instanceof StackProofError && e.code === code;

test('a superseded lease leaves an admitted lease-only obligation: counted apart from the settled take; nothing identifying leaves', async () => {
  const L1 = randomUUID(), L2 = randomUUID();
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [L1, 'p']);
  await asOwner('SELECT acquire_recording_lease($1,$2,true)', [L2, 'p']);
  await savedTake(L2);
  const d = daemon({}, { c_auth: '{"msg":"500: Database error deleting user"}\n', c_db: 'ERROR:  account admitted save unsettled\n' });
  const w = await witness(d);
  assert.deepEqual(w.counts.obligation, { 'admitted:lease_only_superseded': 1, 'completed:session_linked': 1 });
  assert.deepEqual(w.counts.session, { 'completed:lease_linked': 1 });
  assert.equal(Object.values(w.counts.lease).reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(w.supportingLogPhraseLines, { 'auth:auth_database_error_deleting_user': 1, 'db:guard_admitted_save_unsettled': 1 });
  assert.equal(w.logScope, 'container_lifetime_not_attempt_scoped');
  assert.deepEqual([w.receipt, w.owner, w.database], ['this_run', 'bound', 'recorded']);
  // One statement: the identity, owner check and counts come from one snapshot.
  assert.equal(d.calls.filter(c => c.startsWith('exec ')).length, 1);
  const out = JSON.stringify(w);
  for (const secret of [SYSID, MARKER, PROJECT, user, '@']) assert.ok(!out.includes(secret), `leaked ${secret}`);
  assert.doesNotMatch(out, /[0-9a-f]{8}-[0-9a-f]{4}-/);
});

test('a lease released before any take keeps its admitted debt (delete refused); only the explicit abandonment settles it', async () => {
  const L1 = randomUUID();
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [L1, 'p']);
  await asOwner('SELECT release_recording_lease($1)', [L1]);
  let w = await witness(daemon());
  assert.deepEqual(w.counts, { obligation: { 'admitted:lease_only_superseded': 1 }, lease: {}, session: {} });
  await assert.rejects(db.query('DELETE FROM auth.users WHERE id = $1', [user]), /account admitted save unsettled/);
  assert.deepEqual((await asOwner('SELECT abandon_recording_start_v1($1) AS r', [L1])).rows[0].r,
    { abandoned: true, outcome: 'abandoned_not_recorded', repeated: false });
  w = await witness(daemon());
  assert.deepEqual(w.counts, { obligation: {}, lease: {}, session: {} });
});

test('a Start still holding its lease with no take counts as lease-only on the current lease', async () => {
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [randomUUID(), 'p']);
  const w = await witness(daemon());
  assert.deepEqual(w.counts.obligation, { 'admitted:lease_only_current': 1 });
  assert.deepEqual(w.counts.lease, { recording: 1 });
});

test('receipt, dispatch, reason and binding controls refuse before Docker is touched (incl. non-enum reasons)', async () => {
  const expectRefusal = async (code: string, ev: unknown) => {
    const d = daemon();
    await assert.rejects(witness(d, ev), refusedWith(code), code);
    assert.equal(d.calls.length, 0, `${code}: Docker was called`);
  };
  const text = receiptText();
  await expectRefusal('witness_receipt_unbound', evidence({ receiptSha256: sha(`${text} `) }));
  await expectRefusal('witness_receipt_unbound', evidence({ receiptText: null }));
  await expectRefusal('witness_dispatch_invalid', evidence({ release: 'main' }));
  for (const over of [{ stackRun: OTHER_PROJECT }, { testedRelease: 'b'.repeat(40) }, { journey: 'first_conversion' }]) {
    await expectRefusal('witness_receipt_not_this_run', evidence({}, receiptText(over)));
  }
  for (const reason of ['account_cleanup_deleteuser_failed ', 'ACCOUNT_CLEANUP_DELETEUSER_FAILED', 'account_cleanup_other', null, '$(id)']) {
    await expectRefusal('witness_reason_not_auth_refused', evidence({}, receiptText({ reason })));
  }
  const two = JSON.stringify([JSON.parse(text)[0], JSON.parse(text)[0]]);
  await expectRefusal('witness_receipt_shape', evidence({}, two));
  // Correctly hashed, right reason, but not the Auth-refused shape: each is refused before Docker.
  const missingKey: Record<string, unknown> = fullReceipt();
  delete missingKey.cleanup;
  await expectRefusal('witness_receipt_shape', evidence({}, JSON.stringify([missingKey])));
  await expectRefusal('witness_receipt_shape', evidence({}, receiptText({ extra: 1 })));
  await expectRefusal('witness_receipt_not_test_mode', evidence({}, receiptText({ stripeMode: 'live' })));
  await expectRefusal('witness_receipt_not_test_mode', evidence({}, receiptText({ schema: 'billing-user-journey/v0' })));
  for (const over of [{ cleanup: 'PENDING_STACK_DESTRUCTION' }, { result: 'PENDING_STACK_DESTRUCTION' }, { billingRowResidue: 'COUNTED_ZERO_OR_FAILED' },
    { failureStage: 'Bad Stage' }, { steps: fullReceipt().steps.slice(1) },
    { steps: fullReceipt().steps.map(s => ({ ...s, result: 'PASSED' })) },
    { steps: fullReceipt().steps.map(s => (s.step === 'paid_ui' ? { ...s, result: 'MAYBE' } : s)) },
    { steps: [...fullReceipt().steps].reverse() }]) {
    await expectRefusal('witness_receipt_not_cleanup_refused', evidence({}, receiptText(over)));
  }
  // The workflow preflight must have passed: each failed, skipped or missing outcome refuses.
  for (const id of Object.keys(PREFLIGHT)) {
    await expectRefusal('witness_preflight_not_passed', evidence({ preflight: { ...PREFLIGHT, [id]: 'failure' } }));
    await expectRefusal('witness_preflight_not_passed', evidence({ preflight: { ...PREFLIGHT, [id]: 'skipped' } }));
  }
  await expectRefusal('witness_preflight_not_passed', evidence({ preflight: { dispatch_check: 'success' } }));
  await expectRefusal('witness_preflight_not_passed', evidence({ preflight: undefined }));
  // Owner binding swaps: another stack run's binding, a malformed digest, an extra field, or none.
  await expectRefusal('witness_owner_binding_invalid', evidence({ binding: ownerBindingRecord(OTHER_PROJECT, MARKER) }));
  await expectRefusal('witness_owner_binding_invalid', evidence({ binding: { ...ownerBindingRecord(PROJECT, MARKER), ownerBindingSha256: 'x' } }));
  await expectRefusal('witness_owner_binding_invalid', evidence({ binding: { ...ownerBindingRecord(PROJECT, MARKER), email: 'x' } }));
  await expectRefusal('witness_owner_binding_invalid', evidence({ binding: null }));
});

test('wrong owner inside the database: the one statement returns no counts and the witness refuses', async () => {
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [randomUUID(), 'p']);
  // A well-formed binding of this run for a DIFFERENT marker: the account looks synthetic but is not this run's owner.
  const d = daemon();
  await assert.rejects(witness(d, evidence({ binding: ownerBindingRecord(PROJECT, `rwt-journey-billing-${randomUUID()}`) })),
    refusedWith('witness_owner_unbound'));
  // The same marker digested for the other stack run does not match here either (the run is part of the digest).
  const swapped = { ...ownerBindingRecord(PROJECT, MARKER), ownerBindingSha256: ownerBindingRecord(OTHER_PROJECT, MARKER).ownerBindingSha256 };
  await assert.rejects(witness(daemon(), evidence({ binding: swapped })), refusedWith('witness_owner_unbound'));
  // A second synthetic user beside the bound owner: the database is not this run's alone.
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${randomUUID()}', 'rwt-journey-billing-${randomUUID()}@example.com')`);
  const two = daemon();
  await assert.rejects(witness(two), refusedWith('witness_owner_unbound'));
  // The statement itself produced no counts for the bound owner once the database is not that owner's alone.
  assert.deepEqual(two.execOut.at(-1)?.split('\n'), [`sysid|${SYSID}`, 'owner|2|1']);
});

test('the container must be the recorded one and the database identity is checked in the same statement', async () => {
  const inspectDb = `container inspect --format {{.Id}} {{.Name}} {{index .Config.Labels "${LABEL}"}} supabase_db_${PROJECT}`;
  await assert.rejects(witness(daemon({ [inspectDb]: ok(`c_other /supabase_db_${PROJECT} ${PROJECT}`) })), refusedWith('witness_db_container_not_recorded'));
  await assert.rejects(witness(daemon({ [inspectDb]: ok(`c_db /supabase_db_${PROJECT} ${OTHER_PROJECT}`) })), refusedWith('witness_db_container_not_recorded'));
  await assert.rejects(witness(daemon({ [inspectDb]: { code: 1, stdout: '', stderr: 'denied' } })), refusedWith('witness_db_container_unreadable'));
  await assert.rejects(witness(daemon(), evidence(), { ...identity, database: { ...identity.database, systemIdentifier: '999' } }),
    refusedWith('witness_database_identity_mismatch'));
  await assert.rejects(witness(daemon(), evidence(), { ...identity, schema: 'other' }), refusedWith('identity_not_this_run'));
});

test('an unreadable count row, a failed or timed-out query, or unreadable logs is a failure, never a partial answer', () => {
  const base = (stdout: string) => (args: string[]): DockerAnswer => {
    if (args[0] === 'container') return ok(`c_${/supabase_(db|auth)_/.exec(args[4])?.[1]} /${args[4]} ${PROJECT}\n`);
    if (args[0] === 'exec') return ok(stdout);
    return ok('');
  };
  const good = `sysid|${SYSID}\nowner|1|1\n`;
  assert.throws(() => witnessCleanupRefusal(evidence(), identity, PROJECT, base(`${good}obligation|admitted|lease_only_current|1\nuser@example.com\n`)),
    refusedWith('witness_count_unreadable'));
  assert.throws(() => witnessCleanupRefusal(evidence(), identity, PROJECT, (args) => (args[0] === 'exec' ? { code: 2, stdout: '', stderr: 'timeout' } : base(good)(args))),
    refusedWith('witness_query_failed'));
  assert.throws(() => witnessCleanupRefusal(evidence(), identity, PROJECT, (args) => (args[0] === 'logs' ? { code: 1, stdout: '', stderr: 'x' } : base(good)(args))),
    refusedWith('witness_auth_logs_unreadable'));
  assert.equal(witnessCleanupRefusal(evidence(), identity, PROJECT, base(good)).owner, 'bound');
  // Closed vocabulary: an unknown or NULL category fails closed; nothing is silently dropped.
  for (const row of ['session|archived|lease_linked|1', 'session|null|lease_linked|1', 'lease|null|-|1', 'obligation|refused|lease_only_current|1',
    'obligation|admitted|lease_only_somewhere|1', 'lease|recording|x|1']) {
    assert.throws(() => witnessCleanupRefusal(evidence(), identity, PROJECT, base(`${good}${row}\n`)), refusedWith('witness_count_category_unexpected'), row);
  }
  assert.throws(() => witnessCleanupRefusal(evidence(), identity, PROJECT, base(`${good}lease|recording|-|1\nlease|recording|-|1\n`)), refusedWith('witness_count_unreadable'));
});

test('the witness receipt keys are the finalizer\'s; a NULL session status reaches the witness as a category, not a dropped row', async () => {
  assert.deepEqual([...WITNESS_RECEIPT_KEYS], [...RECEIPT_KEYS]);
  await asOwner('SELECT acquire_recording_lease($1,$2,false)', [randomUUID(), 'p']);
  await savedTake((await asOwner("SELECT lease_id FROM active_recording_lease")).rows[0].lease_id as string);
  await db.exec('ALTER TABLE public.sessions DISABLE TRIGGER USER; UPDATE public.sessions SET status = NULL; ALTER TABLE public.sessions ENABLE TRIGGER USER;');
  const d = daemon();
  await assert.rejects(witness(d), refusedWith('witness_count_category_unexpected'));
  assert.match(d.execOut.at(-1) ?? '', /^session\|null\|lease_linked\|1$/m);
});
