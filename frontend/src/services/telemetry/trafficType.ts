/**
 * #1259 T2 — WHO IS THIS TRAFFIC? The anti-silence gate.
 *
 * The previous release could not distinguish a real tester from our own smoke traffic, so "few
 * testers and little feedback" was uninterpretable: it could not be told apart from "nobody arrived".
 * This field exists to make that question answerable.
 *
 * THE CLASSIFICATION SOURCE IS THE WHOLE POINT. A client that self-declares its type solves nothing —
 * the first harness that forgets to set the flag looks exactly like a user, which is the same silence
 * relocated. So:
 *
 *   internal  a BUILD a real user never receives.
 *   canary    WHO YOU ARE, not what you claim. The canary authenticates as a known account against
 *             production; a real user cannot produce this because they cannot sign in as that account.
 *             The harness sets nothing and therefore cannot forget to.
 *   user      the FAIL-TOWARD default, and only when neither of the above is affirmatively
 *             established. Failing toward `user` risks over-counting our own traffic as real, which is
 *             visible and correctable; failing toward `canary` would HIDE a real user, which is the
 *             error that cannot be detected after the fact.
 */

export const TRAFFIC_TYPES = Object.freeze(['user', 'canary', 'internal'] as const);
export type TrafficType = typeof TRAFFIC_TYPES[number];

export interface TrafficSignals {
    /** True only for a build produced for internal use. Never a runtime toggle. */
    internalBuild?: boolean;
    /** Account ids known to belong to synthetic qualification accounts. */
    canaryAccountIds?: readonly string[];
    /** The AUTHENTICATED account id for this session, or null when signed out. */
    accountId?: string | null;
}

const normalise = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/**
 * Classify this session's traffic. Precedence is deliberate: `internal` outranks `canary` because an
 * internal build running the canary account is still our own traffic, and both outrank `user`.
 */
export function resolveTrafficType(signals: TrafficSignals = {}): TrafficType {
    if (signals.internalBuild === true) return 'internal';

    const account = normalise(signals.accountId);
    if (account) {
        const known = (signals.canaryAccountIds ?? []).map(normalise).filter(Boolean);
        if (known.includes(account)) return 'canary';
    }
    return 'user';
}

/** Parse the build-time canary account list. Malformed input yields NO known accounts, never a guess. */
export function parseCanaryAccountIds(raw: string | undefined | null): string[] {
    if (typeof raw !== 'string') return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The signals this build actually has. Read from build-time env so a runtime value cannot change what
 * a session claims to be.
 */
export function buildTrafficSignals(
    env: Record<string, string | undefined> = import.meta.env as unknown as Record<string, string | undefined>,
    accountId: string | null = null,
): TrafficSignals {
    return {
        internalBuild: env.VITE_INTERNAL_BUILD === 'true',
        canaryAccountIds: parseCanaryAccountIds(env.VITE_CANARY_ACCOUNT_IDS),
        accountId,
    };
}
