// A post-128 behavior proof in the full-chain runner's already-owned database.
// The protocol controls use injected peers; only the CLI below is native evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { t2ReleaseContract, t2ReleaseLedgerQuery, t2ReleaseSnapshotQuery,
  assertT2ReleaseSnapshot } from '../../scripts/lib/t2MigrationPostflight.mjs';

const migration = 'backend/supabase/migrations/20261025021046_content_free_retention_evidence.sql';
const migrationSha256 = '37af792f8abeeb0e073e229ec25cd294a20050058632f793c4635ba3af37f47d';
const nextAction = JSON.stringify({ reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'wpm',
  value: 100, comparator: 'within_target', templateVersion: 'rec_v1' });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

export function replacementTakeFixture() {
  const completionDuration = 60;
  return { createData: { title: 'synthetic replacement', save_only: true, duration: completionDuration, product: 'open_mic' },
    completionDuration };
}

export function validateReplacementAdmission(created, { user, key, fixture }) {
  assert.equal(created?.usage_exceeded, false, 'replacement usage admission refused');
  const session = created.new_session;
  assert.match(session?.id ?? '', /^[a-f0-9-]{36}$/, 'real save-only placeholder was refused');
  assert.equal(session.user_id, user, 'replacement owner differs');
  assert.equal(session.idempotency_key, key, 'replacement recording identity differs');
  assert.equal(session.status, 'active', 'replacement is not a pending save');
  assert.equal(session.recording_fenced_reason, 'save_only', 'replacement is not save-only');
  assert.ok(typeof session.recording_fenced_at === 'string' && session.recording_fenced_at.length > 0,
    'replacement recording fence absent');
  assert.equal(session.lease_id, null, 'save-only replacement acquired an engine lease');
  assert.equal(session.transcript, null, 'replacement was already saved before the race');
  assert.ok(Number.isInteger(fixture.completionDuration) && fixture.completionDuration > 0
    && fixture.completionDuration <= 600, 'invalid fixture completion duration');
  assert.ok(Number.isInteger(session.duration) && session.duration >= fixture.completionDuration
    && session.duration === fixture.createData.duration, 'replacement completion exceeds billed duration');
  return { id: session.id, billedDuration: session.duration, completionDuration: fixture.completionDuration };
}

function peer(value, name) {
  assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0, `${name} backend PID absent`);
  assert.equal(value.role, 'authenticated', `${name} is not the real authenticated writer`);
  assert.equal(value.superuser, false, `${name} writer is privileged`);
  assert.equal(value.database, 'postgres', `${name} database differs`);
  return value;
}

// The commit is fenced by observed pg_blocking_pids, not a sleep or generic lock.
export async function observeEditedTakeRace(io, { waitMs = 5_000 } = {}) {
  assert.ok(Number.isInteger(waitMs) && waitMs > 0 && waitMs <= 5_000, 'unbounded race observation');
  const timing = { startedMs: io.now() };
  const editor = peer(await io.edit(), 'editor');
  timing.editObservedMs = io.now();
  assert.equal(editor.markerCount, 1, 'editor did not write the distinguishable marker');
  const replacement = peer(await io.startReplacement(), 'replacement');
  assert.notEqual(editor.pid, replacement.pid, 'writers share a database connection');
  const deadline = io.now() + waitMs;
  let blocked;
  while (io.now() < deadline) {
    assert.equal(io.replacementSettled(), false, 'replacement settled before editor commit');
    const observation = await io.observe(replacement.pid);
    if (observation !== null) {
      assert.equal(observation.pid, replacement.pid, 'observer read another backend');
      assert.equal(observation.application, replacement.application, 'replacement identity changed');
      if (observation.waitType === 'Lock' && observation.state === 'active'
        && observation.blockers.includes(editor.pid)) {
        blocked = observation;
        break;
      }
    }
    await io.pause();
  }
  assert.ok(blocked, 'exact replacement-to-editor wait was not observed');
  timing.blockObservedMs = io.now();
  assert.equal(io.replacementSettled(), false, 'replacement settled before fenced editor commit');
  await io.commitEdit();
  timing.editCommittedMs = io.now();
  const saved = await io.finishReplacement();
  timing.replacementCompletedMs = io.now();
  assert.equal(saved.success, true, 'actual replacement save refused');
  const after = await io.inspect();
  assert.deepEqual(after, {
    expired: true, plaintextAbsent: true, recoveryCopies: 0, snapshots: 1,
    markerCount: 1, nonblank: true, cohortMatches: true, replacementMatches: true,
    versionsMatch: true, numericUnchanged: true, remainingContext: 0, remainingGrants: 0,
  }, 'post-save content-free evidence differs from the committed edit');
  return { editor, replacement, blocked, after, timing };
}

// Native case completion alone cannot PASS: the parent owns container teardown.
export function finalizeEditedTakeProof(receipt, { owner, testedCommit, cleanupVerified, parentPassed }) {
  assert.equal(receipt.schemaVersion, 1, 'unknown edited-take receipt');
  assert.equal(receipt.owner, owner, 'edited-take cleanup owner differs');
  assert.equal(receipt.testedCommit, testedCommit, 'edited-take cleanup source differs');
  const complete = receipt.status === 'AWAITING_OWNED_TEARDOWN' && receipt.bodyComplete === true
    && receipt.actorsClosed === true && receipt.activationRestored === true;
  return { ...receipt, cleanupVerified: cleanupVerified === true,
    status: complete && cleanupVerified === true && parentPassed === true ? 'PASS' : 'FAIL' };
}

// A zero child exit is not evidence. This is the actual parent call seam, so
// controls can exercise the missing-file outcome without spawning Docker.
export function runRequiredEditedTakeProof({ run, read, owner, testedCommit }) {
  run();
  const receipt = read();
  assert.ok(receipt && typeof receipt === 'object', 'edited-take child receipt absent');
  assert.equal(receipt.schemaVersion, 1, 'unknown edited-take child receipt');
  assert.equal(receipt.owner, owner, 'edited-take child owner differs');
  assert.equal(receipt.testedCommit, testedCommit, 'edited-take child source differs');
  assert.equal(receipt.status, 'AWAITING_OWNED_TEARDOWN', 'child cannot finalize its own teardown');
  assert.equal(receipt.bodyComplete, true, 'edited-take body incomplete');
  assert.equal(receipt.actorsClosed, true, 'edited-take peers not closed');
  assert.equal(receipt.activationRestored, true, 'edited-take policy not restored');
  assert.equal(receipt.cleanupVerified, false, 'child cannot claim parent teardown');
  return receipt;
}

export function retentionSnapshotSql({ user, old, replacement }) {
  for (const id of [user, old, replacement]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  return `SELECT json_build_object(
    'expired',s.transcript_state='expired','plaintextAbsent',s.transcript IS NULL,
    'recoveryCopies',(SELECT count(*) FROM public.transcript_retention_tombstones WHERE user_id=${quote(user)}),
    'snapshots',(SELECT count(*) FROM public.session_progress_content_evidence WHERE user_id=${quote(user)}),
    'markerCount',e.error_marker_count,'nonblank',e.has_nonblank,
    'cohortMatches',e.cohort_digest=public._ss_retention_content_cohort(s),
    'replacementMatches',e.replacement_session_id=${quote(replacement)}::uuid,
    'versionsMatch',e.format_version=1 AND e.formula_version='clarity_v1' AND e.marker_pattern_version='error_tags_v1',
    'numericUnchanged',s.total_words=100 AND s.duration=60 AND s.wpm=100 AND s.filler_counts='{"um":2}'::jsonb,
    'remainingContext',(SELECT count(*) FROM public.transcript_retention_replacement_context WHERE user_id=${quote(user)}),
    'remainingGrants',(SELECT count(*) FROM public.transcript_retention_expiry_grants g WHERE g.session_id IN (${quote(old)},${quote(replacement)})))
    FROM public.sessions s LEFT JOIN public.session_progress_content_evidence e ON e.session_id=s.id
    WHERE s.id=${quote(old)} AND s.user_id=${quote(user)};`;
}

class PsqlPeer {
  constructor(container, application, env, spawnPeer) {
    this.application = application;
    this.buffer = '';
    this.pending = null;
    this.closed = false;
    this.failed = false;
    this.child = spawnPeer('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolveExit => {
      this.child.on('error', () => { this.fail(); resolveExit(false); });
      this.child.on('close', (code, signal) => {
        this.closed = true;
        if (code !== 0 || signal) this.fail();
        if (this.pending) this.fail();
        resolveExit(code === 0 && !signal && !this.failed);
      });
    });
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 64 * 1024) return this.fail();
      for (let end; (end = this.buffer.indexOf('\n')) !== -1;) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (this.pending && line.startsWith(this.pending.tag)) {
          const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
          try { pending.resolve(JSON.parse(line.slice(pending.tag.length))); }
          catch { pending.reject(new Error('malformed native peer receipt')); }
        }
      }
    });
    // Never retain query text or a transcript in a receipt or exception.
    this.child.stderr.on('data', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
  }
  fail() {
    this.failed = true;
    if (this.pending) {
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
      pending.reject(new Error('native peer failed or refused; no model/customer content retained'));
    }
  }
  request(sql, expression) {
    assert.equal(this.failed || this.closed || Boolean(this.pending), false, 'native peer unavailable');
    const tag = `${randomBytes(12).toString('hex')}:`;
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => this.fail(), 20_000);
      this.pending = { tag, resolve: resolveReply, reject, timer };
      this.child.stdin.write(`${sql}\nSELECT ${quote(tag)} || (${expression})::text;\n`);
    });
  }
  async close() {
    // Disconnect rolls back an open transaction. ROLLBACK after a successful
    // COMMIT would emit a warning and falsely fail this content-free transport.
    if (!this.closed) this.child.stdin.end('\n\\q\n');
    let timer;
    try {
      return await Promise.race([this.exited, new Promise(resolveClose => {
        timer = setTimeout(() => resolveClose(false), 25_000);
      })]);
    } finally { clearTimeout(timer); }
  }
}

export function createEditedTakePeer(container, application, env, spawnPeer = spawn) {
  return new PsqlPeer(container, application, env, spawnPeer);
}

export async function runEditedTakeNative({ resourcesPath, receiptPath, root = process.cwd() }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'native proof requires the isolated CI runner');
  assert.equal(process.env.DOCKER_HOST, 'unix:///var/run/docker.sock', 'remote Docker refused');
  assert.equal(resolve(resourcesPath), resolve(root, 'artifacts/account-closure-full-chain/resources.json'));
  assert.equal(resolve(receiptPath), resolve(root, 'artifacts/account-closure-full-chain/retention-edited-take.json'));
  assert.equal(realpathSync(root), resolve(root), 'aliased checkout refused');
  const resources = JSON.parse(readFileSync(resourcesPath, 'utf8'));
  assert.match(resources.id, /^closure-proof-[a-f0-9]{16}$/);
  assert.equal(resources.networkName, `${resources.id}-internal`);
  assert.ok(resolve(resources.stage).startsWith(`${resolve(process.env.RUNNER_TEMP)}/closure-chain-`));
  const container = `supabase_db_${resources.id}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')
    && !key.startsWith('SUPABASE_') && !['DATABASE_URL', 'GH_TOKEN', 'GITHUB_TOKEN', 'DOCKER_CONTEXT',
      'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].includes(key)));
  const command = (bin, args, { input = '' } = {}) => new Promise((resolveCommand, reject) => {
    const child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
    let output = '', failed = false;
    const refuse = (code = null, signal = null) => {
      failed = true;
      const error = new Error('bounded owned-database command failed; native proof incomplete');
      error.operation = { binary: bin, exit: typeof code === 'number' ? code : null,
        signal: typeof signal === 'string' ? signal : null };
      reject(error);
    };
    child.on('error', refuse);
    child.stdin.on('error', refuse);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 2 * 1024 * 1024) refuse();
    });
    child.stderr.on('data', () => { /* No SQL/payload diagnostics in the content-free receipt. */ });
    child.on('close', (code, signal) => {
      if (code !== 0 || signal || failed) refuse(code, signal);
      else resolveCommand(output.trim());
    });
    child.stdin.end(input);
  });
  const image = JSON.parse(await command('docker', ['inspect', container]))[0];
  assert.equal(image.Name, `/${container}`);
  assert.deepEqual(Object.keys(image.NetworkSettings.Networks), [resources.networkName]);
  const network = JSON.parse(await command('docker', ['network', 'inspect', resources.networkName]))[0];
  assert.equal(network.Labels['speaksharp.closure-proof'], resources.id);
  assert.equal(network.EnableIPv6, false);
  const sql = text => command('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: `SET client_min_messages=error; SET statement_timeout='15s'; SET lock_timeout='8s';\n${text}` });
  const testedCommit = await command('git', ['rev-parse', 'HEAD']);
  assert.equal(await command('git', ['status', '--porcelain', '--untracked-files=no']), '', 'dirty tracked source refused');
  const sourceHash = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
  assert.equal(sourceHash(migration), migrationSha256, 'retention migration changed');
  const contract = t2ReleaseContract(root, await sql(t2ReleaseLedgerQuery()), { catalogContext: 'native-replay' });
  assert.equal(contract.profile, 'post-128', 'behavior proof requires the real chain immediately before129');
  const before = (await sql(t2ReleaseSnapshotQuery(contract))).split('\n');
  assertT2ReleaseSnapshot(contract, before);
  const receipt = { schemaVersion: 1, owner: resources.id, testedCommit, status: 'INCOMPLETE',
    bodyComplete: false, actorsClosed: false, activationRestored: false, cleanupVerified: false,
    scope: 'synthetic full-chain PG17 edited-take retention; not Production, PG15/16 or function-owner qualification',
    migrationSha256, moduleSha256: sourceHash('tests/db/retention-edited-take-full-chain.mjs'),
    catalogBefore: before, observed: null, phase: 'admitted-post128', startedUtc: new Date().toISOString() };
  const retain = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  retain();
  const user = randomUUID(), old = randomUUID(), key = randomUUID();
  const fixture = replacementTakeFixture();
  const prefix = `retention1610_${randomBytes(6).toString('hex')}`;
  const actors = [];
  let activated = false, failure, replacementResult, replacementError, settled = false, replacementPromise;
  const auth = `BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='8s';
    SET LOCAL request.jwt.claim.sub=${quote(user)}; SET LOCAL ROLE authenticated;`;
  const identity = `json_build_object('pid',pg_backend_pid(),'role',current_user,
    'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),'database',current_database(),
    'application',current_setting('application_name'))`;
  try {
    assert.equal(await sql('SELECT activated_at IS NULL FROM public.transcript_retention_activation WHERE singleton;'), 't',
      'proof refuses an already-active policy');
    receipt.phase = 'synthetic-fixture'; retain();
    await sql(`INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
      VALUES(${quote(user)},${quote(`retention-${key}@example.test`)},now(),'{}','{}');
      UPDATE public.user_profiles SET subscription_status='pro',stripe_subscription_id=${quote(`sub_${key}`)} WHERE id=${quote(user)};
      INSERT INTO public.sessions(id,user_id,status,created_at,transcript,total_words,duration,filler_counts,wpm,engine,engine_version,model_name,product)
      VALUES(${quote(old)},${quote(user)},'completed',now()-interval '1 hour','synthetic original',100,60,'{"um":2}',100,'private','v2','base','open_mic');`);
    const created = JSON.parse(await sql(`${auth}
      SELECT public.create_session_and_update_usage(${quote(JSON.stringify(fixture.createData))}::jsonb,
        'private',${quote(key)},'v2','base','desktop')::text; COMMIT;`));
    const admission = validateReplacementAdmission(created, { user, key, fixture });
    const replacement = admission.id;
    receipt.replacementAdmission = { billedDuration: admission.billedDuration,
      completionDuration: admission.completionDuration, ownerBound: true, recordingIdentityBound: true, saveOnly: true };
    retain();
    await sql('SELECT public.activate_transcript_retention_newest_one();'); activated = true;
    const refusal = JSON.parse(await sql(`DO $$ BEGIN
      BEGIN PERFORM public.expire_transcripts_newest_one(${quote(user)},500);
        RAISE EXCEPTION 'fixture expected a refusal';
      EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM <> 'retention_successful_replacement_required' THEN RAISE; END IF;
      END; END $$;
      SELECT json_build_object('originalPreserved',transcript='synthetic original',
        'snapshotAbsent',NOT EXISTS(SELECT 1 FROM public.session_progress_content_evidence WHERE session_id=${quote(old)}))
        FROM public.sessions WHERE id=${quote(old)};`));
    assert.deepEqual(refusal, { originalPreserved: true, snapshotAbsent: true });
    receipt.refusal = refusal; retain();
    receipt.phase = 'observed-edit-replacement-race'; retain();
    const editor = createEditedTakePeer(container, `${prefix}_editor`, env);
    const replacementPeer = createEditedTakePeer(container, `${prefix}_replacement`, env);
    actors.push(editor, replacementPeer);
    receipt.observed = await observeEditedTakeRace({
      edit: () => editor.request(`SET client_min_messages=error; SET application_name=${quote(editor.application)}; ${auth}
        UPDATE public.sessions SET transcript='synthetic edited [noise]' WHERE id=${quote(old)};`,
      `(${identity})::jsonb || jsonb_build_object('markerCount',(SELECT regexp_count(transcript,'\\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\\]',1,'i') FROM public.sessions WHERE id=${quote(old)}))`),
      startReplacement: async () => {
        const peer = await replacementPeer.request(`SET client_min_messages=error; SET application_name=${quote(replacementPeer.application)}; ${auth}`, identity);
        replacementPromise = replacementPeer.request('', `public.complete_session_v2(${quote(replacement)},'completed',${fixture.completionDuration},NULL,
          ${quote(nextAction)}::jsonb,120,NULL,100,'{"um":2}',NULL,'synthetic replacement')`)
          .then(value => { replacementResult = value; }, error => { replacementError = error; })
          .finally(() => { settled = true; });
        return peer;
      },
      replacementSettled: () => settled,
      observe: async pid => JSON.parse(await sql(`SELECT coalesce((SELECT json_build_object('pid',pid,
        'application',application_name,'waitType',wait_event_type,'state',state,'blockers',pg_blocking_pids(pid),
        'observedUtc',clock_timestamp())
        FROM pg_stat_activity WHERE pid=${pid} AND datname='postgres'),'null'::json);`)),
      now: () => Date.now(), pause: () => delay(50),
      commitEdit: () => editor.request('COMMIT;', 'json_build_object(\'committed\',true)'),
      finishReplacement: async () => {
        await replacementPromise;
        if (replacementError) throw replacementError;
        assert.equal(replacementResult?.success, true, 'replacement completion refused');
        await replacementPeer.request('COMMIT;', 'json_build_object(\'committed\',true)');
        return replacementResult;
      },
      inspect: async () => JSON.parse(await sql(retentionSnapshotSql({ user, old, replacement }))),
    });
    receipt.bodyComplete = true;
    receipt.phase = 'case-complete-awaiting-parent-teardown';
  } catch (error) {
    failure = error;
    receipt.failure = { name: error.name, message: String(error.message).split('\n')[0],
      operation: error.operation ?? null, phase: receipt.phase };
  } finally {
    receipt.actorsClosed = (await Promise.all(actors.map(actor => actor.close()))).every(Boolean);
    if (!receipt.actorsClosed) failure ??= new Error('native actor cleanup not verified');
    try {
      if (failure) {
        try {
          receipt.failureState = JSON.parse(await sql(`SELECT json_build_object('contentPresent',transcript IS NOT NULL,
            'state',transcript_state,'markerCount',regexp_count(coalesce(transcript,''),
            '\\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\\]',1,'i'),
            'snapshots',(SELECT count(*) FROM public.session_progress_content_evidence WHERE session_id=${quote(old)}))
            FROM public.sessions WHERE id=${quote(old)} AND user_id=${quote(user)};`));
        } catch { receipt.failureStateUnavailable = true; }
      }
      if (activated) await sql('UPDATE public.transcript_retention_activation SET activated_at=NULL WHERE singleton;');
      const after = (await sql(t2ReleaseSnapshotQuery(contract))).split('\n');
      assertT2ReleaseSnapshot(contract, after);
      assert.deepEqual(after, before, 'post128 authority/catalog was not restored');
      receipt.catalogAfter = after; receipt.activationRestored = true;
    } catch (error) { failure ??= error; }
    receipt.status = failure ? 'FAIL' : 'AWAITING_OWNED_TEARDOWN';
    receipt.finishedUtc = new Date().toISOString();
    retain();
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const base = resolve('artifacts/account-closure-full-chain');
  assert.equal(process.argv.length, 2, 'native proof accepts no alternate target or credential');
  await runEditedTakeNative({ resourcesPath: join(base, 'resources.json'), receiptPath: join(base, 'retention-edited-take.json') });
}
