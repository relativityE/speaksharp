// #1337 — pure entitlement decision for the three-session production proof, extracted so every
// rejection path has a unit-level falsification test independent of the live run (the same reason
// proofAuthority.ts exists).
//
// The decision answers one question: may this run-owned account complete ALL THREE bounded
// recordings? `can_start` cannot answer it — that is a per-start verdict and would happily allow
// recording 1 on an account that cannot finish, leaving a partial journey written to production.

/** The fields this decision reads from the `check-usage-limit` Edge response. */
export type UsageAuthority = {
    can_start?: unknown;
    is_pro?: unknown;
    trial_active?: unknown;
    trial_seconds_remaining?: unknown;
};

export type EntitlementVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether the account can support the whole journey.
 *
 * TRIAL HEADROOM FAILS CLOSED. A trial is a FINITE budget, so an active trial that does not report a
 * usable number cannot be assumed to have room — an absent or non-numeric field is precisely when the
 * assumption is least safe. Treating "no number" as "no limit" is the fail-open this replaces.
 *
 * EFFECTIVE PRO IS DIFFERENT IN KIND: an entitlement with no finite second budget. There is nothing to
 * compare, and demanding a number would reject a perfectly valid account.
 *
 * `trial_active` is evaluated FIRST because a trial can also resolve to effective Pro; while the trial
 * is live, the trial's budget is the one that governs.
 */
export function evaluateThreeRecordingEntitlement(
    usage: UsageAuthority,
    requiredSeconds: number,
): EntitlementVerdict {
    const trialActive = usage.trial_active === true;
    const isPro = usage.is_pro === true;

    if (!trialActive && !isPro) return { ok: false, reason: 'no_trial_and_not_pro' };

    if (trialActive) {
        const remaining = usage.trial_seconds_remaining;
        if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
            return { ok: false, reason: `trial_seconds_remaining_not_finite:${typeof remaining}` };
        }
        if (remaining < requiredSeconds) {
            return { ok: false, reason: `trial_headroom_insufficient:${remaining}<${requiredSeconds}` };
        }
        return { ok: true };
    }

    return { ok: true };      // effective Pro, no finite budget to satisfy
}
