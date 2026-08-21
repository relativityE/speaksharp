import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Sentry from '@sentry/react';
import logger from '../lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useProfile } from './useProfile';
import { useSessionStore } from '@/stores/useSessionStore';
import { publishTelemetry } from '@/services/telemetry/sessionTelemetryBus';
import { toTelemetryMode, isShadowMetricsEngineEnabled } from '@/services/telemetry/shadowMetricsEngine';
import { useSpeechRecognition } from './useSpeechRecognition';
import { pushE2EEvent } from '@/lib/e2eProbe';
import { sanitizeStartError } from '@/lib/sanitizeStartError';
import { useSessionMetrics } from './useSessionMetrics';
import { useUsageLimit, type UsageLimitCheck } from './useUsageLimit';
import { useStreak } from './useStreak';
import { useUserFillerWords } from './useUserFillerWords';
import { getEffectiveSubscriptionStatus, isPro } from '@/constants/subscriptionTiers';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import { PRIV_STT } from '@/services/transcription/sttConstants';
import { buildPolicyForUser, type TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { ENV } from '@/config/TestFlags';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { checkClientFreshness, canRecord, blockedMessage } from '@/services/staleClientGuard';
import { getSessionCoachingExperimentProperties } from '@/services/sessionCoachingExperiment';

const getStartFailureMessage = (error: unknown, mode: TranscriptionMode): string => {
    const err = error as { name?: string; message?: string } | null;
    const rawMessage = err?.message?.trim() || '';
    const micPermissionError =
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        /permission|notallowed|mic_stream_unavailable|media devices/i.test(rawMessage);

    if (micPermissionError) {
        return 'Microphone access is blocked. Allow microphone access and try again.';
    }

    if (mode === 'private') {
        return 'Private transcription could not finish setup. Check microphone permission and browser storage, then retry setup. Your audio stays on your machine.';
    }

    return rawMessage || 'Recording could not start. Try again.';
};

/**
 * #1258: decide whether a foreground return should trigger exactly one explicit STT reload. Pure so the
 * reclaim→return→reload contract is unit-testable without mounting the whole hook. Reload ONLY when the page
 * is visible, the profile is STT-ready, a mode is selected, we are not recording, and the engine was reclaimed
 * to a clean idle/needs-load state (never mid-record, never for a still-ready foreground-preserved engine).
 */
export function shouldReloadSttOnForegroundReturn(params: {
    visibilityState: DocumentVisibilityState;
    profileReadyForStt: boolean;
    effectiveMode: TranscriptionMode | null;
    isListening: boolean;
    shouldPromoteNativeDefaultToPrivate: boolean;
    hasPendingReclamation: boolean;
}): boolean {
    const { visibilityState, profileReadyForStt, effectiveMode, isListening, shouldPromoteNativeDefaultToPrivate, hasPendingReclamation } = params;
    if (visibilityState !== 'visible') return false;
    // Reload ONLY in response to an ACTUAL controller-owned idle reclamation (a change in its reclamation
    // token) — never on a generic IDLE state, a fresh mount, or a quick tab switch that reclaimed nothing.
    if (!hasPendingReclamation) return false;
    // Key off the EFFECTIVE mode (Private-only resolves `sttMode ?? 'private'`), NOT the raw store `sttMode`:
    // the real production condition is `sttMode === null`, so gating on it would refuse to reload exactly when
    // the canary needs it after a background reclamation.
    if (!profileReadyForStt || !effectiveMode || isListening) return false;
    if (shouldPromoteNativeDefaultToPrivate) return false;
    return true;
}

export const useSessionLifecycle = () => {
    const { session } = useAuthProvider();
    const { profile, isVerified } = useProfile();
    const queryClient = useQueryClient();
    const tick = useSessionStore(state => state.tick);
    const elapsedTime = useSessionStore(state => state.elapsedTime);
    const isLockHeldByOther = useSessionStore(state => state.isLockHeldByOther);
    const e2eDeps = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__E2E_DEPS__ : null) as { fetchUsageLimit?: () => Promise<UsageLimitCheck> } | null;
    const { data: usageLimit } = useUsageLimit(e2eDeps || undefined);
    const { updateStreak } = useStreak();
    const { userFillerWords } = useUserFillerWords();
    const activeEngine = useSessionStore(state => state.activeEngine);
    const interimTranscript = useSessionStore(state => state.transcript.partial);
    const { runtimeState } = useTranscriptionContext();

    const effectiveSubscriptionStatus = getEffectiveSubscriptionStatus(usageLimit?.subscription_status, profile);
    const isProUser = isPro(effectiveSubscriptionStatus);
    // Private is the only customer STT for active-trial and paid accounts. Access timing comes from the
    // server's can_start result; accumulated usage never changes the engine or auto-stops a recording.
    const canUsePrivateStt = true;
    const canUseCloudStt = false;
    // #1320: Native/Web-Speech is retired — there is no force-native path and no Native engine. Any
    // residually-persisted legacy 'native' store value is migrated to Private below (and the policy layer
    // independently collapses it for the engine), so product users always get Private.
    const profileReadyForStt = isVerified && !!profile?.id && typeof profile?.subscription_status === 'string';

    const sttStatus = useSessionStore(state => state.sttStatus);
    const setSTTStatus = useSessionStore(state => state.setSTTStatus);
    const sttMode = useSessionStore(state => state.sttMode);
    const setSTTMode = useSessionStore(state => state.setSTTMode);
    // Private is the only customer engine, so every customer session resolves to it unconditionally.
    // Private implementation variants remain internal policy, never customer entitlements.
    const defaultMode: TranscriptionMode = 'private';
    const effectiveMode: TranscriptionMode = sttMode ?? defaultMode;
    const [privateModelStatus, setPrivateModelStatus] = useState<string>(() => {
        if (typeof document === 'undefined') return 'idle';
        return document.documentElement.getAttribute('data-model-status') || 'idle';
    });
    const isPrivateStartBlockedByModelState = effectiveMode === 'private'
        && ['download-required', 'loading', 'init-failed', 'error'].includes(privateModelStatus);

    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const isProcessingRef = useRef(false);
    const isMounted = useRef(false);

    // Pure Projection from FSM (Source of Truth)
    // We drive the "recording" visual strictly from the authoritative runtimeState.
    const isRecordingIntent = ['RECORDING', 'STOPPING'].includes(runtimeState);

    // Stable ref for handleStartStop to prevent dependency loops
    const handleStartStopRef = useRef<((options?: { skipRedirect?: boolean; stopReason?: string }) => Promise<void>) | null>(null);

    // Guards to prevent double stops in the same session
    const hasAutoStoppedRef = useRef(false);
    const hasVADStoppedRef = useRef(false);
    const modeSourceRef = useRef<'default' | 'user' | null>(null);

    const speechConfig = useMemo(() => ({
        userWords: userFillerWords,
        userVocabulary: userFillerWords,
        session,
        profile,
        profileLoading: false // Guaranteed by ProfileGuard
    }), [userFillerWords, session, profile]);

    const isListening = useSessionStore(state => state.isListening);
    // #1089: post-Stop finalization is authoritative and OUTLIVES runtimeState leaving STOPPING.
    // The record control must stay non-interactive for its whole duration (see isButtonDisabled).
    const isTranscriptFinalizing = useSessionStore(state => state.isTranscriptFinalizing);
    const captureLimitReached = useSessionStore(state => state.captureLimitReached);
    const setCaptureLimitReached = useSessionStore(state => state.setCaptureLimitReached);
    const setCompletedSessionDuration = useSessionStore(state => state.setCompletedSessionDuration);
    const completedSessionDurationSeconds = useSessionStore(state => state.completedSessionDurationSeconds);
    const history = useSessionStore(state => state.history);
    // #1184: Private is the only engine, so a session that still carries the legacy 'native' default (not an
    // explicit user choice) is promoted to Private. Never when Native is force-pinned for a deterministic E2E
    // probe, and never over an explicit user choice (modeSourceRef==='user'). A fresh (unset) session is
    // handled by the `!sttMode` default path. (The #1120 flag no longer gates this — there is no Browser to
    // stay on; the flag is reserved for the future v2↔v4 variant selection.)
    // Migration only: a legacy persisted 'native' value (never an explicit user choice) is promoted to
    // Private. `sttMode` is typed 'private' | 'mock', but a stale stored string can still arrive at runtime,
    // so the check is against the raw value. This routes AWAY from Native — it can never select a Native engine.
    const shouldPromoteNativeDefaultToPrivate =
        (sttMode as string) === 'native' &&
        modeSourceRef.current !== 'user';

    const speechRecognition = useSpeechRecognition(speechConfig);
    const {
        transcript,
        chunks,
        fillerData,
        isReady,
        modelLoadingProgress,
        mode: activeMode,
        pauseMetrics,
        micLevel,
        hasSpeechActivity
    } = speechRecognition;

    // ✅ STABLE REFS for cleanup effects - defined AFTER speechRecognition
    const isListeningRef = useRef(isListening);
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    const metrics = useSessionMetrics({
        transcript: transcript.transcript,
        chunks: chunks as unknown as Array<{ transcript: string; timestamp: number }>, // Cast to structural match to avoid strict Chunk mismatch
        fillerData: fillerData as FillerCounts,
        elapsedTime,
        // #1089: after a stop the live timer resets to 00:00 for the next take, but the take under
        // review must keep dividing by its own spoken length. Null while recording (they are the same).
        scoringDurationSeconds: completedSessionDurationSeconds ?? undefined,
        userWords: userFillerWords, // accepted for compat; live filler count is canonical (no recount source-routing)
    });

    const handleStartStop = useCallback(async (options?: { skipRedirect?: boolean; stopReason?: string }) => {
        const latestSessionState = useSessionStore.getState();
        const latestRuntimeState = latestSessionState.runtimeState;
        const shouldStop = latestSessionState.isListening || latestRuntimeState === 'RECORDING' || latestRuntimeState === 'STOPPING';

        if (isProcessingRef.current && !shouldStop) return;
        // #1089 STRAY RECORDING: after an automatic stop the runtime FSM returns to READY while the
        // whole-utterance decode is still running, so the record control was briefly live and labelled
        // "Start". A user reaching for Stop then began a SECOND recording (the observed stray 9-second
        // session). Finalization is the authoritative gate: refuse to start a new recording until it
        // completes. This is a guard, not UI polish — never rely on the disabled button alone.
        if (!shouldStop && useSessionStore.getState().isTranscriptFinalizing) {
            logger.warn('[useSessionLifecycle] ⛔ Start ignored: previous recording is still finalizing');
            return;
        }
        isProcessingRef.current = true;

        if (shouldStop) {
            // ✅ Master Invariant: stopRecording() is now handled 
            // by SpeechRuntimeController. It performs cleanup and DB ops.

            // Bypass minimum duration check if there is an external stop reason (e.g. tier limits)
            if (elapsedTime < MIN_SESSION_DURATION_SECONDS && !options?.stopReason) {
                await speechRuntimeController.stopRecording();
                setShowAnalyticsPrompt(false);
                setSTTStatus({
                    type: 'info',
                    message: `⚠️ Session too short (${elapsedTime}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required.`
                });
                isProcessingRef.current = false;
                return;
            }

            try {
                // SpeechRuntimeController.stopRecording() handles enriched finalization,
                // metrics, streak updates, and optimistic usage sync atomically.
                const stopResult = await speechRuntimeController.stopRecording();

                if (!stopResult) {
                    setShowAnalyticsPrompt(false);
                    return;
                }

                const streakResult = updateStreak(); // UI layer still needs streak for display
                analyticsBuffer.push('session_saved', {
                    mode: effectiveMode,
                    duration_seconds: elapsedTime,
                    word_count: metrics.wordCount,
                    wpm: metrics.wpm,
                    filler_count: metrics.fillerCount,
                    clarity_score: Math.round(metrics.clarityScore),
                    is_new_streak_day: streakResult.isNewDay,
                    streak_count: streakResult.currentStreak,
                    ...getSessionCoachingExperimentProperties(),
                }, 'HIGH');
                // P1: read the controller's current terminal status FIRST. If it left a warning/error (e.g.
                // filler/metrics persistence failed → guardedStopStatus), preserve it — apply NEITHER the
                // stopReason NOR the ordinary success/streak copy. This holds for auto-stops (which carry a
                // stopReason) as well as manual stops. The controller owns the terminal status when
                // persistence is degraded; overwriting it would hide the failure.
                const controllerStatusType = useSessionStore.getState().sttStatus?.type;
                if (controllerStatusType === 'warning' || controllerStatusType === 'error') {
                    // preserve — no stopReason, no success copy
                } else if (options?.stopReason) {
                    setSTTStatus({ type: 'info', message: options.stopReason });
                } else {
                    const finalMsg = streakResult.isNewDay
                        ? ` 🔥 ${streakResult.currentStreak} Day Streak! Session saved.`
                        : '✓ Great practice! Session saved.';
                    setSTTStatus({ type: 'info', message: finalMsg });
                }

                void queryClient.invalidateQueries({ queryKey: ['usageLimit'] });
                void queryClient.invalidateQueries({ queryKey: ['sessionHistory'] });
                // Single-session detail cache: useSession(sessionId) keys on ['session', id]
                // with a 5-min staleTime and is read by the analytics detail view. Without
                // this invalidation it keeps serving the record-start placeholder transcript
                // (' '), so the detail transcript renders empty even though complete_session
                // wrote the real transcript. Mode-agnostic (affects Native + Private).
                void queryClient.invalidateQueries({ queryKey: ['session'] });
                void queryClient.invalidateQueries({ queryKey: ['sessionCount'] });
                setShowAnalyticsPrompt(true);

            } catch (error) {
                logger.error({ err: error }, '[useSessionLifecycle] Error stopping recording');
            } finally {
                hasAutoStoppedRef.current = false;
                setCaptureLimitReached(null); // #1089: the backstop signal is per-recording
                hasVADStoppedRef.current = false;
                isProcessingRef.current = false;
            }
        } else {
            // ✅ Starting: Reset guards FIRST (Robust synchronous reset)
            hasAutoStoppedRef.current = false;
            setCaptureLimitReached(null); // #1089: the backstop signal is per-recording
            // #1089: the PREVIOUS take's duration snapshot stops being current the moment a new
            // recording begins. Cleared here (start), never on stop — the post-save review needs it.
            setCompletedSessionDuration(null);
            hasVADStoppedRef.current = false;
            // #1046 G6/G7: drop the finished-brief snapshot the moment a NEW recording begins, so an Open Mic
            // (or a fresh Focus Points) session's after-state can never inherit the prior brief's coverage.
            useSessionStore.getState().setCompletedObjectiveBrief(null);
            lastActivityTimeRef.current = Date.now();

            if (usageLimit && !usageLimit.can_start) {
                // #1282 — a fail-closed expired trial returns the raw code 'trial_expired'; show a
                // human message instead. Recording is closed once the 30-day trial ends and the account
                // is unpaid; existing sessions, export and account management remain available.
                const rawError = usageLimit.error || 'Recording access is unavailable. Refresh and try again.';
                const errorMsg = rawError === 'trial_expired'
                    ? 'Your 30-day free trial has ended. Upgrade to keep recording — your saved sessions and exports stay available.'
                    : rawError;
                const prefix = errorMsg.startsWith('⚠️') || errorMsg.startsWith('⛔') ? '' : '⛔ ';
                setSTTStatus({ type: 'error', message: `${prefix}${errorMsg}` });
                isProcessingRef.current = false;
                return;
            }

            try {
                setSTTStatus({ type: 'idle', message: 'Ready to record' });

                // Mutex Check: Use the reactive store state updated by SpeechRuntimeController
                if (isLockHeldByOther) {
                    setSTTStatus({
                        type: 'error',
                        message: '⛔ Active session in another tab. Switch to that tab to continue.'
                    });
                    return;
                }

                // Expert Diagnostic
                if (ENV.isTest) {
                    logger.info({
                        isListening,
                        isProUser,
                        isLockHeldByOther,
                        canStart: usageLimit?.can_start,
                    }, '[SESSION_DIAG]');
                }

                if (typeof document !== 'undefined' && import.meta.env.DEV) {
                    if (!import.meta.env.PROD) {
                        document.body.setAttribute('data-user-tier', isProUser ? 'pro' : 'free');
                    }
                }

                // #1314 launch bar (0 silent stale-client execution): a tab that has been open across a deploy
                // keeps running its old bundle against a contract that has since changed — that is exactly how
                // the 2026-08-19 run reached the retained legacy completion overload and saved a session with no
                // next action and no filler metrics. Refuse to START rather than corrupt a recording, and say so
                // in the UI instead of leaving the user to guess or an agent to suggest a reload.
                // FAIL-CLOSED (PO ruling): a confirmed mismatch blocks, AND so does a production build we could
                // not verify after bounded retries — while the legacy transcript-writing RPC overload is still
                // callable, letting an unverifiable client record recreates the exact hazard. Only a local/dev
                // build (no real release id, nothing to compare against) proceeds unverified.
                const freshness = await checkClientFreshness();
                if (!canRecord(freshness.status)) {
                    analyticsBuffer.push('recording_blocked_stale_client', {
                        status: freshness.status,
                        running_release: freshness.running,
                        deployed_release: freshness.deployed,
                        attempts: freshness.attempts,
                    });
                    setSTTStatus({ type: 'error', message: blockedMessage(freshness.status) ?? '' });
                    return;
                }

                const currentRuntimeState = useSessionStore.getState().runtimeState;
                if (currentRuntimeState === 'ENGINE_INITIALIZING' || currentRuntimeState === 'INITIATING') {
                    await speechRuntimeController.whenStable();
                }

                // SpeechRuntimeController.startRecording() handles FSM, Service Init, and DB Session
                const requestedMode = useSessionStore.getState().sttMode ?? defaultMode;
                const latestMode = requestedMode;
                const selectedPolicy = buildPolicyForUser(canUsePrivateStt, latestMode);
                await speechRuntimeController.startRecording(selectedPolicy, userFillerWords);
                analyticsBuffer.push('session_started', {
                    mode: latestMode,
                    requested_mode: requestedMode,
                    user_tier: effectiveSubscriptionStatus,
                    ...getSessionCoachingExperimentProperties(),
                });
            } catch (error) {
                const err = error as Error;
                const requestedMode = useSessionStore.getState().sttMode ?? defaultMode;
                const latestMode = requestedMode;
                const message = getStartFailureMessage(err, latestMode);
                // #P1-observability: compute the sanitized engine-start leaf ONCE so both the Sentry
                // scope AND the PostHog recording_start_failed event carry the root-cause name. This
                // co-locates failure count + cause in analytics (Decision 1C) instead of leaving the
                // leaf only in Sentry. Name only — a DOMException type (e.g. NotReadableError); the
                // sanitizer never lets message/stack/url ride along.
                const startLeaf = sanitizeStartError((err as { cause?: unknown })?.cause);
                logger.error({ error: err, stack: err?.stack, mode: latestMode }, '[useSessionLifecycle] Failed to start recording');
                Sentry.withScope((scope) => {
                    // #P1-observability: surface the engine-start LEAF (mic / AudioWorklet / engine-init),
                    // not just the generic TRANSCRIPTION_START_DID_NOT_RECORD wrapper. The controller
                    // attaches the raw leaf as err.cause (Sentry links it in the exception chain); we ALSO
                    // add a sanitized, PII-scrubbed context/tag so it is filterable without info-level traces.
                    const wrapperMessage = err?.message ?? '';
                    const serviceState = wrapperMessage.startsWith('TRANSCRIPTION_START_DID_NOT_RECORD:')
                        ? wrapperMessage.slice('TRANSCRIPTION_START_DID_NOT_RECORD:'.length) || null
                        : null;
                    scope.setTag('surface', 'recording_start');
                    scope.setTag('failure_phase', 'recording_start');
                    scope.setTag('stt_mode', latestMode);
                    if (startLeaf) scope.setTag('start_leaf_name', startLeaf.name);
                    if (startLeaf) {
                        scope.setContext('start_leaf', {
                            name: startLeaf.name,
                            message: startLeaf.message,
                            frames: startLeaf.frames,
                        });
                    }
                    scope.setContext('recording_start', {
                        requestedMode,
                        latestMode,
                        canUseCloudStt,
                        canUsePrivateStt,
                        runtimeState,
                        service_state: serviceState,
                        userTier: effectiveSubscriptionStatus,
                    });
                    Sentry.captureException(err);
                });
                analyticsBuffer.push('recording_start_failed', {
                    mode: latestMode,
                    requested_mode: requestedMode,
                    runtime_state: runtimeState,
                    user_tier: effectiveSubscriptionStatus,
                    error_name: err?.name || 'Error',
                    error_message: err?.message || 'Unknown',
                    // #P1-observability (Decision 1C): root-cause leaf name co-located with the failure
                    // event so recording_start_failed is self-diagnosing without Sentry. Name only.
                    start_leaf_name: startLeaf?.name ?? null,
                    ...getSessionCoachingExperimentProperties(),
                });
                try {
                    await speechRuntimeController.reset('start_failed');
                } catch (resetError) {
                    logger.warn({ err: resetError }, '[useSessionLifecycle] Failed to reset after start error');
                }
                setSTTStatus({ type: 'error', message: `⚠️ ${message}` });
            } finally {
                isProcessingRef.current = false;
            }
        }
    }, [
        isListening,
        elapsedTime,
        setCaptureLimitReached,
        setCompletedSessionDuration,
        updateStreak,
        queryClient,
        isProUser,
        canUsePrivateStt,
        canUseCloudStt,
        usageLimit,
        defaultMode,
        effectiveMode,
        isLockHeldByOther,
        setSTTStatus,
        userFillerWords,
        runtimeState,
        effectiveSubscriptionStatus,
        metrics.clarityScore,
        metrics.fillerCount,
        metrics.wordCount,
        metrics.wpm,
    ]);

    // ✅ Keep the stable ref up to date with the latest callback
    handleStartStopRef.current = handleStartStop;

    // ✅ isMounted logic
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Timer logic: Heartbeat for the store's tick
    useEffect(() => {
        if (isListening) {
            const interval = setInterval(() => {
                tick();
                // #891 Phase 5.6 (SHADOW, PASSIVE): after the real tick, publish the authoritative session
                // clock so the shadow pace/clarity/score derivers share the legacy elapsedTime basis. Gated
                // OFF in production (zero cost) and error-swallowed; runs on this heartbeat, never on the
                // transcription/audio path.
                if (isShadowMetricsEngineEnabled()) {
                    const st = useSessionStore.getState();
                    const mode = toTelemetryMode(st.activeEngine ?? st.sttMode);
                    if (mode) publishTelemetry({ type: 'session.tick', mode, t: performance.now(), elapsedSeconds: st.elapsedTime });
                }
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [isListening, tick]);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const root = document.documentElement;
        const syncModelStatus = () => {
            setPrivateModelStatus(root.getAttribute('data-model-status') || 'idle');
        };
        syncModelStatus();

        const observer = new MutationObserver(syncModelStatus);
        observer.observe(root, { attributes: true, attributeFilter: ['data-model-status'] });
        return () => observer.disconnect();
    }, []);


    // #1089 CAPTURE BACKSTOP (data integrity). MAX_UTTERANCE_SECONDS is a hard memory ceiling that sits
    // STRICTLY ABOVE the recording cap, so a normal take never reaches it. If it IS reached — clock drift,
    // pause/resume, or a cap regression — the engine has already stopped accepting audio. Previously it
    // did so silently and the UI kept showing "Recording" while everything spoken past the guard was
    // discarded. Now we stop immediately, which finalizes and saves every sample captured BEFORE the
    // guard, and we tell the user plainly rather than pretending the recording continued.
    useEffect(() => {
        if (!captureLimitReached) return;
        // handleStartStop is a TOGGLE. A backstop event that arrives when nothing is recording — a late
        // frame during teardown, or any future producer — would fall into its START branch and create
        // exactly the stray recording this issue exists to eliminate. A system-generated stop must only
        // ever stop: if there is no live recording the event is stale, so clear it and do nothing.
        const live = useSessionStore.getState();
        const isRecordingNow = live.isListening || live.runtimeState === 'RECORDING';
        if (!isRecordingNow) {
            logger.warn(captureLimitReached, '[useSessionLifecycle] Stale capture-backstop event while not recording — cleared, no toggle');
            setCaptureLimitReached(null);
            return;
        }
        if (hasAutoStoppedRef.current) return;
        hasAutoStoppedRef.current = true;
        logger.warn(captureLimitReached, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: capture backstop reached');
        void handleStartStopRef.current?.({
            stopReason: 'We reached the maximum recording length and stopped. Everything recorded up to that point was saved.',
        });
    }, [captureLimitReached, setCaptureLimitReached]);

    // #891 beta recording length: a single Private take may run the full cap
    // (MAX_PRIVATE_RECORDING_SECONDS, now 600s = 10 min). This fires on WALL-CLOCK elapsedTime, so it
    // cannot early-fire from any duration over-count. It is a per-recording technical safety bound,
    // not an accumulated entitlement quota, and a new recording may start after finalization.
    // Warns 20s before the cap. The Stop→final decode wait is shown honestly via the Finalizing… state.
    useEffect(() => {
        if (effectiveMode !== 'private' || !isListening) return;
        const capRemaining = PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS - elapsedTime;

        if (capRemaining <= 0) {
            if (hasAutoStoppedRef.current) return;
            hasAutoStoppedRef.current = true;
            logger.warn({ elapsedTime }, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: Private per-recording cap reached');
            void handleStartStopRef.current?.({
                stopReason: 'Private recordings are capped at 10 minutes during beta. We stopped and saved your session.',
            });
        } else if (capRemaining <= PRIV_STT.PRIVATE_RECORDING_CAP_WARNING_SECONDS) {
            const warningMsg = `${Math.ceil(capRemaining)}s left — Private recordings are capped at 10 minutes during beta. We’ll stop and save automatically.`;
            if (sttStatus.message !== warningMsg) {
                setSTTStatus({ type: 'info', message: warningMsg });
            }
        }
    }, [effectiveMode, isListening, elapsedTime, sttStatus.message, setSTTStatus]);

    // VAD Auto-Pause Logic: 5 minutes of silence detected via transcript inactivity
    const lastTranscriptRef = useRef(transcript.transcript);
    const lastActivityTimeRef = useRef(Date.now());

    useEffect(() => {
        if (!isListening) {
            lastActivityTimeRef.current = Date.now();
            return;
        }

        lastActivityTimeRef.current = Date.now();

        if (transcript.transcript !== lastTranscriptRef.current) {
            lastTranscriptRef.current = transcript.transcript;
            lastActivityTimeRef.current = Date.now();
        }

        const inactivityLimit = 300 * 1000; // 5 minutes
        const checkInactivity = setInterval(() => {
            const now = Date.now();
            if (now - lastActivityTimeRef.current > inactivityLimit) {
                if (hasVADStoppedRef.current) return;
                hasVADStoppedRef.current = true;

                logger.warn({
                    now,
                    lastActivity: lastActivityTimeRef.current,
                    diff: now - lastActivityTimeRef.current
                }, '[useSessionLifecycle] 🔇 VAD AUTO-STOP: 5 minutes of silence detected');

                void handleStartStopRef.current?.({
                    stopReason: '🔇 Auto-paused due to 5 minutes of inactivity.'
                });
            }
        }, 1000);

        return () => clearInterval(checkInactivity);
    }, [isListening, transcript.transcript]);

    // Mode sync: follow the profile-derived default until the user explicitly
    // chooses a mode. This prevents a pre-profile native default from latching
    // for Pro users after profile hydration.
    useEffect(() => {
        if (!profileReadyForStt) return;

        if (
            isVerified &&
            !isListening &&
            (
                !sttMode || shouldPromoteNativeDefaultToPrivate
            )
        ) {
            modeSourceRef.current = 'default';
            setSTTMode(defaultMode);
        }
    }, [profileReadyForStt, isVerified, isListening, sttMode, defaultMode, shouldPromoteNativeDefaultToPrivate, setSTTMode]);

    useEffect(() => {
        if (isListening && activeEngine && activeEngine !== 'none' && activeEngine !== effectiveMode) {
            setSTTMode(activeEngine as TranscriptionMode);
        }
    }, [isListening, activeEngine, effectiveMode, setSTTMode]);

    const warmUpTriggered = useRef<string | null>(null);

    // Engine Warm-up: Pre-initialize engines when mode is selected
    useEffect(() => {
        pushE2EEvent('SESSION_LIFECYCLE_RENDER', { sttMode: effectiveMode, isListening });

        if (!profileReadyForStt) return;
        if (shouldPromoteNativeDefaultToPrivate) return;

        if (sttMode && !isListening && warmUpTriggered.current !== sttMode) {
            warmUpTriggered.current = sttMode;
            pushE2EEvent('SESSION_LIFECYCLE_WARMUP', { mode: sttMode });
            logger.info(`[useSessionLifecycle] Mode set to ${sttMode} - triggering warm-up`);
            void speechRuntimeController.warmUp(sttMode);
        }
    }, [effectiveMode, sttMode, isListening, profileReadyForStt, shouldPromoteNativeDefaultToPrivate]);

    useEffect(() => {
        return () => {
            // Reset trigger on unmount so navigation back re-triggers warm-up
            warmUpTriggered.current = null;
        };
    }, []);

    // #1258: after a BACKGROUND idle reclamation the engine is torn down to a clean idle state and is NOT
    // auto-reloaded (the `warmUpTriggered` guard above stays set, so no reclaim→reload loop). When the user
    // RETURNS (page becomes visible) and the engine was reclaimed to idle, perform exactly ONE explicit reload
    // so the mic becomes usable again, with the normal truthful download/loading UI. A still-ready (foreground-
    // preserved) or actively-recording engine is left untouched.
    // Tracks the reclamation token we have already reloaded for. Initialized (lazily, on first visibility
    // handling) to the controller's current token so we only ever react to reclamations that happen AFTER mount.
    const handledReclamationGen = useRef<number | null>(null);
    useEffect(() => {
        if (handledReclamationGen.current === null) {
            handledReclamationGen.current = speechRuntimeController.getIdleReclamationGeneration();
        }
        const onVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            const gen = speechRuntimeController.getIdleReclamationGeneration();
            // A CHANGE in the controller-owned token is the only thing that authorizes a reload — this is what
            // distinguishes "the engine was actually reclaimed while I was away" from "I just switched tabs".
            const hasPendingReclamation = gen !== (handledReclamationGen.current ?? gen);
            if (!shouldReloadSttOnForegroundReturn({
                visibilityState: document.visibilityState,
                profileReadyForStt,
                effectiveMode,
                isListening,
                shouldPromoteNativeDefaultToPrivate,
                hasPendingReclamation,
            })) return;
            // Consume this reclamation BEFORE issuing the reload → exactly one reload per reclamation and no
            // automatic looping even if the reload fails (the token will not re-authorize until a NEW reclamation).
            handledReclamationGen.current = gen;
            warmUpTriggered.current = effectiveMode;
            logger.info('[useSessionLifecycle] Page returned to foreground after a real reclamation — one explicit reload');
            speechRuntimeController.warmUp(effectiveMode).catch((err) => {
                // A failed reload must NOT be swallowed. Drive the DOM-derived model status to `init-failed` so
                // the recording controls (MicCard / MobileActionBar) render an ENABLED "Retry Private setup"
                // action routed to the setup entry point — the consumed token guarantees we do not silently loop.
                logger.warn({ err }, '[useSessionLifecycle] foreground-return reload failed — surfacing Private setup retry');
                if (typeof document !== 'undefined') {
                    document.documentElement.setAttribute('data-model-status', 'init-failed');
                }
                setSTTStatus({ type: 'init-failed', message: 'Private transcription setup did not complete.', detail: 'Retry the local model setup. Your audio stays on your machine.' });
            });
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [profileReadyForStt, effectiveMode, isListening, shouldPromoteNativeDefaultToPrivate, setSTTStatus]);

    // UI Cleanup on unmount
    // We ONLY detach listeners (subscriber_unmount) to handle React remounts.
    // Hard termination is handled at the Route level.
    useEffect(() => {
        return () => {
            logger.debug('[useSessionLifecycle] Component unmounting - Detaching listeners');
            if (isListeningRef.current) {
                logger.info('[useSessionLifecycle] Session active on unmount - stopping recording');
                void speechRuntimeController.stopRecording();
            }
            // Explicitly detach to prevent listener accumulation (Invariant #3)
            void speechRuntimeController.reset('subscriber_unmount');
        };
    }, []);

    return {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        privateModelStatus,
        activeMode,
        mode: effectiveMode,
        setMode: (m: TranscriptionMode) => {
            const safeMode = m;
            // #1033 (A): route EVERY engine change through the controller's single authoritative decision.
            // While a recording is locked/unresolved the change is rejected BEFORE the store is touched, so the
            // UI store mode, the controller policy, and the service policy all stay on the active engine — the
            // producer can never be swapped or restored mid-recording. Capture the prior mode first so the
            // transcript-clear decision below is not confused by requestModeChange having set the new mode.
            const store = useSessionStore.getState();
            const prevMode = store.sttMode;
            const prevSaved = store.sessionSaved;
            const nextPolicy = buildPolicyForUser(canUsePrivateStt, safeMode);
            const result = speechRuntimeController.requestModeChange(safeMode, nextPolicy);
            if (!result.accepted) {
                setSTTStatus({ type: 'info', message: 'Finish or discard your current recording before switching the transcription engine.' });
                return;
            }
            modeSourceRef.current = 'user';
            // Opt 2 (#772-safe, PR 1a): a MANUAL mode switch starts a fresh context. setSTTMode (called inside
            // requestModeChange) intentionally preserves a just-saved transcript during internal normalization,
            // so on a user-initiated test-mode switch we clear the
            // prior visible transcript here so stale text does not carry into the new mode.
            if (prevSaved && prevMode !== safeMode) {
                const s = useSessionStore.getState();
                s.updateTranscript('', '');
                s.setChunks([]);
            }
            speechRuntimeController.syncForensicState();
        },
        recordingIntent: isRecordingIntent,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        setShowAnalyticsPrompt,
        sessionFeedbackMessage: sttStatus.message,
        pauseMetrics,
        micLevel,
        hasSpeechActivity,
        transcriptContent: transcript.transcript,
        interimTranscript,
        fillerData,
        isProUser,
        canUsePrivateStt,
        canUseCloudStt,
        activeEngine,
        // #1089: runtimeState alone is NOT sufficient — it returns to READY while finalization is still
        // running, which is exactly the window that produced the stray recording. Ready means genuinely
        // ready, so finalization keeps the control non-interactive.
        isButtonDisabled: !['IDLE', 'READY', 'RECORDING', 'FAILED', 'FAILED_VISIBLE', 'TERMINATED'].includes(runtimeState)
            || isTranscriptFinalizing
            || isPrivateStartBlockedByModelState,
        usageLimit,
        history,
        profileLoading: false,
        profileError: null
    };
};
