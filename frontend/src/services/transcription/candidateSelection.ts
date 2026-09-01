/**
 * #1263 — THE SOLE MODEL-SELECTION AUTHORITY.
 *
 * Selection used to be fragmented across two URL parameter families (`privateEngine`, `privateModel`,
 * `v4Device`, `v4Variant`), three localStorage keys, PostHog flags, a build-time veto and a default
 * constant — nine mechanisms, spread over nineteen source files, that between them decided which model
 * a visitor got. Nobody could answer "which model is production running?" by reading one place, and a
 * per-visitor mechanism cannot be reviewed at all.
 *
 * That decision now lives in ONE checked-in file, so changing which model users get is a reviewable
 * commit, and rollback is editing a line rather than emergency engineering.
 *
 * SEPARATE FROM THE REGISTRY ON PURPOSE. `candidateRegistry` answers "what did this run resolve to?"
 * and is read by telemetry attribution; this module answers "what should we run?". Keeping the
 * intention out of the registry is what stops an intention from being reported as evidence — the exact
 * defect that recorded an int8 session as q4.
 */
import privateSttConfig from '../../config/private-stt.config.json';
import {
    CANDIDATES, CANDIDATE_IDS, UnknownCandidateError,
    type Candidate,
} from './candidateRegistry';
import {
    isRemoteSafetyKillEngaged, SAFETY_KILL_TARGET, FALLBACK_CAUSE_REMOTE_KILL,
} from './safetyKill';

/**
 * THE SOLE CANDIDATE SELECTOR — read from a checked-in config file.
 *
 * Previously a hardcoded constant in this module, which made the registry its own second control
 * plane. The selection now lives in `config/private-stt.config.json`, so changing which model users
 * get is a reviewable one-line diff in a file whose only job is that decision.
 *
 * Not a URL parameter, not localStorage, not a flag. Those can differ per visitor and cannot be
 * reviewed, which is exactly how a session ended up unattributable to any model.
 */
export const PRIVATE_STT_CONFIG_PATH = 'frontend/src/config/private-stt.config.json';

export class UnusableCandidateError extends Error {}
export class InactiveCandidateError extends Error {}
/**
 * Resolve a candidate id to its full identity, FAILING CLOSED.
 *
 * Two refusals, not one. An unknown id is obvious; a KNOWN id that cannot execute in the browser is the
 * one that would otherwise be discovered at a user's first session, after the download.
 */
/**
 * Exported so the refusal MECHANISM stays under test even when — as today — no registered candidate is
 * browser-unusable. Testing it only through a real "unusable" entry is what pressured the registry into
 * keeping int8 falsely marked; the guard must be provable without libelling a working candidate.
 */
export function assertBrowserUsable(candidate: Candidate): void {
    if (!candidate.browser.ok) {
        throw new UnusableCandidateError(
            `Private STT candidate "${candidate.id}" cannot execute in the browser: ${candidate.browser.reason}`,
        );
    }
}

export function resolveCandidate(id: string): Candidate {
    const candidate = (CANDIDATES as Record<string, Candidate | undefined>)[id];
    if (!candidate) {
        throw new UnknownCandidateError(
            `unknown Private STT candidate "${id}"; registered: ${CANDIDATE_IDS.join(', ')}`,
        );
    }
    assertBrowserUsable(candidate);
    return candidate;
}

/**
 * The candidate this build runs, read from the config file.
 *
 * Throws at BOOT rather than at a user's first session — after a model download and a recording is the
 * worst possible moment to discover the configuration is wrong.
 *
 * The config is imported rather than fetched so an invalid value fails the build's type/JSON parse,
 * not a runtime request.
 */
export interface PrivateSttConfig {
    candidate?: string;
    /**
     * Deliberately select a candidate that is NOT approved as a production default.
     *
     * This exists so the Product Owner can human-test candidates side by side on the real path before
     * any of them is chosen. It is required, explicit, and lives in the same reviewable file as the
     * candidate — so an unapproved model can never reach a build by accident, only by someone writing
     * this line and it appearing in a diff.
     */
    acknowledgeNotProductionReady?: boolean;
}

/**
 * The candidate this build runs, read from the config file.
 *
 * Throws at BOOT rather than at a user's first session — after a model download and a recording is the
 * worst possible moment to discover the configuration is wrong.
 *
 * TWO DIFFERENT QUESTIONS, deliberately separated:
 *   activationReady      may this be the PRODUCTION DEFAULT users receive?
 *   acknowledged select  may this build run it for internal comparison?
 *
 * Collapsing them would force a choice between shipping an unproven model and being unable to test
 * one, and testing is how a model becomes proven.
 */
export function activeCandidate(
    config: PrivateSttConfig = privateSttConfig,
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): Candidate {
    const id = config?.candidate;
    if (typeof id !== 'string' || id === '') {
        throw new UnknownCandidateError(
            `${PRIVATE_STT_CONFIG_PATH} names no candidate; refusing to guess which model to run`,
        );
    }
    const candidate = resolveCandidate(id);

    /**
     * THE ESCAPE HATCH IS NOT A PRODUCTION BACKDOOR — AND IT DOES NOT DEPEND ON BUILD MODE.
     *
     * An earlier version keyed this on `import.meta.env.PROD`. That was wrong twice over: it made the
     * only way to ear-test an unapproved candidate on a REAL deployment an edit to the pinned build
     * command in vercel.json — weakening the production build to enable a test — and it tied a safety
     * property to a value that changes for unrelated reasons.
     *
     * The acknowledgement is honoured ONLY when the build is explicitly marked internal. That is the
     * same `VITE_INTERNAL_BUILD` signal telemetry uses to classify traffic, so the two cannot disagree:
     * a build permitted to run an unapproved candidate is, by construction, a build whose sessions are
     * reported as internal traffic.
     *
     * FAILS CLOSED. Production simply does not set the variable, so a forgotten flag REFUSES an
     * unapproved candidate rather than admitting one. The dangerous direction is unreachable by
     * omission — it requires setting a variable, not forgetting one.
     */
    const internalBuild = env?.VITE_INTERNAL_BUILD === 'true';
    if (config.acknowledgeNotProductionReady === true && !internalBuild) {
        throw new InactiveCandidateError(
            `acknowledgeNotProductionReady requires an INTERNAL build (candidate "${id}"). `
            + 'Set VITE_INTERNAL_BUILD=true for the comparison build; a build without it may not run a '
            + 'candidate that was never approved.',
        );
    }

    if (!candidate.activationReady && config.acknowledgeNotProductionReady !== true) {
        // NEVER silently substitute. A configured candidate that is not production-approved must stop
        // the boot with its reason, not quietly become a different model whose transcript would then
        // be attributed to the one that was asked for.
        throw new InactiveCandidateError(
            `Private STT candidate "${id}" is registered but not approved as a production default: `
            + `${candidate.notReadyReason ?? 'no reason recorded'}. `
            + 'Set acknowledgeNotProductionReady:true in the config to run it for internal comparison.',
        );
    }
    return candidate;
}

/** True when this build is running a candidate that is not approved as a production default. */
export function isRunningUnapprovedCandidate(config: PrivateSttConfig = privateSttConfig): boolean {
    try {
        return !resolveCandidate(config?.candidate ?? '').activationReady;
    } catch {
        return false;
    }
}

/**
 * The selection actually in force, after the one-way safety kill.
 *
 * `activeCandidate()` is the POSITIVE selector and the only thing that can name a model. This wraps it
 * with the single remote power we retain: forcing the configured fallback. The kill's destination is a
 * constant here, not a value it supplies, so a remote change can only ever move traffic TOWARD
 * `v2:base.en` — never toward a model nobody reviewed.
 */
export interface EffectiveSelection {
    candidate: Candidate;
    /**
     * Why this is not the configured candidate. Null on the normal path.
     *
     * Recorded so a session decoded under the kill is never read as evidence about the configured
     * model — an ear test that silently compared v2 against v2 would produce a confident, wrong result.
     */
    fallbackCause: typeof FALLBACK_CAUSE_REMOTE_KILL | null;
}

export function effectiveCandidate(
    config: PrivateSttConfig = privateSttConfig,
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
    killEngaged: boolean = isRemoteSafetyKillEngaged(),
): EffectiveSelection {
    if (killEngaged) {
        // NOT `activeCandidate()` first: the kill must work even when the configured candidate is
        // unknown or activation-ineligible. A safety switch that throws before it can act is not one —
        // a bad config is precisely when you need to force the floor.
        return {
            candidate: CANDIDATES[SAFETY_KILL_TARGET],
            fallbackCause: FALLBACK_CAUSE_REMOTE_KILL,
        };
    }
    return { candidate: activeCandidate(config, env), fallbackCause: null };
}
