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
 *   QUALIFICATION CANDIDATES ONLY. The hidden CDP surface accepts the three candidates in the PO's
 *   comparison and nothing else. It has no URL, storage, flag, or visible UI input, so a customer
 *   cannot select a model by following a link or changing an app control.
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
import {
    CANDIDATES, UnknownCandidateError,
    type Candidate, type CandidateId, type EngineKind,
} from './candidateRegistry';

/**
 * The engines the product facade can actually construct.
 *
 * `PrivateSTT` resolves a provider from `getPrivateProviderIds()`, which yields ONLY these two. A
 * candidate naming any other engine does not fail there — it falls through to the configured engine and
 * runs v2 while the caller believes it asked for something else. Requesting Moonshine today would
 * therefore produce a v2 recording labelled Moonshine, which is worse than no recording at all.
 *
 * Moonshine joined this list once it was registered on the real provider path (#1381).
 */
export const PRODUCT_ENGINES: readonly EngineKind[] = Object.freeze([
    'transformers-js', 'transformers-js-v4', 'moonshine-streaming',
]);

/** The complete PO-approved comparison slate. Registry membership alone is not permission to run. */
export const COMPARISON_CANDIDATE_IDS = Object.freeze([
    'v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium',
] as const satisfies readonly CandidateId[]);

/**
 * Installed before app code by the loopback CDP harness. A Symbol avoids a string-named page control;
 * no application code exports a setter, and a normal Production navigation never creates it.
 */
export const MODEL_COMPARISON_CDP_ARM_KEY = 'speaksharp.model-comparison.cdp';

export function runtimeCandidateAccessAllowed(
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
    root: typeof globalThis = globalThis,
): boolean {
    return env?.VITE_INTERNAL_BUILD === 'true'
        || (root as unknown as Record<symbol, unknown>)[Symbol.for(MODEL_COMPARISON_CDP_ARM_KEY)] === true;
}

/** States in which the engine is doing something that a swap would corrupt. */
export const SWITCH_BLOCKING_STATES: readonly string[] = Object.freeze([
    'INITIATING', 'ENGINE_INITIALIZING', 'RECORDING', 'STOPPING',
]);

export type SwitchFailureCode =
    | 'not_armed' | 'unknown_candidate' | 'not_comparison_candidate' | 'engine_not_integrated'
    | 'busy' | 'switch_in_progress' | 'no_executor' | 'teardown_failed' | 'init_failed'
    // The engine came up, but not as the candidate that was asked for. Distinct from `init_failed`
    // because nothing failed: this is the success path producing the wrong model.
    | 'identity_mismatch';

export type SwitchOutcome =
    | { ok: true; candidate: CandidateId }
    | { ok: false; code: SwitchFailureCode; reason: string };

/** Exported so the facade-integration guard remains provable even while every comparison arm works. */
export function engineIntegrationRefusal(candidate: Candidate): SwitchOutcome | null {
    if (PRODUCT_ENGINES.includes(candidate.engine)) return null;
    return {
        ok: false,
        code: 'engine_not_integrated',
        reason: `candidate "${candidate.id}" runs on ${candidate.engine}, which the product facade cannot `
            + 'construct. Selecting it would run a DIFFERENT model under this id.',
    };
}

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
    /**
     * What the ENGINE published after coming up, or null if it published nothing.
     *
     * Required, not optional: an executor that cannot report the observed identity cannot have its
     * postcondition checked, and making it optional would let the check be skipped by omission — which
     * is how the switch came to report success without ever comparing anything.
     */
    observedCandidate: () => string | null;
}

let executor: SwitchExecutor | null = null;
let override: CandidateId | null = null;
/** The arm the qualification operator asked this page to prove on its next take. */
let expected: CandidateId | null = null;
/** One switch at a time. Two overlapping teardowns would race over the same worker. */
let inFlight: Promise<SwitchOutcome> | null = null;
const listeners = new Set<(id: CandidateId | null) => void>();

export function registerSwitchExecutor(next: SwitchExecutor | null): void { executor = next; }

/** The candidate a runtime switch put in force, or null when config decides. */
export function runtimeCandidateOverride(): CandidateId | null { return override; }

/** Independent third term for requested === observed === expected at the take boundary. */
export function runtimeCandidateExpectation(): CandidateId | null { return expected; }

/** Drop the override so config decides again. Does NOT reinitialise; callers own that. */
export function clearRuntimeCandidateOverride(): void {
    override = null;
    expected = null;
    for (const l of listeners) { try { l(null); } catch { /* a listener must not break a switch */ } }
}

export function onRuntimeCandidateChange(fn: (id: CandidateId | null) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/**
 * Switch the running candidate. Returns an OUTCOME rather than throwing: every refusal here is an
 * expected operating condition the harness has to report, not an exception.
 */
export async function switchCandidate(
    id: string,
    _env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
    /**
     * The candidate table. Injected like `env` so the "engine the facade cannot construct" refusal
     * stays provable: every REGISTERED engine is buildable now, so proving that guard through a real
     * candidate would mean deleting it the moment its last example was integrated — and the next engine
     * added without a provider path would then fall through and run the configured model under its id.
     */
    candidates: typeof CANDIDATES = CANDIDATES,
): Promise<SwitchOutcome> {
    if (!runtimeCandidateAccessAllowed(_env)) {
        return {
            ok: false,
            code: 'not_armed',
            reason: 'runtime model switching requires the pre-navigation CDP qualification arm',
        };
    }
    if (!(id in candidates)) {
        return {
            ok: false, code: 'unknown_candidate',
            reason: new UnknownCandidateError(`unknown candidate "${id}"`).message,
        };
    }
    if (!(COMPARISON_CANDIDATE_IDS as readonly string[]).includes(id)) {
        return {
            ok: false, code: 'not_comparison_candidate',
            reason: `candidate "${id}" is registered but is not in the three-model comparison`,
        };
    }
    const candidate = candidates[id as CandidateId];
    const integrationRefusal = engineIntegrationRefusal(candidate);
    if (integrationRefusal) {
        // FAIL CLOSED. Falling through would run the configured engine under the requested id.
        return integrationRefusal;
    }
    if (!executor) {
        return { ok: false, code: 'no_executor', reason: 'no engine is registered to switch' };
    }
    if (inFlight) {
        return { ok: false, code: 'switch_in_progress', reason: 'another switch is still running' };
    }
    const state = String(executor.currentState() ?? '');
    if (SWITCH_BLOCKING_STATES.includes(state)) {
        return { ok: false, code: 'busy', reason: `refused while ${state}: finish or stop the session first` };
    }

    // Captured so the closure below cannot observe a later re-registration mid-switch.
    const engine = executor;
    const run = async (): Promise<SwitchOutcome> => {
    const previous = override;
    const previousExpected = expected;
    // Set BEFORE initialising: the engine reads the selection on the way up, so a switch that flipped
    // the value afterwards would bring up the OLD model and then claim the new one.
    override = id as CandidateId;
    expected = id as CandidateId;
    try {
        await engine.teardown();
    } catch (e) {
        override = previous;
        expected = previousExpected;
        return { ok: false, code: 'teardown_failed', reason: e instanceof Error ? e.message : String(e) };
    }
    try {
        await engine.initialize();
    } catch (e) {
        // The old engine is already gone, so restoring the override would describe a model that is not
        // running. Leave the selection where it points and report the failure.
        return { ok: false, code: 'init_failed', reason: e instanceof Error ? e.message : String(e) };
    }

    // THE POSTCONDITION. Initialising without error is not evidence that the requested model is the one
    // running: a resolver that quietly fell back, an engine that came up on a different variant, or a
    // selection read at the wrong moment all complete without throwing. Reporting `ok` there hands the
    // operator a take labelled with a model that never ran — the exact substitution this switch exists
    // to make impossible, arriving through the success path instead of the failure path.
    //
    // Compared against what the ENGINE published, not against the selection we just wrote.
    const observed = engine.observedCandidate();
    if (observed !== override) {
        await engine.teardown().catch(() => { /* already failing; do not mask the mismatch */ });
        return {
            ok: false,
            code: 'identity_mismatch',
            reason: observed === null
                ? `switched to "${override}" but the engine published no identity, so nothing can be attributed`
                : `switched to "${override}" but the engine is running "${observed}"`,
        };
    }

    for (const l of listeners) { try { l(override); } catch { /* never break a completed switch */ } }
    return { ok: true, candidate: override };
    };
    inFlight = run();
    try { return await inFlight; } finally { inFlight = null; }
}
