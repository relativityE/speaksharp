/**
 * #1426 — INSTALL the hidden in-page model-comparison switch.
 *
 * Separated from `runtimeCandidateSwitch` so that module stays free of the transcription stack and can
 * be driven in a test. This is the only place the switch is bound to the real engine, and the only
 * place it reaches `window`.
 *
 * The window surface exists on canonical Production so the qualification wrapper can drive a switch
 * over CDP: the operator stays logged in on one page and never touches a URL, storage value, feature
 * flag, or visible app control. The properties are non-enumerable so ordinary global inspection does
 * not advertise the mechanism; possession of a URL alone changes nothing.
 */
import {
    registerSwitchExecutor, switchCandidate, runtimeCandidateOverride, runtimeCandidateExpectation,
    runtimeCandidateAccessAllowed,
    type SwitchOutcome,
} from './runtimeCandidateSwitch';
import { effectiveCandidate } from './candidateSelection';
import { clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';
import { resolvedEngine } from '@/services/telemetry/runtimeAttribution';
import { consumeModelComparisonAuthorization } from './modelComparisonAuthorization';

interface SwitchWindow {
    __SS_SWITCH_CANDIDATE__?: (id: string, journey?: 'open_mic' | 'focus_points') => Promise<SwitchOutcome>;
    __SS_ACTIVE_CANDIDATE__?: () => {
        requested: string;
        observed: string | null;
        expected: string;
        matches: boolean;
        source: 'config' | 'runtime_switch' | 'remote_safety_kill';
    };
}

export async function installRuntimeCandidateSwitch(
): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    // Build authority is immutable application configuration, never a value supplied by the caller.
    // This function remains importable from the public chunk, so accepting `env` here would let page
    // code call it with `{ VITE_INTERNAL_BUILD: 'true' }` and install the real executor without a
    // signed Production authorization.
    if (import.meta.env.VITE_INTERNAL_BUILD !== 'true'
        && !await consumeModelComparisonAuthorization()) return false;
    if (!runtimeCandidateAccessAllowed()) return false;

    registerSwitchExecutor({
        // The lifecycle state the whole app already publishes, rather than a second opinion that could
        // disagree with the one the UI and the proof harness read.
        currentState: () => document.documentElement.getAttribute('data-runtime-state'),

        teardown: async () => {
            // ATTRIBUTION IS UNKNOWN FROM HERE. `resolvedEngine()` holds what the OUTGOING engine
            // published and nothing in production ever cleared it, so a switch that then failed to
            // initialise kept reporting the previous model as the running one. An observed identity
            // that outlives its engine is worse than none, because it reads as evidence.
            clearResolvedEngine();

            const { speechRuntimeController } = await import('@/services/SpeechRuntimeController');

            // ONE CONTROLLER-OWNED AWAITED OPERATION. This previously called `reset()` — which clears
            // state synchronously but leaves destruction and both transitions running unawaited — and
            // then polled the published state for a settled value. That check could not work: at the
            // moment a switch begins the state is already READY (that is why the switch was permitted),
            // so the first poll passed before the reset had changed anything, and the new engine could
            // start against a service still tearing down.
            await speechRuntimeController.hardResetAwaited('candidate-switch');
        },

        initialize: async () => {
            const { speechRuntimeController } = await import('@/services/SpeechRuntimeController');
            await speechRuntimeController.initiateModelDownload('private');
        },

        // What the ENGINE published, read from the same source `__SS_ACTIVE_CANDIDATE__` reports as
        // `observed`. Deliberately not the selection: comparing the selection to itself always agrees.
        observedCandidate: () => resolvedEngine()?.candidateId ?? null,
    });

    const w = window as unknown as SwitchWindow;
    const installHidden = <K extends keyof SwitchWindow>(key: K, value: NonNullable<SwitchWindow[K]>): void => {
        Object.defineProperty(w, key, { value, enumerable: false, configurable: true, writable: false });
    };
    installHidden('__SS_SWITCH_CANDIDATE__', (id: string, journey?: 'open_mic' | 'focus_points') =>
        switchCandidate(id, undefined, journey));
    installHidden('__SS_ACTIVE_CANDIDATE__', () => {
        // REQUESTED vs OBSERVED, reported separately and never conflated.
        //
        // This used to return only the selection — an INTENTION. A wrapper reading it would have
        // recorded "moonshine" for a session the engine actually decoded with v2, which is the precise
        // defect the attribution work exists to prevent, arriving through the tool built to observe it.
        // `observed` is what the ENGINE published when it resolved; null means nothing has resolved yet.
        const sel = effectiveCandidate();
        const observed = resolvedEngine()?.candidateId ?? null;
        const expected = runtimeCandidateExpectation() ?? sel.candidate.id;
        return {
            requested: sel.candidate.id,
            observed,
            expected,
            // The qualification wrapper must gate on THIS, not on `requested`.
            matches: observed !== null && observed === sel.candidate.id && observed === expected,
            source: sel.fallbackCause ? 'remote_safety_kill' : (runtimeCandidateOverride() ? 'runtime_switch' : 'config'),
        };
    });
    return true;
}
