"use strict";
// Nightly AHT suite, J1.a `trial-length-thirty-days`: on the deployed build, read with the account's OWN token (never
// the service role), the trial started inside the signup window and ends exactly 30 days later (product owner,
// 14 Nov). The shipped chain sets `trial_expires_at = activation + interval '30 days'`; sessions run in UTC, so
// that is exactly 30 x 24 hours. The DB trial-journey test checks this only on the original trigger body.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** Tolerance between the runner's clock (the signup window) and the server's clock (the stamp). */
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const parse = (iso) => {
    if (!iso)
        return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
};
function trialLengthVerdict(read, window) {
    if (read.via !== 'own-token')
        return { outcome: 'FAIL', detail: 'the trial was read with the service role, not the account\'s own token' };
    const isId = (v) => typeof v === 'string' && v.length > 0;
    if (!isId(read.profileId) || !isId(window.accountId))
        return { outcome: 'HOLD', detail: 'the profile id or the run\'s account id was not recorded' };
    if (read.profileId !== window.accountId)
        return { outcome: 'FAIL', detail: 'the profile read is not this run\'s account' };
    if (!(window.endedAtMs >= window.startedAtMs))
        return { outcome: 'HOLD', detail: 'the signup window was not recorded' };
    const started = parse(read.trialStartedAt);
    const expires = parse(read.trialExpiresAt);
    if (started === null || expires === null)
        return { outcome: 'FAIL', detail: 'the trial has no start or end stamp' };
    if (started < window.startedAtMs - CLOCK_SKEW_MS || started > window.endedAtMs + CLOCK_SKEW_MS) {
        return { outcome: 'FAIL', detail: 'the trial did not start inside the signup window' };
    }
    const length = expires - started;
    if (length !== THIRTY_DAYS_MS)
        return { outcome: 'FAIL', detail: `the trial lasts ${length / 3_600_000} hours, not 720 (30 days)` };
    return { outcome: 'PASS', detail: 'started inside the signup window, ends exactly 30 days later' };
}

module.exports = { CLOCK_SKEW_MS, THIRTY_DAYS_MS, trialLengthVerdict };
