/**
 * #1263 — SWITCH THE RUNNING MODEL INSIDE ONE AUTHENTICATED PAGE.
 *
 * The human comparison reads one script under three candidates. If each switch costs a rebuild, a
 * deploy and a fresh login, the three recordings happen in three different sessions on three different
 * builds, and every difference between them is confounded by everything else that changed. The config
 * file is a STATIC import, inlined into the bundle at build time, so editing it cannot reach a running
 * page at all.
 *
 * This is the one runtime channel that can, and it is deliberately the narrowest thing that works:
 *
 *   INTERNAL BUILDS ONLY. Gated on the same `VITE_INTERNAL_BUILD` signal as the
 *   `acknowledgeNotProductionReady` escape hatch, so a build a real user receives has no runtime
 *   selector at all — the config file remains the sole selector there. This is why it is not a
 *   reintroduction of the URL/localStorage plane that #1263 retired: those answered to anyone holding
 *   a link, on any build.
 *
 *   REFUSED WHILE BUSY. Swapping the engine mid-recording would abandon audio the user believed was
 *   being captured, and mid-save would leave a row describing a model that no longer exists. A refusal
 *   is recoverable; a half-swapped session is not.
 *
 *   FULL TEARDOWN, NEVER A HAND-OFF. The executor must destroy the worker and clear the audio buffer,
 *   transcript and fallback state. Carrying any of it across would attribute one model's words to
 *   another — the exact failure the attribution work exists to prevent, arriving through the door
 *   built to measure it.
 */
import { CANDIDATES, UnknownCandidateError, type CandidateId } from './candidateRegistry';

/** States in which the engine is doing something that a swap would corrupt. */
export const SWITCH_BLOCKING_STATES: readonly string[] = Object.freeze([
    'INITIATING', 'ENGINE_INITIALIZING', 'RECORDING', 'STOPPING',
]);

export type SwitchFailureCode =
    | 'not_internal_build' | 'unknown_candidate' | 'busy' | 'no_executor' | 'teardown_failed' | 'init_failed';

export type SwitchOutcome =
    | { ok: true; candidate: CandidateId }
    | { ok: false; code: SwitchFailureCode; reason: string };

/**
 * What the app must supply so a switch can actually happen. Injected rather than imported so this
 * module stays free of the transcription stack and can be driven in a test.
 */
export interface SwitchExecutor {
    /** The current lifecycle state, used only to refuse. */
    currentState: () => string | null | undefined;
    /** Destroy the worker and CLEAR audio buffer, transcript and fallback state. */
    teardown: () => Promise<void>;
    /** Bring the engine back up on the candidate now in force. */
    initialize: () => Promise<void>;
}

let executor: SwitchExecutor | null = null;
let override: CandidateId | null = null;
const listeners = new Set<(id: CandidateId | null) => void>();

export function registerSwitchExecutor(next: SwitchExecutor | null): void { executor = next; }

/** The candidate a runtime switch put in force, or null when config decides. */
export function runtimeCandidateOverride(): CandidateId | null { return override; }

/** Drop the override so config decides again. Does NOT reinitialise; callers own that. */
export function clearRuntimeCandidateOverride(): void {
    override = null;
    for (const l of listeners) { try { l(null); } catch { /* a listener must not break a switch */ } }
}

export function onRuntimeCandidateChange(fn: (id: CandidateId | null) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

function internalBuild(env: Record<string, unknown>): boolean {
    return env?.VITE_INTERNAL_BUILD === 'true';
}

/**
 * Switch the running candidate. Returns an OUTCOME rather than throwing: every refusal here is an
 * expected operating condition the harness has to report, not an exception.
 */
export async function switchCandidate(
    id: string,
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): Promise<SwitchOutcome> {
    if (!internalBuild(env)) {
        return { ok: false, code: 'not_internal_build', reason: 'runtime model switching requires an internal build' };
    }
    if (!(id in CANDIDATES)) {
        return {
            ok: false, code: 'unknown_candidate',
            reason: new UnknownCandidateError(`unknown candidate "${id}"`).message,
        };
    }
    if (!executor) {
        return { ok: false, code: 'no_executor', reason: 'no engine is registered to switch' };
    }
    const state = String(executor.currentState() ?? '');
    if (SWITCH_BLOCKING_STATES.includes(state)) {
        return { ok: false, code: 'busy', reason: `refused while ${state}: finish or stop the session first` };
    }

    const previous = override;
    // Set BEFORE initialising: the engine reads the selection on the way up, so a switch that flipped
    // the value afterwards would bring up the OLD model and then claim the new one.
    override = id as CandidateId;
    try {
        await executor.teardown();
    } catch (e) {
        override = previous;
        return { ok: false, code: 'teardown_failed', reason: e instanceof Error ? e.message : String(e) };
    }
    try {
        await executor.initialize();
    } catch (e) {
        // The old engine is already gone, so restoring the override would describe a model that is not
        // running. Leave the selection where it points and report the failure.
        return { ok: false, code: 'init_failed', reason: e instanceof Error ? e.message : String(e) };
    }
    for (const l of listeners) { try { l(override); } catch { /* never break a completed switch */ } }
    return { ok: true, candidate: override };
}
