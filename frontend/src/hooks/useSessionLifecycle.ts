import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as Sentry from '@sentry/react';
import logger from '../lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useProfile } from './useProfile';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSpeechRecognition } from './useSpeechRecognition';
import { pushE2EEvent } from '@/lib/e2eProbe';
import { useSessionMetrics } from './useSessionMetrics';
import { useUsageLimit, type UsageLimitCheck } from './useUsageLimit';
import { useStreak } from './useStreak';
import { useUserFillerWords } from './useUserFillerWords';
import { getEffectiveSubscriptionStatus, hasCloudSttEntitlement, isPro } from '@/constants/subscriptionTiers';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import { PRIV_STT } from '@/services/transcription/sttConstants';
import { buildPolicyForUser, type TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { ENV } from '@/config/TestFlags';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { getSessionCoachingExperimentProperties } from '@/services/sessionCoachingExperiment';
import {
    PRIVATE_SAMPLE_EVENTS,
    emitPrivateSample,
    setPrivateSampleContext,
    clearPrivateSampleContext,
    buildSampleEnvProps,
} from '@/services/transcription/privateSampleTelemetry';

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

    if (mode === 'cloud') {
        return 'Cloud transcription could not start. Try again, or switch to Private or Native.';
    }

    return rawMessage || 'Recording could not start. Try again.';
};

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
    const privateSampleRemainingSeconds = Math.max(0, usageLimit?.private_sample_seconds_remaining ?? 0);
    const hasPrivateSampleEntitlement = usageLimit?.private_sample_available === true && privateSampleRemainingSeconds > 0;
    const canUsePrivateStt = isProUser || hasPrivateSampleEntitlement;
    const canUseCloudStt = isProUser && hasCloudSttEntitlement(profile);
    const shouldForceNativeMode = (ENV.isE2E && typeof window !== 'undefined' && window.__SS_E2E__?.forceNativeMode === true) || !canUsePrivateStt;
    const profileReadyForStt = isVerified && !!profile?.id && typeof profile?.subscription_status === 'string';

    const sttStatus = useSessionStore(state => state.sttStatus);
    const setSTTStatus = useSessionStore(state => state.setSTTStatus);
    const sttMode = useSessionStore(state => state.sttMode);
    const setSTTMode = useSessionStore(state => state.setSTTMode);
    const sunsetModal = useSessionStore(state => state.sunsetModal);
    const setSunsetModal = useSessionStore(state => state.setSunsetModal);
    // First-use trust fix (paid soft launch, Option A): fresh/default sessions start
    // on the instant Browser/Native path so a new user never hits the Private model-
    // setup wall before their first transcript. Private stays available as an explicit
    // user-selected mode. No mode persistence in this release — every new session
    // defaults to Native; a Pro user opts into Private per session.
    const defaultMode: TranscriptionMode = 'native';
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
    // Private-sample telemetry tracking: did a private sample recording start, and when.
    const privateSampleActiveRef = useRef(false);
    const recordingStartTsRef = useRef(0);
    const firstTextSeenRef = useRef(false);
    // If the user navigates away / unmounts mid-private-sample without saving, record it.
    useEffect(() => {
        const onPageHide = () => {
            if (privateSampleActiveRef.current) {
                emitPrivateSample(PRIVATE_SAMPLE_EVENTS.ABANDONED_UNSAVED);
                privateSampleActiveRef.current = false;
            }
        };
        window.addEventListener('pagehide', onPageHide);
        return () => {
            window.removeEventListener('pagehide', onPageHide);
            if (privateSampleActiveRef.current) {
                emitPrivateSample(PRIVATE_SAMPLE_EVENTS.ABANDONED_UNSAVED);
                privateSampleActiveRef.current = false;
                clearPrivateSampleContext();
            }
        };
    }, []);
    const modeSourceRef = useRef<'default' | 'user' | null>(null);

    const speechConfig = useMemo(() => ({
        userWords: userFillerWords,
        userVocabulary: userFillerWords,
        session,
        profile,
        profileLoading: false // Guaranteed by ProfileGuard
    }), [userFillerWords, session, profile]);

    const isListening = useSessionStore(state => state.isListening);
    const history = useSessionStore(state => state.history);
    // First-use trust fix (Option A): do NOT auto-promote a fresh Native default to
    // Private. Private is now an explicit user choice, so a new user is never pushed
    // into the model-setup wall before their first transcript. Kept as a named flag
    // so the dependent effects and their dependency arrays are otherwise unchanged.
    const shouldPromoteNativeDefaultToPrivate = false;

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
    });

    const handleStartStop = useCallback(async (options?: { skipRedirect?: boolean; stopReason?: string }) => {
        const latestSessionState = useSessionStore.getState();
        const latestRuntimeState = latestSessionState.runtimeState;
        const shouldStop = latestSessionState.isListening || latestRuntimeState === 'RECORDING' || latestRuntimeState === 'STOPPING';

        if (isProcessingRef.current && !shouldStop) return;
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
                if (privateSampleActiveRef.current) {
                    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STOPPED, { recording_duration_seconds: elapsedTime });
                    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.ABANDONED_UNSAVED, { recording_duration_seconds: elapsedTime });
                    privateSampleActiveRef.current = false;
                    clearPrivateSampleContext();
                }
                isProcessingRef.current = false;
                return;
            }

            try {
                // SpeechRuntimeController.stopRecording() handles enriched finalization,
                // metrics, streak updates, and optimistic usage sync atomically.
                const stopResult = await speechRuntimeController.stopRecording();

                if (!stopResult) {
                    setShowAnalyticsPrompt(false);
                    if (privateSampleActiveRef.current) {
                        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.ABANDONED_UNSAVED);
                        privateSampleActiveRef.current = false;
                        clearPrivateSampleContext();
                    }
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
                if (effectiveMode === 'private' && privateSampleActiveRef.current) {
                    const sampleDuration = recordingStartTsRef.current
                        ? Math.round((Date.now() - recordingStartTsRef.current) / 1000)
                        : elapsedTime;
                    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STOPPED, { recording_duration_seconds: sampleDuration });
                    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.SAVED, {
                        recording_duration_seconds: sampleDuration,
                        word_count: metrics.wordCount,
                        save_success: true,
                    });
                    // usage_updated/exhausted emitted here (context still set, before clear) so the
                    // sample's consumption is recorded reliably regardless of cache/usage-sync timing.
                    {
                        const sampleLimit = usageLimit?.private_sample_limit_seconds ?? null;
                        const priorUsed = typeof usageLimit?.private_sample_seconds_used === 'number'
                            ? usageLimit.private_sample_seconds_used
                            : 0;
                        const used = priorUsed + sampleDuration;
                        const remaining = sampleLimit != null
                            ? Math.max(0, sampleLimit - used)
                            : (usageLimit?.private_sample_seconds_remaining ?? null);
                        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.USAGE_UPDATED, {
                            sample_seconds_used: used,
                            sample_seconds_remaining: remaining,
                        });
                        if (remaining != null && remaining <= 0) {
                            emitPrivateSample(PRIVATE_SAMPLE_EVENTS.EXHAUSTED, { sample_seconds_used: used });
                        }
                    }
                    privateSampleActiveRef.current = false;
                    clearPrivateSampleContext();
                }

                if (options?.stopReason) {
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
                hasVADStoppedRef.current = false;
                isProcessingRef.current = false;
            }
        } else {
            // ✅ Starting: Reset guards FIRST (Robust synchronous reset)
            hasAutoStoppedRef.current = false;
            hasVADStoppedRef.current = false;
            lastActivityTimeRef.current = Date.now();

            if (usageLimit && !usageLimit.can_start) {
                const errorMsg = usageLimit.error || 'Daily usage limit reached.';
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
                        remaining_seconds: usageLimit?.remaining_seconds,
                    }, '[SESSION_DIAG]');
                }

                if (typeof document !== 'undefined' && import.meta.env.DEV) {
                    if (!import.meta.env.PROD) {
                        document.body.setAttribute('data-user-tier', isProUser ? 'pro' : 'free');
                    }
                }

                const currentRuntimeState = useSessionStore.getState().runtimeState;
                if (currentRuntimeState === 'ENGINE_INITIALIZING' || currentRuntimeState === 'INITIATING') {
                    await speechRuntimeController.whenStable();
                }

                // SpeechRuntimeController.startRecording() handles FSM, Service Init, and DB Session
                const requestedMode = useSessionStore.getState().sttMode ?? defaultMode;
                const latestMode = requestedMode === 'cloud' && !canUseCloudStt ? defaultMode : requestedMode;
                const selectedPolicy = buildPolicyForUser(canUsePrivateStt, latestMode, { allowCloud: canUseCloudStt });
                await speechRuntimeController.startRecording(selectedPolicy, userFillerWords);
                analyticsBuffer.push('session_started', {
                    mode: latestMode,
                    requested_mode: requestedMode,
                    user_tier: effectiveSubscriptionStatus,
                    ...getSessionCoachingExperimentProperties(),
                });
                if (latestMode === 'private') {
                    // Set the resolved arm/assignment context, then emit recording_started.
                    speechRuntimeController.applyPrivateSampleContext();
                    recordingStartTsRef.current = Date.now();
                    setPrivateSampleContext({
                        sample_limit_seconds: usageLimit?.private_sample_limit_seconds ?? null,
                        recording_start_ts: recordingStartTsRef.current,
                    });
                    privateSampleActiveRef.current = true;
                    firstTextSeenRef.current = false;
                    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.RECORDING_STARTED, { ...buildSampleEnvProps() });
                }
            } catch (error) {
                const err = error as Error;
                const requestedMode = useSessionStore.getState().sttMode ?? defaultMode;
                const latestMode = requestedMode === 'cloud' && !canUseCloudStt ? defaultMode : requestedMode;
                const message = getStartFailureMessage(err, latestMode);
                logger.error({ error: err, stack: err?.stack, mode: latestMode }, '[useSessionLifecycle] Failed to start recording');
                Sentry.withScope((scope) => {
                    scope.setTag('surface', 'recording_start');
                    scope.setTag('stt_mode', latestMode);
                    scope.setContext('recording_start', {
                        requestedMode,
                        latestMode,
                        canUseCloudStt,
                        canUsePrivateStt,
                        runtimeState,
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
                    ...getSessionCoachingExperimentProperties(),
                });
                if (latestMode === 'private') {
                    emitPrivateSample(PRIVATE_SAMPLE_EVENTS.ERROR, { error_code: err?.name || 'Error' });
                    privateSampleActiveRef.current = false;
                    clearPrivateSampleContext();
                }
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


    // Tier enforcement: auto-stop paid practice limits and the one-session
    // unpaid Private sample. The sample has its own countdown/copy so users do
    // not confuse it with the free Browser path.
    useEffect(() => {
        if (!isVerified || !usageLimit) return;

        // A Private sample recording stays a sample recording for its whole duration.
        // `private_sample_available` flips to false once `private_sample_session_id` is
        // set (sample in progress), so a mid-recording entitlement refetch must NOT make
        // the countdown/auto-stop fall back to the free daily limit. Treat any in-progress
        // sample (seconds remaining > 0) as a sample recording regardless of the
        // post-start availability flag.
        const isPrivateSampleRecording = effectiveMode === 'private'
            && !isProUser
            && typeof usageLimit.private_sample_seconds_remaining === 'number'
            && (usageLimit.private_sample_available === true
                || usageLimit.private_sample_seconds_remaining > 0);
        const sourceRemaining = isPrivateSampleRecording
            ? usageLimit.private_sample_seconds_remaining
            : isProUser && typeof usageLimit.daily_remaining === 'number'
            ? usageLimit.daily_remaining
            : usageLimit.remaining_seconds;

        if (sourceRemaining === -1 || !Number.isFinite(sourceRemaining)) return;

        if (isListening && typeof sourceRemaining === 'number' && sourceRemaining > 0) {
            const remaining = sourceRemaining - elapsedTime;
            const warningThresholdSeconds = isPrivateSampleRecording ? 60 : 300;

            if (remaining > 0 && remaining <= warningThresholdSeconds) {
                const minutes = Math.ceil(remaining / 60);
                const warningMsg = isPrivateSampleRecording
                    ? '1 minute left in your Private sample. We’ll stop and save when time runs out.'
                    : `⚠️ Great practice! ${minutes} minute${minutes > 1 ? 's' : ''} remaining for today's ${isProUser ? 'Pro ' : ''}practice limit.`;
                if (sttStatus.message !== warningMsg) {
                    setSTTStatus({ type: 'info', message: warningMsg });
                    analyticsBuffer.push('session_limit_warning', {
                        remaining_seconds: remaining,
                        tier: isProUser ? 'pro' : 'free',
                        limit_type: isPrivateSampleRecording ? 'private_sample' : 'daily',
                        ...getSessionCoachingExperimentProperties(),
                    });
                }
            } else if (remaining <= 0) {
                if (hasAutoStoppedRef.current) return;
                hasAutoStoppedRef.current = true;

                logger.warn({ elapsedTime, remaining }, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: limit reached');

                if (!isPrivateSampleRecording) {
                    const isMonthly = usageLimit.monthly_remaining <= 0;
                    setSunsetModal({ type: isMonthly ? 'monthly' : 'daily', open: true });
                }

                void handleStartStopRef.current?.({
                    stopReason: isPrivateSampleRecording
                        ? 'Your Private sample ended. We stopped and saved your session. Browser transcription is still available.'
                        : isProUser
                        ? "⛔ Pro daily practice limit reached."
                        : "⛔ Daily usage limit reached."
                });
            }
        }
    }, [elapsedTime, effectiveMode, isListening, usageLimit, sttStatus.message, isProUser, isVerified, setSTTStatus, setSunsetModal]);

    // #891 beta latency control: cap a SINGLE Private recording at 90s so the Stop re-decode stays
    // under the 30s ceiling. Independent of the usage allowance above — whichever limit (budget or
    // 90s cap) is hit first triggers the single auto-stop (shared hasAutoStoppedRef). The 5-min
    // Private sample budget is unchanged; this only bounds one take. Warns 15s before the cap.
    useEffect(() => {
        if (effectiveMode !== 'private' || !isListening) return;
        const capRemaining = PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS - elapsedTime;

        if (capRemaining <= 0) {
            if (hasAutoStoppedRef.current) return;
            hasAutoStoppedRef.current = true;
            logger.warn({ elapsedTime }, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: Private 90s per-recording cap reached');
            void handleStartStopRef.current?.({
                stopReason: 'Private recordings are capped at 90 seconds during beta. We stopped and saved your session.',
            });
        } else if (capRemaining <= PRIV_STT.PRIVATE_RECORDING_CAP_WARNING_SECONDS) {
            const warningMsg = `${Math.ceil(capRemaining)}s left — Private recordings are capped at 90s during beta. We’ll stop and save automatically.`;
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
            // First non-empty transcript of a Private sample → measure time-to-first-text.
            if (privateSampleActiveRef.current && !firstTextSeenRef.current && transcript.transcript.trim().length > 0) {
                firstTextSeenRef.current = true;
                emitPrivateSample(PRIVATE_SAMPLE_EVENTS.FIRST_TRANSCRIPT_SEEN, {
                    time_to_first_text_ms: recordingStartTsRef.current ? Math.max(0, Date.now() - recordingStartTsRef.current) : null,
                });
            }
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

        if (isVerified && !isListening && shouldForceNativeMode && sttMode && sttMode !== 'native') {
            modeSourceRef.current = 'default';
            setSTTMode('native');
            if (sttStatus.type === 'error') {
                setSTTStatus({ type: 'ready', message: 'Ready to record' });
            }
            return;
        }

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
    }, [profileReadyForStt, isVerified, isListening, shouldForceNativeMode, sttMode, sttStatus.type, defaultMode, shouldPromoteNativeDefaultToPrivate, setSTTMode, setSTTStatus]);

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
            const safeMode = m === 'cloud' && !canUseCloudStt ? defaultMode : m;
            modeSourceRef.current = 'user';
            // Opt 2 (#772-safe, PR 1a): a MANUAL mode switch starts a fresh context. setSTTMode
            // intentionally preserves a just-saved transcript for the AUTOMATIC #772 Private-sample
            // force-switch (guarded by sessionSaved), so on a user-initiated switch we clear the
            // prior visible transcript here so stale text does not carry into the new mode.
            // setSTTMode's global behavior and the #772 auto-switch path are left unchanged.
            const store = useSessionStore.getState();
            if (store.sessionSaved && store.sttMode !== safeMode) {
                store.updateTranscript('', '');
                store.setChunks([]);
            }
            setSTTMode(safeMode);
            speechRuntimeController.updatePolicy(buildPolicyForUser(canUsePrivateStt, safeMode, { allowCloud: canUseCloudStt }));
            speechRuntimeController.syncForensicState();
        },
        recordingIntent: isRecordingIntent,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        setShowAnalyticsPrompt,
        sessionFeedbackMessage: sttStatus.message,
        sunsetModal,
        setSunsetModal,
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
        isButtonDisabled: !['IDLE', 'READY', 'RECORDING', 'FAILED', 'FAILED_VISIBLE', 'TERMINATED'].includes(runtimeState)
            || isPrivateStartBlockedByModelState,
        usageLimit,
        history,
        profileLoading: false,
        profileError: null
    };
};
