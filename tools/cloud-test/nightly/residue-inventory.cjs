"use strict";
// #1884 (Sam, 17 Nov): the J4.a cleanup's residue inventory is the SHARED one, never a second list. It is read from the established
// run-owned cleanup helper (tests/live/helpers/runOwnedCleanup.ts: RESIDUE_CHECKS by owner id, PRE_DELETE_TABLES), the same source
// cleanup-plan.cjs counts (SOURCE_COUNTS, drift-tested), plus the stores that helper checks or guards outside that array:
// trial_entitlements by the reserved EMAIL (user_id is nulled by the delete), and account_save_obligations (the unsettled-save guard
// on auth.users refuses the delete while one is open). Every required store has its own identity `<table>:<column>`, bound to the
// confirmed owner id or the reserved email, so one generic zero can never satisfy a store that was not read.
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE_COUNTS } = require('./cleanup-plan.cjs');

const HELPER = path.join(__dirname, '..', '..', '..', 'tests', 'live', 'helpers', 'runOwnedCleanup.ts');
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** The owner-scoped residue checks of the shared helper, parsed from its source; throws on drift (count or shape). */
function sharedResidueChecks(source = fs.readFileSync(HELPER, 'utf8')) {
    const start = source.indexOf('export const RESIDUE_CHECKS');
    const end = source.indexOf(']);', start);
    if (start < 0 || end < 0) throw new Error('residue inventory: RESIDUE_CHECKS not found in the shared cleanup helper');
    const body = source.slice(start, end);
    const checks = [...body.matchAll(/\{ table: '([a-z0-9_]+)', column: '([a-z0-9_]+)' \}/g)].map((m) => Object.freeze({ table: m[1], column: m[2] }));
    if (checks.length !== SOURCE_COUNTS.residueChecks || (body.match(/\{ table: '/g) ?? []).length !== checks.length)
        throw new Error(`residue inventory drift: the shared helper has ${checks.length} parsed checks, cleanup-plan counts ${SOURCE_COUNTS.residueChecks}`);
    if (!checks.every((c) => NAME.test(c.table) && NAME.test(c.column))) throw new Error('residue inventory: malformed table or column');
    return Object.freeze(checks);
}

/** The stores checked outside RESIDUE_CHECKS: explicit, reviewed, each with its own key. */
const EXTRA_STORES = Object.freeze([
    Object.freeze({ table: 'trial_entitlements', column: 'email', key: 'email' }),
    Object.freeze({ table: 'account_save_obligations', column: 'user_id', key: 'owner' }),
]);

/**
 * Every store the J4.a teardown must read after the delete, each `{ id, table, column, key }`: `key` 'owner' scopes by the confirmed
 * owner id, 'email' by the reserved email. Plus `auth:account` (the account itself, read by id). Order is fixed; ids are unique.
 */
function j4aRequiredStores(source) {
    const stores = [
        Object.freeze({ id: 'auth:account', table: null, column: null, key: 'owner' }),
        ...sharedResidueChecks(source).map((c) => Object.freeze({ id: `${c.table}:${c.column}`, table: c.table, column: c.column, key: 'owner' })),
        ...EXTRA_STORES.map((s) => Object.freeze({ id: `${s.table}:${s.column}`, ...s })),
    ];
    if (new Set(stores.map((s) => s.id)).size !== stores.length) throw new Error('residue inventory: duplicate store identity');
    return Object.freeze(stores);
}

module.exports = { EXTRA_STORES, HELPER, j4aRequiredStores, sharedResidueChecks };
