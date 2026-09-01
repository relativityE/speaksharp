/**
 * #1263 — INSTALL the in-page model switch, on internal builds only.
 *
 * Separated from `runtimeCandidateSwitch` so that module stays free of the transcription stack and can
 * be driven in a test. This is the only place the switch is bound to the real engine, and the only
 * place it reaches `window` — a production build calls this and it returns immediately, so no runtime
 * selector exists there at all.
 *
 * The window surface exists so the qualification wrapper can drive a switch over CDP: the operator
 * stays logged in on one page and never touches a URL or a command line.
 */
import {
    registerSwitchExecutor, switchCandidate, runtimeCandidateOverride,
    type SwitchOutcome,
} from './runtimeCandidateSwitch';
import { effectiveCandidate } from './candidateSelection';
import { clearResolvedEngine } from '@/services/telemetry/runtimeAttribution';
import { resolvedEngine } from '@/services/telemetry/runtimeAttribution';

interface SwitchWindow {
    __SS_SWITCH_CANDIDATE__?: (id: string) => Promise<SwitchOutcome>;
    __SS_ACTIVE_CANDIDATE__?: () => {
        requested: string;
        observed: string | null;
        matches: boolean;
        source: 'config' | 'runtime_switch' | 'remote_safety_kill';
    };
}

export function installRuntimeCandidateSwitch(
    env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): boolean {
    // FAIL CLOSED BY OMISSION. A build that forgets the variable gets no switch; installing one
    // requires setting it. The dangerous direction is unreachable by forgetting.
    if (env?.VITE_INTERNAL_BUILD !== 'true' || typeof window === 'undefined') return false;

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
    });

    const w = window as unknown as SwitchWindow;
    w.__SS_SWITCH_CANDIDATE__ = (id: string) => switchCandidate(id, env);
    w.__SS_ACTIVE_CANDIDATE__ = () => {
        // REQUESTED vs OBSERVED, reported separately and never conflated.
        //
        // This used to return only the selection — an INTENTION. A wrapper reading it would have
        // recorded "moonshine" for a session the engine actually decoded with v2, which is the precise
        // defect the attribution work exists to prevent, arriving through the tool built to observe it.
        // `observed` is what the ENGINE published when it resolved; null means nothing has resolved yet.
        const sel = effectiveCandidate();
        const observed = resolvedEngine()?.candidateId ?? null;
        return {
            requested: sel.candidate.id,
            observed,
            // The qualification wrapper must gate on THIS, not on `requested`.
            matches: observed !== null && observed === sel.candidate.id,
            source: sel.fallbackCause ? 'remote_safety_kill' : (runtimeCandidateOverride() ? 'runtime_switch' : 'config'),
        };
    };
    return true;
}
