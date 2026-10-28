// Shared synthetic SQL fixture and owned native runner. No hosted URL/credential/provider is accepted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { completionBootstrap } from './account-completion-fixture.mjs';
import { replacementTakeFixture, validateReplacementAdmission,
  retentionSnapshotSql } from './retention-edited-take-full-chain.mjs';

export const migrationPath = 'backend/supabase/migrations/20261025021046_content_free_retention_evidence.sql';
export const candidate = () => readFileSync(migrationPath, 'utf8');
const nextAction = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'wpm', value: 100,
  comparator: 'within_target', templateVersion: 'rec_v1' };
const migration = name => readFileSync(join('backend/supabase/migrations', name), 'utf8');
const expiredCoachingRefusal = error => (error.sqlstate ?? error.code) === '23514'
  && /retention_expired_coaching_refused/.test(error.message);
export function bootstrapSql() {
  return completionBootstrap() + `
    SET TIME ZONE 'UTC';
    SET ROLE closure_owner;
    ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS attribution_status text NOT NULL DEFAULT 'pending';
    CREATE TABLE public.objective_source_recording(session_id uuid PRIMARY KEY,user_id uuid NOT NULL);
    ${migration('20260803010000_session_attribution_authority.sql')}
    ${migration('20260812030000_progress_cohort_mode_separation_1265.sql')}
    ${migration('20260816223606_metrics_only_additive_1306.sql')}
    ${migration('20260817140000_repoint_analytics_summary_flat_1306.sql')}
    ${migration('20260924150000_progress_evaluation_filler_counts_authority_1471.sql')}
    ${migration('20260810120000_retention_purge_ai_suggestions.sql')}
    ${migration('20261013120000_retention_expiry_without_superuser_1258.sql')}
    ${migration('20261013140000_retention_expiry_typed_empty_array_1258.sql')}
    ${migration('20261020230653_account_pending_completion_journal_1643.sql')}
    ${migration('20261024083000_account_coaching_unknown_fence_1643.sql')}
    RESET ROLE;
  `;
}

let sequence = 0;
export async function seed(db, count = 1, { recovery = false, mismatch = false, recoveryOnly = false, product = 'open_mic' } = {}) {
  sequence++;
  const user = `d1000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  await db.exec(`RESET ROLE; INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${user}','retention-${sequence}@example.test',now());
    UPDATE user_profiles SET subscription_status='pro', stripe_subscription_id='sub_synthetic_${sequence}' WHERE id='${user}';
    SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE closure_owner;`);
  const result = await db.query(`INSERT INTO sessions(user_id,status,created_at,transcript,total_words,duration,
      filler_counts,wpm,engine,engine_version,model_name,product)
      SELECT $1,'completed','2026-01-01'::timestamptz + i * interval '1 second',
      'synthetic speech [noise] [music]',100,60,'{"um":2}',100,'private','v2','base',$3
      FROM generate_series(1,$2::integer) AS g(i) RETURNING id`, [user, count, product]);
  const ids = result.rows.map(row => row.id);
  if (recovery) {
    // Model a PRE-INSTALL recovery copy; the new writer guard must forbid recreating one afterwards.
    await db.exec('ALTER TABLE transcript_retention_tombstones DISABLE TRIGGER aa_retention_recovery_write_guard;');
    try {
      await db.query(`INSERT INTO transcript_retention_tombstones(session_id,user_id,transcript,policy_version)
        SELECT id,user_id,$2,'newest_one_v1' FROM sessions WHERE user_id=$1 RETURNING session_id`,
      [user, mismatch ? 'different synthetic content' : 'synthetic speech [noise] [music]']);
    } finally { await db.exec('ALTER TABLE transcript_retention_tombstones ENABLE TRIGGER aa_retention_recovery_write_guard;'); }
    if (recoveryOnly) {
      // Exact pre-policy expired shape, staged without changing any retained application source.
      await db.exec('ALTER TABLE sessions DISABLE TRIGGER aa_retention_content_row_guard; ALTER TABLE sessions DISABLE TRIGGER trg_sessions_set_transcript_state;');
      try { await db.query("UPDATE sessions SET transcript=NULL,transcript_state='expired' WHERE user_id=$1", [user]); }
      finally { await db.exec('ALTER TABLE sessions ENABLE TRIGGER trg_sessions_set_transcript_state; ALTER TABLE sessions ENABLE TRIGGER aa_retention_content_row_guard;'); }
    }
  }
  return { user, ids };
}

export async function replaceTake(db, user, { fail = false } = {}) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE closure_owner;`);
  const result = await db.query(`SELECT create_session_and_update_usage($1::jsonb,'private') AS r`,
    [JSON.stringify({ title: 'synthetic active take', duration: 0, product: 'open_mic' })]);
  const id = result.rows[0].r.new_session.id;
  if (fail) await db.exec(`CREATE FUNCTION public.retention_fixture_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic_retention_fault'; END; $$;
    CREATE TRIGGER retention_fixture_fault BEFORE DELETE ON transcript_retention_tombstones
    FOR EACH ROW EXECUTE FUNCTION retention_fixture_fault();`);
  try {
    const saved = await db.query(`SELECT complete_session_v2($1,'completed',60,NULL,$2::jsonb,120,NULL,100,'{"um":2}',NULL,'new synthetic take') AS r`,
      [id, JSON.stringify(nextAction)]);
    return { id, receipt: saved.rows[0].r };
  } finally {
    if (fail) await db.exec('DROP TRIGGER retention_fixture_fault ON transcript_retention_tombstones; DROP FUNCTION retention_fixture_fault();');
  }
}

export async function inspect(db, user) {
  return (await db.query(`SELECT
    (SELECT count(*)::int FROM sessions WHERE user_id=$1 AND transcript IS NOT NULL) AS live,
    (SELECT count(*)::int FROM transcript_retention_tombstones WHERE user_id=$1) AS recovery,
    (SELECT count(*)::int FROM session_progress_content_evidence WHERE user_id=$1) AS snapshots,
    (SELECT count(*)::int FROM session_progress_evaluations WHERE user_id=$1) AS evaluations,
    (SELECT count(*)::int FROM transcript_retention_expiry_grants) AS grants`, [user])).rows[0];
}

export async function settle(db, user, id) {
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE closure_owner;`);
  await db.query(`INSERT INTO session_attribution_authority(session_id,user_id,engine_class,engine,engine_version,model_id,provider)
    VALUES($1,$2,'private','private','v2','base','transformers-js')`, [id, user]);
  return (await db.query('SELECT record_progress_evaluation($1) AS id', [id])).rows[0].id;
}

export const cases = {
  async pendingAndDelayed(db) {
    const { user, ids } = await seed(db, 1, { recovery: true });
    const before = await db.query('SELECT total_words,duration,wpm,filler_counts FROM sessions WHERE id=$1', [ids[0]]);
    assert.equal((await db.query('SELECT record_progress_evaluation($1) AS id', [ids[0]])).rows[0].id, null, 'pending attribution stays pending');
    const replacement = await replaceTake(db, user);
    assert.equal(replacement.receipt.success, true, 'successful replacement is reported');
    assert.deepEqual(await inspect(db, user), { live: 1, recovery: 0, snapshots: 1, evaluations: 0, grants: 0 }, 'both older plaintext copies are gone before delayed attribution');
    assert.deepEqual((await db.query('SELECT total_words,duration,wpm,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before.rows, 'numeric history remains byte-equivalent');
    const evaluation = await settle(db, user, ids[0]); assert.ok(evaluation, 'delayed evaluation completes after erasure');
    const row = (await db.query('SELECT eligible,error_marker_count,word_count,clarity_raw FROM session_progress_evaluations WHERE id=$1', [evaluation])).rows[0];
    assert.equal(row.eligible, true); assert.equal(row.error_marker_count, 2, 'real marker count survives erasure, never imputed zero');
    assert.equal(row.word_count, 100); assert.equal(row.clarity_raw, 91, 'same clarity formula as before erasure');
    await db.query("UPDATE sessions SET transcript='late synthetic restoration',transcript_state='available' WHERE id=$1", [ids[0]]);
    assert.equal((await db.query('SELECT transcript FROM sessions WHERE id=$1', [ids[0]])).rows[0].transcript, null, 'late writes cannot restore expired text');
    await assert.rejects(db.query(`UPDATE sessions SET ai_suggestions='{"synthetic":"late derived coaching"}'::jsonb WHERE id=$1`, [ids[0]]),
      expiredCoachingRefusal, 'expired coaching restoration is an explicit atomic refusal');
    assert.equal((await db.query('SELECT ai_suggestions FROM sessions WHERE id=$1', [ids[0]])).rows[0].ai_suggestions,
      null, 'late coaching cannot restore content after transcript expiry');
    assert.equal((await db.query('SELECT record_progress_evaluation($1) AS id', [ids[0]])).rows[0].id, evaluation, 'terminal evaluation is idempotent');
    return true;
  },
  async failedSave(db) {
    const { user } = await seed(db, 1, { recovery: true });
    const before = await inspect(db, user);
    await assert.rejects(replaceTake(db, user, { fail: true }), /synthetic_retention_fault/, 'fault is injected inside the atomic replacement');
    assert.deepEqual(await inspect(db, user), before, 'failed replacement removes no old text and commits no snapshot');
    return true;
  },
  async mismatchedCopies(db) {
    const { user } = await seed(db, 1, { recovery: true, mismatch: true }); const before = await inspect(db, user);
    await assert.rejects(replaceTake(db, user), /retention_recovery_source_mismatch/);
    assert.deepEqual(await inspect(db, user), before, 'contradictory copies never silently choose one or partially erase'); return true;
  },
  async recoveryOnly(db) {
    const { user } = await seed(db, 2, { recovery: true, recoveryOnly: true });
    await replaceTake(db, user);
    assert.deepEqual(await inspect(db, user), { live: 1, recovery: 0, snapshots: 2, evaluations: 0, grants: 0 }, 'expired recovery-only rows belong to the shared outgoing scope'); return true;
  },
  async distinct500(db) {
    const { user } = await seed(db, 500, { recovery: true });
    await replaceTake(db, user);
    assert.deepEqual(await inspect(db, user), { live: 1, recovery: 0, snapshots: 500, evaluations: 0, grants: 0 }, 'two copies each count as500 distinct sessions, not1000'); return true;
  },
  async distinct501(db) {
    const { user } = await seed(db, 501); const before = await inspect(db, user);
    await assert.rejects(replaceTake(db, user), /retention_outgoing_limit_exceeded/);
    assert.deepEqual(await inspect(db, user), before, 'candidate501 refuses before capture/deletion and rolls back replacement'); return true;
  },
  async startAndFailedStatus(db) {
    const { user } = await seed(db); const before = await inspect(db, user);
    const created = (await db.query(`SELECT create_session_and_update_usage($1::jsonb,'private') AS r`,
      [JSON.stringify({ title: 'synthetic start', duration: 0, product: 'open_mic' })])).rows[0].r;
    const id = created.new_session.id;
    await db.query("UPDATE sessions SET status='failed' WHERE id=$1", [id]);
    assert.deepEqual(await inspect(db, user), before, 'Start/failed status never expires previous text'); return true;
  },
  async deniedSnapshotAndRecoveryWrites(db) {
    const { user, ids } = await seed(db); await db.exec('SET ROLE service_role;');
    await assert.rejects(db.exec('SELECT * FROM session_progress_content_evidence'), /permission denied/, 'service role cannot forge private snapshot authority');
    await db.exec('SET ROLE closure_owner;');
    await assert.rejects(db.query(`INSERT INTO transcript_retention_tombstones(session_id,user_id,transcript,policy_version)
      VALUES($1,$2,'late plaintext','newest_one_v1')`, [ids[0], user]), /retention_plaintext_recovery_write_refused/, 'old recovery writers cannot create phantom copies'); return true;
  },
  async snapshotUnavailable(db) {
    const { user, ids } = await seed(db); await replaceTake(db, user);
    await db.query('DELETE FROM session_progress_content_evidence WHERE session_id=$1', [ids[0]]);
    assert.equal(await settle(db, user, ids[0]), null, 'missing snapshot remains unavailable, not a zero or no_transcript terminal verdict'); return true;
  },
  async lateDerivedWrite(db) {
    const { user, ids } = await seed(db); await replaceTake(db, user);
    const before = (await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows;
    await assert.rejects(db.query('UPDATE sessions SET ai_suggestions=$2::jsonb WHERE id=$1',
      [ids[0], JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'Synthetic late control', what_to_try_next: 'Synthetic next step' })]),
    expiredCoachingRefusal, 'actual UPDATE refuses late derived plaintext before writing');
    assert.equal((await db.query('SELECT ai_suggestions FROM sessions WHERE id=$1', [ids[0]])).rows[0].ai_suggestions,
      null, 'expired derived prose cannot be restored at the actual session UPDATE boundary');
    assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
    await assert.doesNotReject(db.query('UPDATE sessions SET ai_suggestions=NULL WHERE id=$1', [ids[0]]),
      'a legitimate NULL purge remains permitted after expiry');
    return true;
  },
  async guardedLateCoaching(db, providerSettled = true) {
    const { user, ids } = await seed(db);
    const content = () => db.query('SELECT transcript,transcript_state,ai_suggestions FROM sessions WHERE id=$1', [ids[0]]);
    const originalContent = (await content()).rows[0];
    assert.equal(originalContent.transcript, 'synthetic speech [noise] [music]', 'this exact coaching take initially retains its transcript');
    assert.equal(originalContent.ai_suggestions, null);
    const operation = (await db.query('SELECT gen_random_uuid() AS id')).rows[0].id;
    await db.exec('SET ROLE authenticated;');
    const quota = (await db.query('SELECT consume_ai_suggestion_quota(3) AS r')).rows[0].r;
    assert.equal(quota.allowed, true, 'guarded writer fixture has real authenticated quota admission');
    assert.equal(quota.used, 1);
    await db.exec('SET ROLE service_role;');
    await db.query('SELECT begin_account_coaching_v1($1,$2,$3) AS r', [user, ids[0], operation]);
    await db.exec('SET ROLE closure_owner;');
    await replaceTake(db, user);
    const before = (await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows;
    const erased = { transcript: null, transcript_state: 'expired', ai_suggestions: null };
    assert.deepEqual((await content()).rows[0], erased, 'this exact take is erased before its late provider completion');
    const model = JSON.parse(readFileSync('backend/supabase/functions/get-ai-suggestions/contract.json', 'utf8')).model;
    const payload = JSON.stringify({ version: 'gemini_coaching_v1', what_worked: 'Synthetic grounded control', what_to_try_next: 'Synthetic next step' });
    await db.exec('SET ROLE service_role;');
    try {
      const persist = () => db.query(`SELECT persist_account_coaching_v1($1,$6::boolean,$2,$3,$4::jsonb,
        'google_gemini',$5,'user_utc_day',(now() AT TIME ZONE 'UTC')::date,3,1) AS r`, [operation, ids[0], user, payload, model, providerSettled]);
      const assertRejectedState = async () => {
        await db.exec('SET ROLE closure_owner;');
        assert.deepEqual((await content()).rows[0], erased, 'a rejected completion cannot restore this take transcript, state or coaching');
        assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
        assert.equal((await db.query('SELECT phase FROM account_coaching_operations WHERE operation_id=$1', [operation])).rows[0].phase,
          'admitted', 'a SQL refusal alone does not establish provider settlement or safe account exit');
        await db.exec('SET ROLE service_role;');
      };
      await assert.rejects(persist(), expiredCoachingRefusal, 'actual W1 to W2 late completion cannot restore expired coaching');
      await assertRejectedState();
      await assert.rejects(persist(), expiredCoachingRefusal, 'identical late completion retry cannot restore expired coaching');
      await assertRejectedState();
    } finally { await db.exec('SET ROLE closure_owner;'); }
    assert.equal((await db.query('SELECT ai_suggestions FROM sessions WHERE id=$1', [ids[0]])).rows[0].ai_suggestions, null);
    assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
    assert.equal((await db.query('SELECT phase FROM account_coaching_operations WHERE operation_id=$1', [operation])).rows[0].phase,
      'admitted', 'refusing the late write does not fabricate a terminal provider outcome');
    // Exercise the current SQL finalizer, using the already-existing Edge 23514/provider-certainty rule.
    // This is not a provider call or an execution of the Edge handler itself.
    const outcome = providerSettled ? 'refused' : 'unknown';
    await db.exec('SET ROLE service_role;');
    try {
      const finish = value => db.query('SELECT finish_account_coaching_failure_v1($1,$2,$3,$4) AS r', [user, ids[0], operation, value]);
      await assert.rejects(db.exec(`DO $fault$ BEGIN
        PERFORM public.finish_account_coaching_failure_v1('${user}','${ids[0]}','${operation}','${outcome}');
        RAISE EXCEPTION 'synthetic_finalizer_commit_failure'; END $fault$;`), /synthetic_finalizer_commit_failure/,
      'an aborted finalization transaction is not a durable settlement');
      await db.exec('SET ROLE closure_owner;');
      assert.equal((await db.query('SELECT phase FROM account_coaching_operations WHERE operation_id=$1', [operation])).rows[0].phase, 'admitted');
      assert.deepEqual((await content()).rows[0], erased);
      assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
      await db.exec('SET ROLE service_role;');
      assert.equal((await finish(outcome)).rows[0].r, true);
      assert.equal((await finish(outcome)).rows[0].r, true, 'same settlement outcome is idempotent');
      assert.equal((await finish('refused')).rows[0].r, providerSettled, 'uncertain provider outcome cannot be cleared as refused');
    } finally { await db.exec('SET ROLE closure_owner;'); }
    assert.equal((await db.query('SELECT phase FROM account_coaching_operations WHERE operation_id=$1', [operation])).rows[0].phase, outcome);
    assert.deepEqual((await content()).rows[0], erased, 'finalization never restores expired content');
    assert.deepEqual((await db.query('SELECT total_words,wpm,duration,filler_counts FROM sessions WHERE id=$1', [ids[0]])).rows, before);
    return true;
  },
  async uncertainLateCoaching(db) {
    return cases.guardedLateCoaching(db, false);
  },
  async snapshotVersionUnavailable(db) {
    const { user, ids } = await seed(db); await replaceTake(db, user);
    const pin = (await db.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='public.session_progress_content_evidence'::regclass AND contype='c'
        AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.session_progress_content_evidence'::regclass
          AND attname='marker_pattern_version')]::smallint[]`)).rows[0];
    assert.match(pin.conname, /^[a-z_0-9]+$/);
    // Stage an explicit FUTURE-format fixture. The production constraint itself rejects it today.
    await db.exec(`ALTER TABLE session_progress_content_evidence DROP CONSTRAINT ${pin.conname};`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_constraint WHERE conname=$1', [pin.conname])).rows[0].n, 0, 'future-version fixture actually removed the selected version constraint');
    try {
      await db.query("UPDATE session_progress_content_evidence SET marker_pattern_version='future_unrecognized' WHERE session_id=$1", [ids[0]]);
      assert.equal(await settle(db, user, ids[0]), null, 'unknown pattern version remains unavailable, never reinterpreted as current evidence');
    } finally {
      await db.query("UPDATE session_progress_content_evidence SET marker_pattern_version='error_tags_v1' WHERE session_id=$1", [ids[0]]);
      await db.exec(`ALTER TABLE session_progress_content_evidence ADD CONSTRAINT ${pin.conname} ${pin.definition};`);
    }
    assert.ok((await db.query('SELECT record_progress_evaluation($1) AS id', [ids[0]])).rows[0].id, 'recognized restored metadata can finish without restoring text');
    return true;
  },
  async atCapAndReplay(db) {
    const { user } = await seed(db, 1, { recovery: true });
    const key = 'aa000000-0000-4000-8000-000000000001';
    const body = JSON.stringify({ title: 'synthetic recovered take', duration: 600, total_words: 120,
      transcript: 'synthetic at-cap recovery', filler_counts: { um: 2 }, product: 'open_mic', next_action_signal: nextAction });
    const first = (await db.query("SELECT create_session_and_update_usage($1::jsonb,'private',$2::uuid) AS r", [body, key])).rows[0].r;
    assert.equal(first.new_session.status, 'completed', 'the real at-cap create saves and converges');
    const before = await inspect(db, user);
    const replay = (await db.query("SELECT create_session_and_update_usage($1::jsonb,'private',$2::uuid) AS r", [body, key])).rows[0].r;
    assert.equal(replay.new_session.id, first.new_session.id); assert.deepEqual(await inspect(db, user), before, 'response-loss replay creates no additional snapshot or content');
    assert.equal(before.recovery, 0); assert.equal(before.live, 1); return true;
  },
  async crossUser(db) {
    const first = await seed(db); await replaceTake(db, first.user);
    const second = await seed(db); const before = await inspect(db, first.user);
    await assert.rejects(db.query('SELECT record_progress_evaluation($1) AS id', [first.ids[0]]), /session not found for this user/);
    assert.deepEqual(await inspect(db, first.user), before, 'another user cannot read or alter the snapshot/evaluation');
    await replaceTake(db, second.user);
    assert.deepEqual(await inspect(db, first.user), before, 'replacement remains confined to its own user'); return true;
  },
  async rollbackCompatibility(db) {
    const { user } = await seed(db); const saved = await replaceTake(db, user);
    const definition = (await db.query("SELECT pg_get_functiondef('public.sessions_set_transcript_state()'::regprocedure) AS body")).rows[0].body;
    const original = migration('20261013120000_retention_expiry_without_superuser_1258.sql').match(/CREATE OR REPLACE FUNCTION public\.sessions_set_transcript_state\(\)[\s\S]*?\n\$\$;/)?.[0];
    assert.ok(original); await db.exec(original);
    try {
      assert.equal((await db.query('SELECT retention_content_free_compatible() AS ok')).rows[0].ok, false, 'old rollback function identity is detected');
      await db.query('UPDATE sessions SET wpm=wpm WHERE id=$1', [saved.id]);
      await assert.rejects(db.query("UPDATE sessions SET transcript='synthetic incompatible write' WHERE id=$1", [saved.id]),
        /retention_snapshot_incompatible/, 'incompatible rollback holds affected writes without recreating text');
    } finally { await db.exec(definition); }
    assert.equal((await db.query('SELECT retention_content_free_compatible() AS ok')).rows[0].ok, true); return true;
  },
};

export const mutants = [
  { name: 'marker count imputed zero', from: 'v_errors := v_content.error_marker_count;', to: 'v_errors := 0;', exercise: 'pendingAndDelayed' },
  { name: 'missing evidence accepted as complete', from: 'IF NOT FOUND THEN RETURN NULL; END IF;',
    to: 'IF NOT FOUND THEN v_content.has_nonblank := true; v_content.error_marker_count := 0; END IF;', exercise: 'snapshotUnavailable' },
  { name: 'mismatched recovery copy ignored', from: 'v_recovery.transcript IS DISTINCT FROM v_row.transcript', to: 'false', exercise: 'mismatchedCopies' },
  { name: '501 outgoing sessions accepted', from: 'cardinality(v_ids) > p_batch_size', to: 'cardinality(v_ids) > 5000', exercise: 'distinct501' },
  { name: 'late derived-content fence removed', from: "IF OLD.transcript_state = 'expired' AND NEW.ai_suggestions IS NOT NULL THEN",
    to: 'IF false THEN', exercise: 'lateDerivedWrite' },
];

// No inherited PG URL/credentials, TCP listener, linked Supabase target or network download.
export function assertRetentionOwners(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0, 'security-definer catalog absent');
  assert.ok(rows.some(row => row.identity === 'expire_transcripts_newest_one(uuid,integer)'), 'expiry owner absent');
  assert.ok(rows.some(row => row.identity.startsWith('complete_session_v2(')), 'completion owner absent');
  assert.ok(rows.some(row => row.identity.startsWith('record_progress_evaluation(')), 'evaluation owner absent');
  for (const row of rows) {
    assert.equal(row.owner, 'closure_owner', 'security-definer owner differs');
    assert.equal(row.superuser, false, 'security-definer owner must be NOSUPERUSER');
    assert.equal(row.securityDefiner, true, 'catalog row is not security-definer');
  }
  return rows;
}

// These peers deliberately use the fixture's real NOSUPERUSER object owner.
// This is an owner/trigger compatibility matrix, not full-chain authenticated RLS proof.
export async function observeRetentionOwnerRace(io) {
  const editor = await io.edit();
  const replacement = await io.startReplacement();
  for (const actor of [editor, replacement]) {
    assert.ok(Number.isSafeInteger(actor.pid) && actor.pid > 1, 'native actor PID absent');
    assert.equal(actor.role, 'closure_owner', 'fixture actor owner differs');
    assert.equal(actor.superuser, false, 'fixture actor is privileged');
  }
  assert.notEqual(editor.pid, replacement.pid, 'race needs independent connections');
  assert.equal(editor.markerCount, 1, 'edited marker was not observed');
  const deadline = io.now() + 5_000;
  let blocked;
  while (io.now() < deadline) {
    assert.equal(io.replacementSettled(), false, 'replacement finished before editor commit');
    const observation = await io.observe(replacement.pid);
    if (observation?.pid === replacement.pid && observation.application === replacement.application
      && observation.waitType === 'Lock' && observation.state === 'active'
      && observation.blockers.includes(editor.pid)) { blocked = observation; break; }
    await io.pause();
  }
  assert.ok(blocked, 'replacement-to-editor PostgreSQL wait absent');
  assert.equal(io.replacementSettled(), false, 'replacement escaped before fenced commit');
  await io.commitEdit();
  assert.equal((await io.finishReplacement()).success, true, 'replacement was refused');
  const after = await io.inspect();
  assert.deepEqual(after, { expired: true, plaintextAbsent: true, recoveryCopies: 0, snapshots: 1,
    markerCount: 1, nonblank: true, cohortMatches: true, replacementMatches: true,
    versionsMatch: true, numericUnchanged: true, remainingContext: 0, remainingGrants: 0 },
  'committed edit was not preserved as content-free evidence');
  return { editor, replacement, blocked, after };
}

export function createRetentionLocalPeer(bin, socket, env, application, spawnPeer = spawn) {
  const child = spawnPeer(join(bin, 'psql'), ['-h', socket, '-p', '55477', '-U', 'retention_fixture_admin',
    '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending, buffer = '', failed = false, closed = false;
  const fail = () => {
    failed = true;
    if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.reject(new Error('owned native peer failed')); }
  };
  const exit = new Promise(resolveExit => {
    child.on('error', () => { fail(); closed = true; resolveExit(false); });
    child.on('close', (code, signal) => { closed = true; if (pending || code !== 0 || signal) fail(); resolveExit(!failed); });
  });
  child.stdin.on('error', fail);
  child.stderr.on('data', fail); // SQL/payload text is never retained in a peer receipt.
  child.stdout.on('data', chunk => {
    buffer += String(chunk);
    if (buffer.length > 64 * 1024) return fail();
    for (let end; (end = buffer.indexOf('\n')) !== -1;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (pending && line.startsWith(pending.tag)) {
        const p = pending; pending = null; clearTimeout(p.timer);
        try { p.resolve(JSON.parse(line.slice(p.tag.length))); } catch { p.reject(new Error('malformed owned peer response')); fail(); }
      }
    }
  });
  return { application,
    request(sql, expression) {
      assert.equal(failed || closed || Boolean(pending), false, 'native peer unavailable');
      return new Promise((resolveReply, reject) => {
        const tag = randomBytes(12).toString('hex') + ':';
        pending = { tag, resolve: resolveReply, reject, timer: setTimeout(fail, 20_000) };
        child.stdin.write(`${sql}\nSELECT '${tag}' || (${expression})::text;\n`);
      });
    },
    async close() {
      if (!closed) child.stdin.end('\n\\q\n');
      let timer;
      try { return await Promise.race([exit, new Promise(resolveClose => { timer = setTimeout(() => resolveClose(false), 5_000); })]); }
      finally { clearTimeout(timer); }
    },
  };
}

async function runOwnedEditedTakeRace({ db, exec, bin, socket, env }) {
  const { user, ids: [old] } = await seed(db);
  const fixture = replacementTakeFixture(), key = randomUUID();
  const created = (await db.query(`SELECT create_session_and_update_usage($1::jsonb,'private',$2::uuid,'v2','base','desktop') AS r`,
    [JSON.stringify(fixture.createData), key])).rows[0].r;
  const { id: replacement } = validateReplacementAdmission(created, { user, key, fixture });
  const name = `owner_matrix_${randomBytes(6).toString('hex')}`;
  const editor = createRetentionLocalPeer(bin, socket, env, `${name}_editor`);
  const saver = createRetentionLocalPeer(bin, socket, env, `${name}_replacement`);
  const begin = app => `SET client_min_messages=error; SET application_name='${app}'; BEGIN;
    SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='8s';
    SET LOCAL request.jwt.claim.sub='${user}'; SET LOCAL ROLE closure_owner;`;
  const identity = `jsonb_build_object('pid',pg_backend_pid(),'role',current_user,
    'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'application',current_setting('application_name'))`;
  let replacementPromise, settled = false, saved, saveError, primary;
  try {
    return await observeRetentionOwnerRace({
      edit: () => editor.request(`${begin(editor.application)} UPDATE sessions SET transcript='synthetic edited [noise]' WHERE id='${old}';`,
        `${identity} || jsonb_build_object('markerCount',(SELECT regexp_count(transcript,'\\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\\]',1,'i') FROM sessions WHERE id='${old}'))`),
      startReplacement: async () => {
        const actor = await saver.request(begin(saver.application), identity);
        replacementPromise = saver.request('', `complete_session_v2('${replacement}','completed',${fixture.completionDuration},NULL,
          '${JSON.stringify(nextAction)}'::jsonb,120,NULL,100,'{"um":2}',NULL,'synthetic replacement')`)
          .then(value => { saved = value; }, error => { saveError = error; }).finally(() => { settled = true; });
        return actor;
      },
      replacementSettled: () => settled, now: () => Date.now(), pause: () => delay(25),
      observe: async pid => JSON.parse((await exec(`SELECT coalesce((SELECT json_build_object('pid',pid,'application',application_name,
        'waitType',wait_event_type,'state',state,'blockers',pg_blocking_pids(pid)) FROM pg_stat_activity WHERE pid=${pid}),'null'::json);`)).trim().split('\n').at(-1)),
      commitEdit: () => editor.request('COMMIT;', 'json_build_object(\'committed\',true)'),
      finishReplacement: async () => {
        await replacementPromise; if (saveError) throw saveError;
        assert.equal(saved?.success, true, 'completion refused');
        await saver.request('COMMIT;', 'json_build_object(\'committed\',true)'); return saved;
      },
      inspect: async () => JSON.parse((await exec(retentionSnapshotSql({ user, old, replacement }))).trim().split('\n').at(-1)),
    });
  } catch (error) { primary = error; throw error; }
  finally {
    const actorsClosed = (await Promise.all([editor.close(), saver.close()])).every(Boolean);
    if (!actorsClosed && !primary) throw new Error('edited-take peer cleanup incomplete');
    // The parent cluster teardown runs even if a peer cannot close cleanly.
  }
}

// Called after EVERY init/start outcome, including a pg_ctl timeout after a
// postmaster was created. A successful body cannot outrun owned teardown.
export function cleanupOwnedRetentionFixture(io) {
  const before = io.observe();
  if (before.dataPresent) {
    try { io.stop(); } catch { /* Observe independently; a missing server needs no stop. */ }
  }
  const after = io.observe();
  assert.equal(after.processes.length, 0, 'owned PostgreSQL processes remain');
  assert.equal(after.socketPresent, false, 'owned PostgreSQL Unix socket remains');
  assert.equal(after.pidFilePresent, false, 'owned postmaster identity remains');
  io.removeData();
  const final = io.observe();
  assert.equal(final.dataPresent, false, 'owned data directory remains');
  assert.equal(final.processes.length, 0, 'owned PostgreSQL process reappeared');
  assert.equal(final.socketPresent || final.pidFilePresent, false, 'owned PostgreSQL endpoint reappeared');
  return { cleanupVerified: true, dataRemoved: true, processesRemaining: 0, socketRemoved: true };
}

export function ownedRetentionProcessIds(rows, { bin, data, postmasterPid, seen }) {
  const command = `${join(bin, 'postgres')} -D ${data}`;
  const owned = new Set(rows.filter(row => seen.has(row.pid) || row.pid === postmasterPid
    || row.command === command || row.command.startsWith(command + ' ')).map(row => row.pid));
  for (let i = 0; i < rows.length; i++) for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  for (const pid of owned) seen.add(pid);
  return [...owned];
}

export async function nativeFixture(t, { bin = '/opt/homebrew/opt/postgresql@17/bin', expectedVersion,
  ownerMatrix = false, receiptPath } = {}) {
  assert.ok(isAbsolute(bin) && !/\s/.test(bin), 'absolute local PostgreSQL binary path required');
  const root = mkdtempSync(join(tmpdir(), 'rce-')); const data = join(root, 'data'); const socket = join(root, 'socket'); mkdirSync(socket);
  const env = { PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C', TMPDIR: root };
  const receipt = { root, source: migrationPath, sha256: createHash('sha256').update(candidate()).digest('hex'), syntheticOnly: true, tcp: false, cases: [], cleanupVerified: false,
    bodyComplete: false, status: 'INCOMPLETE', ownerScope: ownerMatrix ? 'isolated NOSUPERUSER object-owner fixture; not authenticated full-chain RLS proof' : 'existing native fixture' };
  receipt.testedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5_000 }).trim();
  receipt.bootstrapSha256 = createHash('sha256').update(bootstrapSql()).digest('hex');
  receipt.fixtureSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  if (ownerMatrix) assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', timeout: 5_000 }).trim(), '', 'dirty native matrix source refused');
  let statement = 0;
  const run = (name, args, timeout = 20_000) => execFileSync(join(bin, name), args, { env, encoding: 'utf8', timeout });
  let ownedPid;
  const seenOwnedPids = new Set();
  const observe = () => {
    const pidFilePresent = existsSync(join(data, 'postmaster.pid'));
    if (pidFilePresent) {
      const lines = readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n');
      assert.equal(resolve(lines[1]), data, 'postmaster data ownership differs');
      const pid = Number(lines[0]);
      assert.ok(Number.isSafeInteger(pid) && pid > 1, 'invalid owned postmaster PID');
      if (ownedPid) assert.equal(pid, ownedPid, 'postmaster PID changed');
      ownedPid = pid;
    }
    const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 5_000 })
      .trim().split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
      .map(([, pid, parent, command]) => ({ pid: Number(pid), parent: Number(parent), command }));
    return { dataPresent: existsSync(data), pidFilePresent,
      socketPresent: existsSync(join(socket, '.s.PGSQL.55477')) || existsSync(join(socket, '.s.PGSQL.55477.lock')),
      processes: ownedRetentionProcessIds(processes, { bin, data, postmasterPid: ownedPid, seen: seenOwnedPids }) };
  };
  t.after(() => {
    try {
      Object.assign(receipt, cleanupOwnedRetentionFixture({ observe,
        stop: () => run('pg_ctl', ['-D', data, '-w', '-t', '10', 'stop', '-m', 'immediate'], 15_000),
        removeData: () => rmSync(data, { recursive: true, force: true }) }));
    } finally {
      receipt.status = receipt.bodyComplete === true && receipt.cleanupVerified === true ? 'PASS' : 'FAIL';
      const text = JSON.stringify(receipt, null, 2) + '\n';
      writeFileSync(join(root, 'receipt.json'), text);
      if (receiptPath) writeFileSync(receiptPath, text, { flag: 'wx' });
      process.stdout.write(`native retention receipt: ${join(root, 'receipt.json')}\n`);
    }
  });
  writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  run('initdb', ['-D', data, '-U', 'retention_fixture_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '10', 'start', '-o', `-k ${socket} -p 55477 -c listen_addresses=''`]);
  receipt.postgresBinaryVersion = run('postgres', ['--version']).trim();
  receipt.owner = { controllerPid: process.pid, postmasterPid: Number(readFileSync(join(data, 'postmaster.pid'), 'utf8').split('\n')[0]), data, socket };
  const exec = async text => {
    const path = join(root, `statement-${++statement}.sql`); writeFileSync(path, text);
    try {
      return run('psql', ['-h', socket, '-p', '55477', '-U', 'retention_fixture_admin', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-f', path], 30_000);
    } catch (error) {
      error.sqlstate = String(error.stderr).match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
      throw error;
    }
  };
  const literal = x => x === null ? 'NULL' : typeof x === 'number' ? String(x) : `'${String(x).replaceAll("'", "''")}'`;
  // Each call owns one connection. Synthetic role/subject are explicitly reapplied, never inferred from a prior call.
  let subject = ''; let role = 'closure_owner';
  const prefix = () => `SELECT set_config('request.jwt.claim.sub','${subject}',false); SET ROLE ${role}; SET TIME ZONE 'UTC'; SET statement_timeout='20s'; SET lock_timeout='5s';`;
  const db = {
    exec: async sql => {
      const match = sql.match(/set_config\('request\.jwt\.claim\.sub','([^']+)'/); if (match) subject = match[1];
      const output = await exec(prefix() + sql);
      for (const change of sql.matchAll(/SET ROLE (\w+)|RESET ROLE/g)) role = change[1] ?? 'retention_fixture_admin';
      return output;
    },
    query: async (sql, params = []) => {
      const bound = sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
      if (!/^(SELECT|WITH)\s/i.test(bound.trim()) && !/\bRETURNING\b/i.test(bound)) {
        await exec(prefix() + bound); return { rows: [] };
      }
      const query = /^(SELECT|WITH)\s/i.test(bound.trim()) ? `SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM (${bound}) q;` : `WITH q AS (${bound}) SELECT coalesce(jsonb_agg(q),'[]'::jsonb) FROM q;`;
      const output = await exec(prefix() + query); return { rows: JSON.parse(output.trim().split('\n').at(-1)) };
    },
  };
  receipt.serverVersion = (await exec('SELECT version();')).trim();
  if (expectedVersion) {
    assert.match(expectedVersion, /^1[567]\.\d+$/);
    assert.equal(receipt.postgresBinaryVersion, `postgres (PostgreSQL) ${expectedVersion}`, 'binary version differs');
    assert.equal((await exec('SHOW server_version;')).trim(), expectedVersion, 'server version differs');
  }
  await exec(bootstrapSql()); await exec(`SET ROLE closure_owner; ${candidate()}`);
  if (ownerMatrix) {
    const owners = await db.query(`SELECT p.oid::regprocedure::text AS identity,r.rolname AS owner,
      r.rolsuper AS superuser,p.prosecdef AS "securityDefiner"
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
      WHERE n.nspname='public' AND p.prosecdef ORDER BY p.oid::regprocedure::text`);
    receipt.securityDefinerOwners = assertRetentionOwners(owners.rows);
  }
  for (const [name, body] of Object.entries(cases)) {
    let failure;
    await t.test(name, { timeout: 40_000 }, async () => {
      try { await body(db); receipt.cases.push({ name, status: 'PASS' }); }
      catch (error) { failure = error; receipt.cases.push({ name, status: 'FAIL' }); throw error; }
    });
    if (failure) throw failure;
  }
  // Independent connections exercise actual locks. The holder's two seconds are shorter than
  // the contender's ten-second lock timeout: a blocking mutant would eventually succeed, not pass as NOWAIT.
  const profileHeld = async (user, name, action) => {
    const holderSql = join(root, `holder-${name}.sql`);
    writeFileSync(holderSql, `BEGIN; SET ROLE closure_owner; SELECT 1 FROM user_profiles WHERE id='${user}' FOR UPDATE; SELECT 'LOCKED'; SELECT pg_sleep(2); COMMIT;`);
    const holder = spawn(join(bin, 'psql'), ['-h', socket, '-p', '55477', '-U', 'retention_fixture_admin', '-d', 'postgres', '-X', '-qAt', '-f', holderSql], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (holder.exitCode === null) holder.kill('SIGTERM'); });
    const done = new Promise((resolveExit, rejectExit) => {
      holder.on('error', rejectExit);
      holder.on('exit', code => code === 0 ? resolveExit() : rejectExit(new Error(`holder exit ${code}`)));
    });
    done.catch(() => undefined); // Observe startup errors immediately; the awaited promise below still rejects.
    try {
      await new Promise((resolveLock, rejectLock) => {
        holder.stdout.on('data', chunk => { if (String(chunk).includes('LOCKED')) resolveLock(); });
        holder.on('error', rejectLock);
        holder.on('exit', () => rejectLock(new Error('holder exited before the lock receipt')));
      });
      await action();
    } finally { await done; }
  };
  const busy = error => error.sqlstate === '55P03' && /could not obtain lock/.test(error.message);
  {
    const { user } = await seed(db); const before = await inspect(db, user);
    const insert = `SELECT set_config('request.jwt.claim.sub','${user}',false); SET lock_timeout='10s'; SET ROLE closure_owner;
      INSERT INTO sessions(user_id,status,duration,transcript) VALUES('${user}','completed',60,'synthetic concurrent take');`;
    await profileHeld(user, 'statement', () => assert.rejects(exec(insert), busy, 'statement admission refuses rather than waiting behind an inverse writer'));
    assert.deepEqual(await inspect(db, user), before, 'refused INSERT commits no session, snapshot or content loss');
    await exec(insert);
    assert.equal((await inspect(db, user)).live, before.live + 1, 'same INSERT retries successfully after release');
    receipt.cases.push({ name: 'native-statement-nowait-refusal-and-retry', status: 'PASS' });
  }
  {
    const { user } = await seed(db);
    // Valid current save-only shape, admitted by the real legacy classifier; no trigger disable or grant changes.
    const id = (await db.query(`INSERT INTO sessions(user_id,status,duration,transcript,recording_fenced_at,recording_fenced_reason,
      total_words,wpm,filler_counts,engine,engine_version,model_name,product)
      VALUES($1,'active',60,'synthetic ambiguous saved take',now(),'save_only',100,100,'{"um":2}','private','v2','base','open_mic') RETURNING id`, [user])).rows[0].id;
    const read = () => db.query('SELECT transcript,duration,total_words,wpm,filler_counts,status FROM sessions WHERE id=$1', [id]);
    const before = (await read()).rows[0];
    const classify = `SELECT set_config('request.jwt.claim.sub','',false); SET lock_timeout='10s'; SET ROLE service_role;
      SELECT classify_transcript_retention_legacy_session('${id}','completed','synthetic native classification');`;
    await profileHeld(user, 'classifier', () => assert.rejects(exec(classify), busy, 'real service classifier already holding its session row refuses nonblocking profile admission'));
    assert.deepEqual((await read()).rows[0], before, 'classifier refusal rolls back its classification and content changes');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM transcript_retention_legacy_classifications WHERE session_id=$1', [id])).rows[0].n, 0);
    await exec(classify);
    assert.deepEqual((await read()).rows[0], { ...before, status: 'completed' }, 'classifier retry succeeds after release without changing content or metrics');
    receipt.cases.push({ name: 'native-service-prelocked-session-nowait-and-retry', status: 'PASS' });
  }
  {
    const { user, ids } = await seed(db, 1, { recovery: true }); const before = await inspect(db, user);
    const remove = `SELECT set_config('request.jwt.claim.sub','',false); SET lock_timeout='10s'; SET ROLE closure_owner;
      BEGIN; SELECT 1 FROM sessions WHERE id='${ids[0]}' FOR UPDATE;
      DELETE FROM transcript_retention_tombstones WHERE session_id='${ids[0]}'; COMMIT;`;
    await profileHeld(user, 'recovery', () => assert.rejects(exec(remove), busy, 'recovery DELETE after a session lock also refuses nonblocking profile admission'));
    assert.deepEqual(await inspect(db, user), before, 'failed cleanup transaction retains both plaintext copies and evidence');
    await exec(remove);
    assert.deepEqual(await inspect(db, user), { ...before, recovery: 0 }, 'same cleanup succeeds after release without altering live content or metrics');
    receipt.cases.push({ name: 'native-prelocked-recovery-delete-nowait-and-retry', status: 'PASS' });
  }
  if (ownerMatrix) receipt.editedTake = await runOwnedEditedTakeRace({ db, exec, bin, socket, env, t });
  receipt.bodyComplete = true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  test('owned native PostgreSQL content-free retention', { timeout: 240_000 }, nativeFixture);
}
