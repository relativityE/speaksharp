// Controller/oracle controls only: these do not create or prove a native database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { observeEditedTakeRace, finalizeEditedTakeProof, createEditedTakePeer, retentionSnapshotSql } from './retention-edited-take-full-chain.mjs';

const finalState = () => ({ expired: true, plaintextAbsent: true, recoveryCopies: 0, snapshots: 1,
  markerCount: 1, nonblank: true, cohortMatches: true, replacementMatches: true,
  versionsMatch: true, numericUnchanged: true, remainingContext: 0, remainingGrants: 0 });
function rig() {
  const calls = [], editor = { pid: 101, role: 'authenticated', superuser: false,
    database: 'postgres', application: 'editor', markerCount: 1 };
  const replacement = { ...editor, pid: 202, application: 'replacement' };
  delete replacement.markerCount;
  let now = 0, committed = false;
  const io = {
    edit: async () => { calls.push('edit'); return editor; },
    startReplacement: async () => { calls.push('replacement'); return replacement; },
    replacementSettled: () => false,
    observe: async pid => { calls.push('observe'); return { pid, application: 'replacement', waitType: 'Lock',
      state: 'active', blockers: [101] }; },
    now: () => now, pause: async () => { now += 1_000; },
    commitEdit: async () => { committed = true; calls.push('commit'); },
    finishReplacement: async () => { assert.equal(committed, true); calls.push('save'); return { success: true }; },
    inspect: async () => { calls.push('inspect'); return finalState(); },
  };
  return { io, calls, editor, replacement };
}

test('commit is fenced by exact peer wait; edited numeric evidence and cleanup authority are separate', async () => {
  const { io, calls } = rig();
  const observed = await observeEditedTakeRace(io);
  assert.deepEqual(calls, ['edit', 'replacement', 'observe', 'commit', 'save', 'inspect']);
  assert.equal(observed.blocked.pid, 202);
  assert.equal(observed.after.markerCount, 1);
  assert.equal(Object.hasOwn(observed, 'status'), false, 'case completion is not teardown PASS');
});

for (const [name, mutation, expected] of [
  ['shared connection', r => { r.replacement.pid = 101; }, /share a database connection/],
  ['no edit', r => { r.editor.markerCount = 0; }, /distinguishable marker/],
  ['superuser editor', r => { r.editor.superuser = true; }, /privileged/],
  ['privileged replacement role', r => { r.replacement.role = 'postgres'; }, /authenticated writer/],
  ['missing backend', r => { r.replacement.pid = null; }, /PID absent/],
  ['wrong database', r => { r.editor.database = 'other'; }, /database differs/],
  ['premature save', r => { r.io.replacementSettled = () => true; }, /before editor commit/],
]) test(`refuses ${name} before commit`, async () => {
  const r = rig(); mutation(r);
  await assert.rejects(observeEditedTakeRace(r.io), expected);
  assert.ok(!r.calls.includes('commit'));
});

for (const [name, observation, expected] of [
  ['another waiter', { pid: 303, application: 'replacement', waitType: 'Lock', state: 'active', blockers: [101] }, /another backend/],
  ['another application', { pid: 202, application: 'unrelated', waitType: 'Lock', state: 'active', blockers: [101] }, /identity changed/],
  ['unrelated lock', { pid: 202, application: 'replacement', waitType: 'Lock', state: 'active', blockers: [999] }, /not observed/],
  ['idle peer', { pid: 202, application: 'replacement', waitType: 'Lock', state: 'idle', blockers: [101] }, /not observed/],
  ['no native wait', null, /not observed/],
]) test(`refuses ${name}; timeout never releases the editor as a substitute for evidence`, async () => {
  const r = rig(); r.io.observe = async () => observation;
  await assert.rejects(observeEditedTakeRace(r.io), expected);
  assert.ok(!r.calls.includes('commit'));
});

test('a disappearing waiter after observation cannot authorize commit', async () => {
  const r = rig(); let checks = 0;
  r.io.replacementSettled = () => ++checks > 1;
  await assert.rejects(observeEditedTakeRace(r.io), /before fenced editor commit/);
  assert.ok(!r.calls.includes('commit'));
});

for (const [field, value] of [
  ['expired', false], ['plaintextAbsent', false], ['recoveryCopies', 1], ['snapshots', 0],
  ['markerCount', 0], ['nonblank', false], ['cohortMatches', false], ['replacementMatches', false],
  ['versionsMatch', false], ['numericUnchanged', false], ['remainingContext', 1], ['remainingGrants', 1],
]) test(`post-save oracle rejects ${field}=${value}`, async () => {
  const r = rig(); r.io.inspect = async () => ({ ...finalState(), [field]: value });
  await assert.rejects(observeEditedTakeRace(r.io), /content-free evidence differs/);
});

test('a lawful replacement refusal is not successful expiry evidence', async () => {
  const r = rig(); r.io.finishReplacement = async () => ({ success: false, error: 'trial_expired' });
  await assert.rejects(observeEditedTakeRace(r.io), /actual replacement save refused/);
  assert.ok(!r.calls.includes('inspect'));
});

test('bounds cannot be widened by an unreviewed caller', async () => {
  for (const waitMs of [0, -1, 5_001, Infinity, NaN]) {
    await assert.rejects(observeEditedTakeRace(rig().io, { waitMs }), /unbounded/);
  }
});

const receipt = () => ({ schemaVersion: 1, owner: 'owned', testedCommit: 'source',
  status: 'AWAITING_OWNED_TEARDOWN', bodyComplete: true, actorsClosed: true, activationRestored: true });
const teardown = () => ({ owner: 'owned', testedCommit: 'source', cleanupVerified: true, parentPassed: true });
test('only successful whole-run teardown can finalize a completed native case', () => {
  const value = finalizeEditedTakeProof(receipt(), teardown());
  assert.equal(value.status, 'PASS'); assert.equal(value.cleanupVerified, true);
});
for (const [field, value] of [['bodyComplete', false], ['actorsClosed', false], ['activationRestored', false],
  ['status', 'INCOMPLETE'], ['status', 'FAIL'], ['status', 'PASS']]) {
  test(`teardown cannot promote ${field}=${value}`, () => {
    assert.equal(finalizeEditedTakeProof({ ...receipt(), [field]: value }, teardown()).status, 'FAIL');
  });
}
for (const field of ['cleanupVerified', 'parentPassed']) test(`${field} must be positively observed`, () => {
  for (const value of [false, undefined, 'true', 1]) {
    assert.equal(finalizeEditedTakeProof(receipt(), { ...teardown(), [field]: value }).status, 'FAIL');
  }
});
for (const field of ['owner', 'testedCommit']) test(`another ${field} cannot finalize the native receipt`, () => {
  assert.throws(() => finalizeEditedTakeProof(receipt(), { ...teardown(), [field]: 'different' }), /differs/);
});

function processDouble(reply = '{"observed":true}') {
  const child = new EventEmitter(), writes = [];
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(bytes, encoding, callback) {
    const sql = bytes.toString(); writes.push(sql);
    queueMicrotask(() => {
      const tag = /SELECT '([a-f0-9]+:)'/.exec(sql)?.[1];
      if (tag) {
        const line = `${tag}${reply}\n`;
        child.stdout.write('unrelated fixed command result\n'+line.slice(0, 9));
        child.stdout.write(line.slice(9));
      }
      if (sql.includes('\\q')) child.emit('close', 0, null);
    });
    callback();
  } });
  const spawnPeer = (binary, args, options) => {
    assert.equal(binary, 'docker');
    assert.deepEqual(args.slice(0, 4), ['exec', '-i', 'owned-container', 'psql']);
    assert.ok(args.includes('ON_ERROR_STOP=1'));
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    return child;
  };
  return { child, writes, peer: createEditedTakePeer('owned-container', 'fixture-peer', {}, spawnPeer) };
}

test('actual peer transport parses fragmented nonce replies and closes without a spurious rollback warning', async () => {
  const p = processDouble();
  assert.deepEqual(await p.peer.request('COMMIT;', "json_build_object('observed',true)"), { observed: true });
  assert.equal(await p.peer.close(), true);
  assert.equal(p.writes.at(-1), '\n\\q\n');
  assert.ok(!p.writes.at(-1).includes('ROLLBACK'));
});
test('malformed peer JSON is refused rather than converted into success', async () => {
  const p = processDouble('{broken');
  await assert.rejects(p.peer.request('', "'fixed'"), /malformed native peer receipt/);
  await p.peer.close();
});
test('process failure rejects a pending reply and prevents clean actor completion', async () => {
  const p = processDouble();
  const pending = p.peer.request('', "'fixed'");
  p.child.stderr.emit('data', Buffer.from('ERROR: synthetic fixed refusal'));
  await assert.rejects(pending, /native peer failed/);
  assert.equal(await p.peer.close(), false);
});
test('native transport forbids overlapping requests on the same peer', async () => {
  const p = processDouble();
  const pending = p.peer.request('', "'fixed'");
  assert.throws(() => p.peer.request('', "'other'"), /native peer unavailable/);
  await pending; await p.peer.close();
});

test('snapshot grant references exist in the actual historical table and128 additive migration', () => {
  // Schema wiring only, not execution of this query or a native database claim.
  const original = readFileSync(new URL('../../backend/supabase/migrations/20261013120000_retention_expiry_without_superuser_1258.sql', import.meta.url), 'utf8');
  const additive = readFileSync(new URL('../../backend/supabase/migrations/20261025021046_content_free_retention_evidence.sql', import.meta.url), 'utf8');
  const definition = /CREATE TABLE IF NOT EXISTS public\.transcript_retention_expiry_grants \(([\s\S]*?)\n\);/.exec(original)?.[1];
  assert.ok(definition, 'actual grant table declaration unavailable');
  const columns = new Set([...definition.matchAll(/^\s+(\w+)\s+(?:bigint|uuid)\b/gm)].map(match => match[1]));
  for (const match of additive.matchAll(/ALTER TABLE public\.transcript_retention_expiry_grants ADD COLUMN (\w+)\s+uuid/g)) columns.add(match[1]);
  const query = retentionSnapshotSql({ user: 'd1000000-0000-4000-8000-000000000001',
    old: 'd1000000-0000-4000-8000-000000000002', replacement: 'd1000000-0000-4000-8000-000000000003' });
  const references = [...query.matchAll(/\bg\.(\w+)\b/g)].map(match => match[1]);
  assert.ok(references.length > 0);
  for (const column of references) assert.ok(columns.has(column), `actual grant table has no ${column} column`);
});
