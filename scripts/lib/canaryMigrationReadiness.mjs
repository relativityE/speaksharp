import { parseMigrationList, EXACT_MIGRATION_ALLOWLIST } from './exactMigrationGate.mjs';

// The final staged runtime-convergence migration. Readiness is not "is 41500 applied?" — it is "is the
// COMPLETE ordered staged set applied?", because 41500 depends on every predecessor below it.
export const CANARY_RUNTIME_MIGRATION = '20260812041500';

// The webhook lifecycle prerequisite already applied to production ahead of the staged set.
const APPLIED_WEBHOOK_PREREQUISITE = '20260812002000';

/**
 * The complete ordered set that MUST be applied before either canary product lane runs:
 *   20260812002000 (already-applied webhook prerequisite)
 *   → 20260811143000 → 20260812030000 → 20260812039500 → 20260812040000 → 20260812041000 → 20260812041500
 * Any missing predecessor is an explicit HOLD with zero product qualification — never a silent pass on 41500.
 */
export const REQUIRED_APPLIED_MIGRATIONS = Object.freeze([
    APPLIED_WEBHOOK_PREREQUISITE,
    ...EXACT_MIGRATION_ALLOWLIST.filter((m) => m.classification === 'staged').map((m) => m.version),
]);

/** Commercial activation stays HELD — it must NOT be applied for the canary product lanes. */
export const HELD_ACTIVATION_MIGRATION =
    EXACT_MIGRATION_ALLOWLIST.find((m) => m.classification === 'commercial-activation').version;

/**
 * Evaluate whether the deployed production database is ready for the canary product lanes by verifying the
 * COMPLETE ordered staged migration set is applied against the checked-in exact history — not merely the
 * presence of the final `41500` runtime migration.
 *
 * - a required migration missing from checked-in SOURCE (remote-only) → hard error (the gate is broken);
 * - any required migration APPLIED locally but not remotely (pending) → { ready:false, state:'pending' } HOLD;
 * - all required migrations applied → { ready:true, state:'applied' }, reporting whether the held commercial
 *   activation (`20260812042000`) remains unapplied.
 */
export function evaluateCanaryMigrationReadiness(output) {
    const rows = parseMigrationList(output);
    const byVersion = new Map();
    for (const row of rows) {
        const version = row.local ?? row.remote;
        if (!version) continue;
        if (row.local && row.remote && row.local !== row.remote) {
            throw new Error(`migration history has a mismatched local/remote row near ${version}`);
        }
        if (byVersion.has(version)) throw new Error(`migration list contains duplicate version ${version}`);
        byVersion.set(version, row);
    }

    const missingFromSource = [];
    const pending = [];
    for (const version of REQUIRED_APPLIED_MIGRATIONS) {
        const row = byVersion.get(version);
        if (!row || row.local !== version) { missingFromSource.push(version); continue; } // absent or remote-only
        if (row.remote !== version) pending.push(version);                                  // local-only: not applied
    }

    // A checked-in source gap means the gate itself cannot be trusted — fail hard, never a silent HOLD.
    if (missingFromSource.length > 0) {
        throw new Error(`required migration(s) missing from checked-in source: ${missingFromSource.join(', ')}`);
    }

    // Any missing predecessor → explicit HOLD; the product lanes must not run and claim no product evidence.
    if (pending.length > 0) {
        return {
            ready: false,
            state: 'pending',
            version: CANARY_RUNTIME_MIGRATION,
            pending,
            required: [...REQUIRED_APPLIED_MIGRATIONS],
        };
    }

    // Every staged prerequisite is applied. The commercial activation migration must remain held.
    const activationRow = byVersion.get(HELD_ACTIVATION_MIGRATION);
    const activationApplied = Boolean(activationRow && activationRow.remote === HELD_ACTIVATION_MIGRATION);

    return {
        ready: true,
        state: 'applied',
        version: CANARY_RUNTIME_MIGRATION,
        appliedSet: [...REQUIRED_APPLIED_MIGRATIONS],
        activationHeld: !activationApplied,
    };
}
