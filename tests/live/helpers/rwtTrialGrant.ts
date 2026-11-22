/**
 * J1.a (Sam on run 45014809858): the receipt must establish that a brand-new account starts a 30-day trial. The shared
 * `new-account entitlement` row only proves the server let the account start; this row reads the run-owned account's own
 * profile and checks the trial itself, the same rule the billing journey asserts:
 *  - the trial was granted (`commercial_trial_granted_at` set);
 *  - its window is 30 days (`trial_expires_at - trial_started_at`, within 0.01 day);
 *  - it was started AND granted by this sign-up: both timestamps lie between the sign-up moment the journey observed and the
 *    read (a new account's start and grant are the database's own sign-up `now()`, ensure_trial_profile_for_new_user), within
 *    a clock tolerance only, so a future or earlier timestamp FAILs (Sam on cf07d0d9); and it has not expired;
 *  - the profile is not Pro (`subscription_status` is exactly `free`).
 * A failed or partial read is HOLD, never a pass. Evidence is booleans and rounded numbers only (no ids, no timestamps).
 */
export const TRIAL_ROW = 'new account starts a 30-day trial';
export const TRIAL_DAYS = 30;
/** Runner/database clock tolerance on each side of [sign-up moment, read]; nothing wider. */
export const TRIAL_CLOCK_SKEW_MS = 5_000;

export type TrialProfile = {
    trial_started_at?: unknown; trial_expires_at?: unknown; commercial_trial_granted_at?: unknown; subscription_status?: unknown;
};
export type TrialVerdict = { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string; evidence: Record<string, boolean | number | null> };

const time = (v: unknown): number | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

export function trialGrantVerdict(profile: TrialProfile | null, signupAt: number, now: number): TrialVerdict {
    if (!profile) return { status: 'HOLD', detail: 'the account profile could not be read', evidence: { profileRead: false } };
    const started = time(profile.trial_started_at);
    const expires = time(profile.trial_expires_at);
    const grantedAt = time(profile.commercial_trial_granted_at);
    const granted = grantedAt !== null;
    const inSignup = (t: number) => t >= signupAt - TRIAL_CLOCK_SKEW_MS && t <= now + TRIAL_CLOCK_SKEW_MS;
    const windowDays = started !== null && expires !== null ? Math.round(((expires - started) / 86_400_000) * 100) / 100 : null;
    const evidence = {
        profileRead: true, trialGranted: granted, windowDays,
        startedAtSignup: started === null ? null : inSignup(started),
        grantedAtSignup: grantedAt === null ? null : inSignup(grantedAt),
        active: expires === null ? null : expires > now,
        free: profile.subscription_status === 'free',
    };
    if (started === null || expires === null) {
        return { status: 'FAIL', detail: 'the new account has no complete trial window', evidence };
    }
    const ok = granted && evidence.grantedAtSignup === true && windowDays !== null && Math.abs(windowDays - TRIAL_DAYS) < 0.01 && evidence.startedAtSignup === true
        && evidence.active === true && evidence.free;
    return ok
        ? { status: 'PASS', detail: 'the new account was granted a 30-day trial that started at sign-up and is active', evidence }
        : { status: 'FAIL', detail: 'the new account did not start the expected 30-day trial', evidence };
}

type ProfileReader = { from(table: 'user_profiles'): { select(cols: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } };

/** Reads the run-owned account's trial fields (service role, this account only) and writes the row. */
export async function trialGrantRow(
    receipt: { row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, boolean | number | null>): void },
    admin: ProfileReader | null, uid: string, signupAt: number, now: () => number = Date.now,
): Promise<TrialVerdict> {
    let profile: TrialProfile | null = null;
    if (admin && uid) {
        try {
            const r = await admin.from('user_profiles').select('trial_started_at,trial_expires_at,commercial_trial_granted_at,subscription_status')
                .eq('id', uid).maybeSingle();
            profile = r.error ? null : (r.data as TrialProfile | null);
        } catch {
            profile = null;
        }
    }
    const v = trialGrantVerdict(profile, signupAt, now());
    receipt.row(TRIAL_ROW, v.status, v.detail, v.evidence);
    return v;
}
