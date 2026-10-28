// Default invocation is offline. Native execution is opt-in inside its isolated CI job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { EventEmitter } from 'node:events';
import { assertRetentionOwners, cleanupOwnedRetentionFixture, observeRetentionOwnerRace,
  ownedRetentionProcessIds, createRetentionLocalPeer, nativeFixture, REQUIRED_RETENTION_FUNCTIONS,
  startOwnedRetentionFixture } from './content-free-retention-evidence.realpg.mjs';

const owners = () => REQUIRED_RETENTION_FUNCTIONS.map(row => ({ ...row, present: true, owner: 'closure_owner', superuser: false }));
test('actual owner guard accepts explicit NOSUPERUSER catalog and rejects privilege/identity loss', () => {
  assert.equal(assertRetentionOwners(owners()).length, 14);
  for (const mutate of [rows => { rows[0].superuser = true; }, rows => { rows[0].owner = 'postgres'; },
    rows => { delete rows[0].superuser; }, rows => { rows[1].securityDefiner = false; }, rows => { rows.shift(); }]) {
    const rows = owners(); mutate(rows); assert.throws(() => assertRetentionOwners(rows));
  }
  assert.throws(() => assertRetentionOwners([]));
});
for (const required of REQUIRED_RETENTION_FUNCTIONS) {
  test(`catalog refuses absent required signature ${required.identity}`, () => {
    assert.throws(() => assertRetentionOwners(owners().filter(row => row.identity !== required.identity)));
  });
  test(`catalog refuses execution-mode drift for ${required.identity}`, () => {
    const rows = owners(); rows.find(row => row.identity === required.identity).securityDefiner = !required.securityDefiner;
    assert.throws(() => assertRetentionOwners(rows));
  });
}

test('timed-out startup still stops and verifies its postmaster before deleting owned data', () => {
  let stopped = false, removed = false;
  const io = { ownershipKnown: () => true, observe: () => ({ dataPresent: !removed, processes: stopped ? [] : [412],
    socketPresent: !stopped, pidFilePresent: !stopped }), stop: () => { stopped = true; },
  removeData: () => { assert.equal(stopped, true); removed = true; } };
  assert.equal(cleanupOwnedRetentionFixture(io).cleanupVerified, true);
  assert.equal(removed, true);
});
for (const leftover of ['processes', 'socketPresent', 'pidFilePresent', 'dataPresent']) {
  test(`cleanup refuses leftover ${leftover} and cannot forge a successful receipt`, () => {
    let removed = false;
    const state = { dataPresent: true, processes: [], socketPresent: false, pidFilePresent: false };
    state[leftover] = leftover === 'processes' ? [412] : true;
    const io = { ownershipKnown: () => true, observe: () => ({ ...state, dataPresent: leftover === 'dataPresent' || !removed }),
      stop: () => {}, removeData: () => { removed = true; } };
    assert.throws(() => cleanupOwnedRetentionFixture(io));
    if (leftover !== 'dataPresent') assert.equal(removed, false);
  });
}
test('unknown startup ownership refuses cleanup PASS and preserves owned data', () => {
  let present = true;
  const io = { ownershipKnown: () => false, observe: () => ({ dataPresent: present, processes: [], socketPresent: false, pidFilePresent: false }),
    stop: () => { throw Error('server never started'); }, removeData: () => { present = false; } };
  assert.throws(() => cleanupOwnedRetentionFixture(io), /ownership unknown/);
  assert.equal(present, true);
});
test('cleanup refuses a process appearing after data removal and preserves observation errors', () => {
  let removed = false;
  assert.throws(() => cleanupOwnedRetentionFixture({
    ownershipKnown: () => true,
    observe: () => ({ dataPresent: !removed, processes: removed ? [500] : [], socketPresent: false, pidFilePresent: false }),
    stop: () => {}, removeData: () => { removed = true; },
  }), /reappeared/);
  assert.throws(() => cleanupOwnedRetentionFixture({ ownershipKnown: () => true, observe: () => { throw Error('identity unreadable'); } }), /identity unreadable/);
});
test('startup seeds real observation before postmaster/pidfile disappear ahead of first teardown', () => {
  const scope = { bin: '/owned/bin', data: '/owned/data', postmasterPid: 10, seen: new Set() };
  let rows = [], known = false, removed = false, pidFilePresent = true;
  const observe = () => ({ dataPresent: !removed, pidFilePresent, postmasterPid: scope.postmasterPid,
    socketPresent: false, processes: ownedRetentionProcessIds(rows, scope) });
  startOwnedRetentionFixture({ start: () => {
    rows = [{ pid: 10, parent: 1, command: '/owned/bin/postgres -D /owned/data' },
      { pid: 11, parent: 10, command: 'postgres child' }];
  }, observe, record: (_, value) => { known = value; } });
  assert.equal(known, true);
  rows = [{ pid: 11, parent: 1, command: 'postgres orphan' }]; pidFilePresent = false;
  assert.throws(() => cleanupOwnedRetentionFixture({ ownershipKnown: () => known, observe, stop: () => {},
    removeData: () => { removed = true; } }), /processes remain/);
  assert.equal(removed, false);
});
test('failed startup still records known children and preserves primary error when observation fails', () => {
  const primary = Error('start failed'); let recorded = false;
  assert.throws(() => startOwnedRetentionFixture({ start: () => { throw primary; },
    observe: () => ({ postmasterPid: 10, processes: [10, 11] }), record: (_, known) => { recorded = known; } }),
  error => error === primary);
  assert.equal(recorded, true);
  assert.throws(() => startOwnedRetentionFixture({ start: () => { throw primary; },
    observe: () => { throw Error('ownership unreadable'); }, record: () => {} }), error => error === primary);
  assert.throws(() => startOwnedRetentionFixture({ start: () => {},
    observe: () => ({ postmasterPid: null, processes: [] }), record: (_, known) => { assert.equal(known, false); } }), /not observed/);
});
test('late-born orphan after root loss cannot disappear behind empty owned snapshots and failed stop', () => {
  const scope = { bin: '/owned/bin', data: '/owned/data', postmasterPid: 10, seen: new Set([10, 11]) };
  let removed = false;
  const stopFailure = Error('postmaster vanished before confirmed shutdown');
  const observe = () => ({ dataPresent: !removed, pidFilePresent: false, socketPresent: false,
    processes: ownedRetentionProcessIds([{ pid: 12, parent: 1, command: 'postgres orphan' }], scope) });
  // PID12 was born during the body and reparented before the first teardown sample.
  assert.deepEqual(observe().processes, []);
  assert.throws(() => cleanupOwnedRetentionFixture({ ownershipKnown: () => true, observe,
    stop: () => { throw stopFailure; }, removeData: () => { removed = true; } }), error => error === stopFailure);
  assert.equal(removed, false);
});
test('missing owned data before shutdown is unknown, not independently verified cleanup', () => {
  assert.throws(() => cleanupOwnedRetentionFixture({ ownershipKnown: () => true,
    observe: () => ({ dataPresent: false, processes: [], pidFilePresent: false, socketPresent: false }),
    stop: () => {}, removeData: () => {} }));
});
test('actual process ownership follows children after reparenting and excludes adjacent data roots', () => {
  const scope = { bin: '/owned/bin', data: '/owned/fixture/data', postmasterPid: 10, seen: new Set() };
  assert.deepEqual(ownedRetentionProcessIds([
    { pid: 10, parent: 1, command: '/owned/bin/postgres -D /owned/fixture/data -p 55477' },
    { pid: 11, parent: 10, command: 'postgres: checkpointer' },
    { pid: 12, parent: 11, command: 'postgres child' },
    { pid: 99, parent: 1, command: '/owned/bin/postgres -D /owned/fixture/data-other' },
  ], scope), [10, 11, 12]);
  assert.deepEqual(ownedRetentionProcessIds([{ pid: 12, parent: 1, command: 'postgres orphan' }], scope), [12]);
});

function fakePeer(reply) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.write = text => queueMicrotask(() => reply(child, text));
  child.stdin.end = () => queueMicrotask(() => child.emit('close', 0, null));
  let args;
  const peer = createRetentionLocalPeer('/owned/bin', '/owned/socket', { PATH: '/owned/bin:/usr/bin:/bin', LC_ALL: 'C', TMPDIR: '/owned' },
    'owned_test', (bin, argv, options) => { args = { bin, argv, options }; return child; });
  return { peer, child, args };
}
test('actual local peer uses the owned Unix socket and consumes a tagged JSON reply', async () => {
  const { peer, args } = fakePeer((child, text) => {
    const tag = text.match(/SELECT '([a-f0-9]+:)'/)[1];
    child.stdout.emit('data', `uncredited SQL output\n${tag}{"ok":true}\n`);
  });
  assert.equal(args.bin, '/owned/bin/psql');
  assert.deepEqual(args.argv.slice(0, 4), ['-h', '/owned/socket', '-p', '55477']);
  assert.deepEqual(Object.keys(args.options.env).sort(), ['LC_ALL', 'PATH', 'TMPDIR']);
  assert.deepEqual(await peer.request('SELECT 1;', 'json_build_object(\'ok\',true)'), { ok: true });
  assert.equal(await peer.close(), true);
});
for (const kind of ['malformed', 'stderr', 'oversized', 'stdin-error']) {
  test(`actual local peer refuses ${kind} without retaining SQL/error payload`, async () => {
    const { peer } = fakePeer((child, text) => {
      if (kind === 'malformed') child.stdout.emit('data', text.match(/SELECT '([a-f0-9]+:)'/)[1] + 'not JSON\n');
      if (kind === 'stderr') child.stderr.emit('data', 'synthetic SQL details');
      if (kind === 'oversized') child.stdout.emit('data', 'x'.repeat(65_537));
      if (kind === 'stdin-error') child.stdin.emit('error', Error('synthetic pipe detail'));
    });
    await assert.rejects(peer.request('synthetic SQL', '{}'), /owned native peer failed|malformed owned peer response/);
    assert.equal(await peer.close(), false);
  });
}

const expected = () => ({ expired: true, plaintextAbsent: true, recoveryCopies: 0, snapshots: 1,
  markerCount: 1, nonblank: true, cohortMatches: true, replacementMatches: true,
  versionsMatch: true, numericUnchanged: true, remainingContext: 0, remainingGrants: 0 });
function race(overrides = {}) {
  let committed = false, clock = 0;
  return { edit: async () => ({ pid: 101, role: 'closure_owner', superuser: false, markerCount: 1 }),
    startReplacement: async () => ({ pid: 102, role: 'closure_owner', superuser: false, application: 'owned_replacement' }),
    replacementSettled: () => false, now: () => clock++, pause: async () => { clock += 1_000; },
    observe: async pid => ({ pid, application: 'owned_replacement', waitType: 'Lock', state: 'active', blockers: [101] }),
    commitEdit: async () => { committed = true; }, finishReplacement: async () => { assert.equal(committed, true); return { success: true }; },
    inspect: async () => expected(), ...overrides };
}
test('race requires actual editor blocking before commit and exact content-free postimage', async () => {
  assert.equal((await observeRetentionOwnerRace(race())).after.markerCount, 1);
});
for (const [name, override] of Object.entries({
  'privileged owner': { edit: async () => ({ pid: 101, role: 'closure_owner', superuser: true, markerCount: 1 }) },
  'early replacement': { replacementSettled: () => true },
  'missing marker': { edit: async () => ({ pid: 101, role: 'closure_owner', superuser: false, markerCount: 0 }) },
  'unrelated blocker': { observe: async pid => ({ pid, application: 'owned_replacement', waitType: 'Lock', state: 'active', blockers: [999] }) },
  'missing snapshot marker': { inspect: async () => ({ ...expected(), markerCount: 0 }) },
  'missing snapshot': { inspect: async () => ({ ...expected(), snapshots: 0 }) },
  'residual context': { inspect: async () => ({ ...expected(), remainingContext: 1 }) },
  'residual grant': { inspect: async () => ({ ...expected(), remainingGrants: 1 }) },
  'completion refused': { finishReplacement: async () => ({ success: false }) },
})) test(`actual race guard refuses ${name}`, async () => { await assert.rejects(observeRetentionOwnerRace(race(override))); });

if (process.env.RETENTION_MATRIX_NATIVE === '1') {
  // Advisory test deadline: synchronous child calls cannot be preempted by node:test.
  // The runner's 35-minute job cap is the hard external boundary; forced termination
  // cannot produce PASS without the owned teardown receipt.
  test('isolated source-pinned native owner/current-contract qualification', { timeout: 300_000 }, async t => {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'native run requires explicit isolated CI selection');
    const pins = JSON.parse(readFileSync('tests/db/retention-owner-matrix-pins.json'));
    const pin = pins.versions.find(p => p.major === Number(process.env.RETENTION_MATRIX_MAJOR));
    assert.ok(pin, 'matrix major not pinned');
    assert.equal(process.env.RETENTION_MATRIX_VERSION, pin.version);
    const root = resolve(process.env.RETENTION_BUILD_ROOT ?? '');
    assert.ok(root.startsWith(resolve(process.env.RUNNER_TEMP) + '/retention-pg-build-'), 'unowned build path refused');
    const bin = join(root, 'install/bin');
    assert.equal(process.env.RETENTION_MATRIX_BIN, bin, 'alternate binary refused');
    assert.equal(existsSync(join(bin, 'postgres')), true);
    await nativeFixture(t, { bin, expectedVersion: pin.version, ownerMatrix: true,
      receiptPath: resolve(`artifacts/retention-owner-matrix/pg${pin.major}.json`) });
  });
}
