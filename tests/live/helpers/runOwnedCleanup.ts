// Run-owned account cleanup for LIVE production proofs — extracted verbatim from the #1089 Private
// recording proof so every live proof shares ONE implementation.
//
// WHY EXTRACTED. This is the guarantee that a production proof leaves zero residue in a real customer
// database. Two copies of it would be two things to keep correct, and the second copy to drift would
// silently start orphaning real rows in production. A residue guarantee is exactly the kind of code
// that must not be duplicated.
//
// The ordering here is load-bearing and is preserved exactly:
//   1. Recover the UID if in-page capture missed it — never return silently after a signup that may
//      have created an account.
//   2. Cross-check UID -> email and refuse to delete anything that is not run-owned.
//   3. Clear every NON-CASCADING table BY user_id FIRST, while the column still holds it (see
//      PRE_DELETE_TABLES): a SET NULL FK survives `deleteUser()` as residue because the delete only
//      nulls the column.
//   4. Delete the auth user.
//   5. Prove deletion — ONLY an expected not-found re-fetch is proof. Any other error (network, auth,
//      rate limit) is NOT proof of deletion and must fail closed.
//   6. Assert ZERO rows across every run-owned cascade surface, then `trial_entitlements` by EMAIL
//      (keying on user_id there would read a false clean after step 4 nulled it).
//
// `user_issue_reports` is deliberately NOT deleted: its user_id FK is ON DELETE SET NULL BY DESIGN
// because the product intentionally retains "Report issue" feedback after account deletion. That is a
// feature, not residue, and scrubbing it would risk erasing real user feedback.
import { expect } from '@playwright/test';
import { isNotFoundError, pollForRecoveryUid } from './proofAuthority';

/** Minimal shape of the supabase-js admin client this cleanup needs. */
type AdminClient = {
    auth: {
        admin: {
            listUsers: (args: { page: number; perPage: number }) => Promise<{ data: { users?: Array<{ id?: string; email?: string | null }> } | null; error: { message: string } | null }>;
            getUserById: (uid: string) => Promise<{ data: { user?: { email?: string | null } | null } | null; error: ({ status?: number; code?: string; message: string }) | null }>;
            deleteUser: (uid: string) => Promise<{ error: { message: string } | null }>;
        };
    };
    from: (table: string) => {
        delete: () => { eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }> };
        select: (columns: string, options?: { count?: string; head?: boolean }) => { eq: (column: string, value: unknown) => Promise<{ count: number | null; error: { message: string } | null }> };
    };
};

/**
 * COMPLETE `auth.users` FK INVENTORY (derived from the migration history, not assumed).
 *
 * Every foreign key to `auth.users(id)` is ON DELETE CASCADE except two:
 *   - `trial_entitlements.user_id` — SET NULL. `deleteUser()` only nulls the column, so the row would
 *     survive as residue. It MUST be deleted by user_id first, while the column still holds it.
 *   - `user_issue_reports.user_id` — SET NULL BY DESIGN. The product intentionally RETAINS "Report
 *     issue" feedback after account deletion (row survives, unlinked). That is a feature, not residue;
 *     scrubbing it would risk erasing real user feedback. This proof files none anyway.
 *
 * `usage_checkpoints.user_id` deserves a note because it is the known trap: it was originally declared
 * `REFERENCES auth.users(id)` with NO on-delete clause — NO ACTION/RESTRICT — which once blocked a
 * delete and left a partially-removed account. Migration 20260625120000 changed it to CASCADE. It
 * therefore needs no pre-delete, but it IS residue-checked below so a regression that reverted that
 * migration would fail this proof rather than silently orphan rows again.
 */
const RESIDUE_CHECKS: ReadonlyArray<{ table: string; column: string }> = Object.freeze([
    { table: 'sessions', column: 'user_id' },
    { table: 'user_profiles', column: 'id' },                       // PK = auth user id
    { table: 'user_goals', column: 'user_id' },
    { table: 'custom_vocabulary', column: 'user_id' },
    { table: 'usage_checkpoints', column: 'user_id' },              // CASCADE since 20260625120000
    { table: 'active_recording_lease', column: 'user_id' },
    { table: 'session_attribution_authority', column: 'user_id' },
    { table: 'session_attribution_challenge', column: 'user_id' },
    { table: 'session_attribution_unattributed', column: 'user_id' },
    // Progress surfaces a completed session can produce.
    { table: 'session_progress_evaluations', column: 'user_id' },
    { table: 'progress_recommendations', column: 'user_id' },
    { table: 'progress_recommendation_attempts', column: 'user_id' },
]);

/**
 * Tables whose user_id FK is NOT `ON DELETE CASCADE` and must be cleared BEFORE the auth user is
 * deleted. `user_issue_reports` is deliberately excluded — see the inventory above.
 */
const PRE_DELETE_TABLES: ReadonlyArray<string> = Object.freeze(['trial_entitlements']);

export const RUN_OWNED_PREFIX_RE = /^(private-proof-|retention-proof-)/;

/**
 * Delete exactly the run-owned account and prove no residue remains. Fail-closed throughout.
 *
 * @returns the UID that was cleaned up, or '' when no signup had been attempted.
 */
export async function cleanupRunOwnedAccount(params: {
    admin: AdminClient | null;
    capturedUid: string;
    createdEmail: string;
    /** Email prefix this proof owns, e.g. 'retention-proof-'. Anything else is refused. */
    runOwnedPrefix: string;
}): Promise<string> {
    const { admin, createdEmail, runOwnedPrefix } = params;
    let capturedUid = params.capturedUid;

    if (!capturedUid && !createdEmail) return '';                  // no signup was attempted
    if (!admin) throw new Error('cleanup requires admin client (fail closed)');

    // Signup can create the user before the in-page UID capture times out. Recover by EXACT-email,
    // unique-result admin lookup so the account is never orphaned; pagination/errors fail closed.
    if (!capturedUid) {
        capturedUid = await pollForRecoveryUid({
            listAllUsers: async () => {
                const all: Array<{ id?: string; email?: string | null }> = [];
                for (let p = 1; p <= 50; p++) {
                    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
                    if (error) throw new Error(`cleanup recovery listUsers failed (fail closed): ${error.message}`);
                    const users = data?.users ?? [];
                    all.push(...users);
                    if (users.length < 200) break;                  // last page
                }
                return all;
            },
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            createdEmailLower: createdEmail.toLowerCase(),
            runOwnedPrefix,
            maxAttempts: 12,
            delayMs: 5000,
        });
    }

    const { data: got, error: getErr } = await admin.auth.admin.getUserById(capturedUid);
    if (getErr) throw new Error(`cleanup getUserById failed (fail closed): ${getErr.message}`);
    const foundEmail = got?.user?.email?.toLowerCase() ?? '';
    if (foundEmail !== createdEmail.toLowerCase()) throw new Error(`UID/email disagreement — refusing to delete (uid=${capturedUid})`);
    if (!foundEmail.startsWith(runOwnedPrefix)) throw new Error(`refusing to delete a non-run-owned account (${foundEmail})`);

    for (const table of PRE_DELETE_TABLES) {
        const { error: preErr } = await admin.from(table).delete().eq('user_id', capturedUid);
        if (preErr) throw new Error(`cleanup ${table} pre-delete failed (fail closed): ${preErr.message}`);
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(capturedUid);
    if (delErr) throw new Error(`cleanup deleteUser failed (fail closed): ${delErr.message}`);

    const { data: after, error: afterErr } = await admin.auth.admin.getUserById(capturedUid);
    if (afterErr) {
        if (!isNotFoundError(afterErr as { status?: number; code?: string; message?: string })) {
            throw new Error(`post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): ${afterErr.message}`);
        }
        // not-found → confirmed deleted
    } else {
        expect(after?.user ?? null, 'auth user must be gone after cleanup (returned a user)').toBeNull();
    }

    for (const { table, column } of RESIDUE_CHECKS) {
        const { count, error: rErr } = await admin
            .from(table).select(column, { count: 'exact', head: true }).eq(column, capturedUid);
        if (rErr) throw new Error(`cleanup residue query on ${table} failed (fail closed): ${rErr.message}`);
        expect(count ?? 0, `no run-owned residue in ${table}`).toBe(0);
    }

    const { count: teCount, error: teResErr } = await admin
        .from('trial_entitlements').select('email', { count: 'exact', head: true }).eq('email', createdEmail.toLowerCase());
    if (teResErr) throw new Error(`cleanup residue query on trial_entitlements failed (fail closed): ${teResErr.message}`);
    expect(teCount ?? 0, 'no run-owned residue in trial_entitlements').toBe(0);

    return capturedUid;
}
