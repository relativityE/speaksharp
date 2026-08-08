import logger from '../../lib/logger';

/**
 * #1184 STT exclusivity — traceability for the fail-closed guard.
 *
 * Private is the ONLY user-facing engine, so any request for `native`/`cloud` is neutralized to Private
 * ("collapse"). That collapse should NEVER happen in healthy Private-only operation — every occurrence
 * flags a bug or a caller/stored-value that still references a retired engine.
 *
 * Sink decision (PO, 2026-08-08): **`logger.warn` only for now — NOT PostHog/Sentry.** Two of the
 * chokepoints (`buildPolicyForUser`, `resolveMode`) run on every resync/render, so a single stale
 * `native` store value would re-fire per render for that user — sending that to a persisted analytics
 * sink risks blowing storage. Keep it console-only until launch telemetry proves it is rare; escalating
 * to a persisted sink is tracked on #1165/#1184.
 *
 * De-duped: logged once per `(source, requestedMode)` per session so a stale value gives ONE clear signal
 * instead of flooding the console (and so a future persisted sink can't be volume-bombed).
 *
 * Fail-safe by contract: logging must never throw into the STT path.
 *
 * NOTE on the reverse (private -> native/cloud): that must be impossible under fail-closed resolution, and
 * a mid-recording engine change is separately caught by the producer-integrity latch — so there is no
 * high-volume "reverse" event here.
 */
export type EngineCollapseSource =
    | 'resolveMode'
    | 'buildPolicyForUser'
    | 'requestModeChange'
    | 'warmUp';

/** True when a requested mode is a retired (non-Private, non-mock) user-facing engine. */
export function isRetiredEngineRequest(mode: string | null | undefined): boolean {
    return mode === 'native' || mode === 'cloud';
}

const loggedKeys = new Set<string>();

/**
 * Record (console-only, de-duped) that a retired-engine request was neutralized to Private. Call at every
 * collapse chokepoint. Test-only: `__resetEngineCollapseDedupeForTests` clears the dedupe cache.
 */
export function emitEngineRequestCollapsedToPrivate(input: {
    source: EngineCollapseSource;
    requestedMode: string;
}): void {
    const key = `${input.source}:${input.requestedMode}`;
    if (loggedKeys.has(key)) return; // dedupe: one signal per (source, mode) per session
    loggedKeys.add(key);
    try {
        logger.warn(
            { source: input.source, requested_mode: input.requestedMode, resolved_mode: 'private' },
            '[#1184 STT exclusivity] engine request collapsed to Private (fail-closed)'
        );
    } catch { /* logging must never break the STT path */ }
}

/** Test hook: reset the per-session dedupe cache so tests can assert repeated emissions independently. */
export function __resetEngineCollapseDedupeForTests(): void {
    loggedKeys.clear();
}
