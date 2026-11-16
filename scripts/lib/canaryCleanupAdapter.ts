/**
 * #1826 (Sam's decision, option c): the canary's adapter over the SHARED run-owned cleanup (tests/live/helpers/runOwnedCleanup.ts),
 * which it calls but never modifies.
 *
 * The #1643 deletion guard (`account_save_delete_guard`) refuses to delete an account while any save obligation is unsettled. The
 * canary has no proof that an interrupted take stopped writing (the RWT harness's `StoppedTakeProof` is not available to it), and
 * a lease-only obligation cannot be settled by any status write. So an interrupted or uncertain canary account is NOT cleaned up:
 *  1. a read-only look at the account's takes FIRST. Any unsettleable take, lease-only obligation or open (not stopped) take
 *     throws `unsettled_take` before anything is written: no trial-entitlements pre-delete, no deletion attempt, the account and
 *     its save debt preserved for an authorized recovery;
 *  2. only an account whose visible takes are all settled goes through the shared cleanup. If the guard still refuses (an
 *     obligation the read cannot see, e.g. a released lease, or a save admitted after the read), the refusal is reported as
 *     `unsettled_take` (named by the shared cleanup) or `delete_refused` (the guard's generic error), never as success.
 * Nothing here infers cancellation from age or a completed workflow, closes a take, or relabels `canary_run` as `ct_run`.
 */
import { cleanupFailureStep, cleanupRunOwnedAccount, settleRunOwnedTakes } from '../../tests/live/helpers/runOwnedCleanup';
import { RUN_OWNED_PREFIX } from './canaryRunOwnedSweep.mjs';

export type CanaryCleanupCode = 'unsettled_take' | 'delete_refused' | 'take_read_failed' | 'cleanup_unproven';
export class CanaryCleanupError extends Error {
    constructor(readonly canaryCode: CanaryCleanupCode, readonly takes: { unsettleable: number; leaseOnly: number; notStopped: number } | null = null) {
        super(`canary cleanup: ${canaryCode}`);
        this.name = 'CanaryCleanupError';
    }
}

/** The shared cleanup for ONE canary account, behind the read-only settlement check. `admin` is the binding-guarded client. */
export async function canaryCleanup({ admin, uid, email }: { admin: unknown; uid: string; email: string }): Promise<void> {
    const takes = await settleRunOwnedTakes(admin as never, uid).catch(() => null);
    if (!takes) throw new CanaryCleanupError('take_read_failed');
    const counts = { unsettleable: takes.unsettleable, leaseOnly: takes.leaseOnly, notStopped: takes.notStopped };
    if (counts.unsettleable > 0 || counts.leaseOnly > 0 || counts.notStopped > 0) throw new CanaryCleanupError('unsettled_take', counts);
    try {
        await cleanupRunOwnedAccount({ admin: admin as never, capturedUid: uid, createdEmail: email, runOwnedPrefix: RUN_OWNED_PREFIX });
    } catch (error) {
        const step = cleanupFailureStep(error);
        if (step === 'delete_user_unsettled_take') throw new CanaryCleanupError('unsettled_take', counts);
        if (step === 'delete_user') throw new CanaryCleanupError('delete_refused', counts);
        throw new CanaryCleanupError('cleanup_unproven', counts);
    }
}
