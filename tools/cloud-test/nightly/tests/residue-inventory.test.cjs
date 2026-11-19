'use strict';
// #1884 (Sam, 17 Nov): the J4.a cleanup's inventory and settlement rule are the SHARED ones (tests/live/helpers/runOwnedCleanup.ts), with
// drift checks: the inventory is parsed from that helper and fails loudly when its shape or count moves; the CJS settlement rule is the
// helper's own classifyTakes/leaseOnlyTakes, compiled from its TypeScript source and compared on every combination of row facts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { HELPER, j4aRequiredStores, sharedResidueChecks } = require('../residue-inventory.cjs');
const { classifyTakes, leaseOnlyTakes } = require('../j4a-parent-teardown.cjs');
const { SOURCE_COUNTS } = require('../cleanup-plan.cjs');

const source = fs.readFileSync(HELPER, 'utf8');

test('the required stores are the shared helper\'s residue checks, plus trial_entitlements by email, save obligations and the account, each with its own identity', () => {
    const stores = j4aRequiredStores();
    assert.equal(sharedResidueChecks().length, SOURCE_COUNTS.residueChecks);
    assert.equal(stores.length, SOURCE_COUNTS.residueChecks + 3);
    assert.equal(new Set(stores.map((s) => s.id)).size, stores.length);
    assert.deepEqual(stores.filter((s) => s.key === 'email').map((s) => s.id), ['trial_entitlements:email']);
    for (const id of ['auth:account', 'sessions:user_id', 'active_recording_lease:user_id', 'user_profiles:id', 'usage_checkpoints:user_id', 'account_save_obligations:user_id'])
        assert.ok(stores.some((s) => s.id === id), id);
});

test('DRIFT: an inventory with one shared check removed, or a reshaped entry, refuses to load (never a silent shorter list)', () => {
    const removed = source.replace(/\n\s*\{ table: 'user_goals', column: 'user_id' \},[^\n]*/, '');
    assert.notEqual(removed, source);
    assert.throws(() => sharedResidueChecks(removed), /drift/);
    const reshaped = source.replace("{ table: 'user_goals', column: 'user_id' }", "{ table: 'user_goals', col: 'user_id' }");
    assert.throws(() => sharedResidueChecks(reshaped), /drift/);
    assert.throws(() => j4aRequiredStores(removed), /drift/);
});

/** The helper's own TypeScript functions, compiled and evaluated in isolation. */
function helperFunctions() {
    const ts = require('typescript');
    const grab = (name) => {
        const start = source.indexOf(`export function ${name}(`);
        const end = source.indexOf('\n}\n', start);
        assert.ok(start >= 0 && end > start, name);
        return source.slice(start, end + 2).replace('export function', 'function');
    };
    const code = ts.transpileModule(`${grab('classifyTakes')}\n${grab('leaseOnlyTakes')}\nmodule.exports = { classifyTakes, leaseOnlyTakes };`,
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(code, sandbox);
    return sandbox.module.exports;
}

test('DRIFT: classifyTakes and leaseOnlyTakes equal the shared helper\'s on every combination of status, lease and fence', () => {
    const ref = helperFunctions();
    const rows = [];
    for (const status of ['active', 'completed', 'failed', 'pending', 'discarded'])
        for (const lease_id of [null, 'lease-a'])
            for (const recording_fenced_at of [null, '2026-11-17T12:00:00Z']) rows.push({ id: `${status}-${lease_id}-${recording_fenced_at}`, status, lease_id, recording_fenced_at });
    for (const r of rows) {
        // The reference runs in another VM realm; JSON normalizes prototypes without weakening the comparison.
        const mine = classifyTakes([r]); const theirs = JSON.parse(JSON.stringify(ref.classifyTakes([r])));
        assert.deepEqual({ ...mine, closable: mine.closable.map((x) => x.id) }, { ...theirs, closable: theirs.closable.map((x) => x.id) }, r.id);
    }
    const mine = classifyTakes(rows); const theirs = JSON.parse(JSON.stringify(ref.classifyTakes(rows)));
    assert.deepEqual([mine.settled, mine.unsettleable, mine.closable.length], [theirs.settled, theirs.unsettleable, theirs.closable.length]);
    for (const leases of [[], ['lease-a'], ['lease-b'], ['lease-a', 'lease-b', null]])
        assert.equal(leaseOnlyTakes(leases, rows), ref.leaseOnlyTakes(leases, rows), JSON.stringify(leases));
});
