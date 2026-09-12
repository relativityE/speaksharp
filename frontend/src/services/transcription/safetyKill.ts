/**
 * #1263 — THE ONE-WAY REMOTE SAFETY KILL.
 *
 * Selection is a checked-in config decision. This is the single exception, and it is deliberately
 * shaped so it cannot become a second selector.
 *
 * WHAT IT CAN DO: force the configured fallback, `v2:base.en`.
 * WHAT IT CANNOT DO: select v4, Moonshine, a variant, a device, or a cohort.
 *
 * That asymmetry is the whole design. The retired mechanism read flag PAYLOADS — a variant name, a
 * device, an allowlist — so a remote value could decide which model a visitor ran, and the session's
 * model was therefore a property of PostHog state at that moment rather than of anything reviewable.
 * This reads ONE BOOLEAN and maps it to ONE hardcoded destination. There is no input by which a remote
 * value can name a model, so no remote change can point traffic at an unreviewed one.
 *
 * FAILS OFF, DELIBERATELY. An unreadable flag, an uninitialised PostHog, or SSR all resolve to "not
 * engaged", so the CONFIGURED candidate runs. The alternative — failing toward the kill — would let a
 * transient network failure silently downgrade every user's model, and a silent downgrade is exactly
 * the unattributable-session problem in a new costume. An emergency switch that needs to be reachable
 * to be safe is only safe when someone is watching; a config file is safe when nobody is.
 */
import posthog from 'posthog-js';
import logger from '@/lib/logger';

/**
 * The ONLY runtime flag Private STT model selection consults.
 *
 * Distinct key from the retired `private_stt_v4_*` family on purpose: those keys carried positive
 * selection semantics, and reusing one would let an old flag value resurrect that behaviour.
 */
export const SAFETY_KILL_FLAG = 'private_stt_remote_safety_kill' as const;

/** The candidate the kill forces. Hardcoded: the destination is never remotely supplied. */
export const SAFETY_KILL_TARGET = 'v2:base.en' as const;

/** Recorded on a session whose model was decided by the kill rather than by config. */
export const FALLBACK_CAUSE_REMOTE_KILL = 'remote_safety_kill' as const;

/**
 * Is the one-way safety kill engaged right now?
 *
 * Never throws. Any failure resolves to `false` (configured candidate runs).
 */
export function isRemoteSafetyKillEngaged(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        // A STRICT boolean-true test. `isFeatureEnabled` yields undefined before flags load, and a
        // truthy-coerced payload (a variant string, say) must never read as engaged — that is how a
        // boolean switch quietly regains a payload.
        return posthog?.isFeatureEnabled?.(SAFETY_KILL_FLAG) === true;
    } catch (error) {
        logger.debug?.({ error, key: SAFETY_KILL_FLAG }, '[safetyKill] flag read failed; treating as NOT engaged');
        return false;
    }
}
