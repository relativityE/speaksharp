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

/**
 * The commercial-activation migration. The name is kept because it is exported and referenced, but the
 * rule it once carried is gone: since 2026-09-12 this migration is RECORDED applied and was never
 * executed (#1282), so "held" no longer describes the expected state. See `activationRecorded` below —
 * the readiness result reports whether it is recorded, and draws no conclusion about whether it ran.
 */
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

    /*
     * Every staged prerequisite is applied.
     *
     * THE ACTIVATION MIGRATION IS NOW EXPECTED TO READ AS APPLIED, AND THAT IS NOT AN ACTIVATED
     * ENVIRONMENT. This rule used to fail closed on `20260812042000` appearing applied, on the assumption
     * that "applied" could only mean the commercial activation had run.
     *
     * On 2026-09-12 that stopped being true. The migration sorts before the remote head, so it blocked
     * every ordinary `supabase db push` as out-of-order; it was recorded applied WITHOUT being executed
     * (`migration repair … --status applied`, deploy run `34691493637` — the dry-run listed only the three
     * release migrations) so the retention migration could land. PO determined the activation is
     * intentionally skipped rather than deferred: there are no existing unpaid accounts, so it would stamp
     * nothing, and new users get their trial dates through the normal signup path. Recorded on #1282.
     *
     * The migration history cannot distinguish "recorded applied" from "actually ran", so the old rule
     * became permanently unsatisfiable — it failed the canary closed forever, on a state that is now the
     * intended one. `activationRecorded` reports the fact without inventing a meaning for it: the honest
     * statement is "this migration is recorded applied", not "the environment is activated".
     */
    const activationRow = byVersion.get(HELD_ACTIVATION_MIGRATION);
    const activationRecorded = Boolean(activationRow && activationRow.remote === HELD_ACTIVATION_MIGRATION);

    return {
        ready: true,
        state: 'applied',
        version: CANARY_RUNTIME_MIGRATION,
        appliedSet: [...REQUIRED_APPLIED_MIGRATIONS],
        // Kept for readers of older evidence: it meant "42000 is not applied", which is no longer the
        // expected state. `activationRecorded` is the field that now carries the fact.
        activationHeld: !activationRecorded,
        activationRecorded,
        heldActivation: HELD_ACTIVATION_MIGRATION,
    };
}
