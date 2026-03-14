import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import posthog from 'posthog-js';
import logger from '@/lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useProfile } from './useProfile';
import { useSessionStore } from '../stores/useSessionStore';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useSessionManager } from './useSessionManager';
import { useSessionMetrics } from './useSessionMetrics';
import { useUsageLimit } from './useUsageLimit';
import { useStreak } from './useStreak';
import { useUserFillerWords } from './useUserFillerWords';
import { isPro } from '@/constants/subscriptionTiers';
import { buildPolicyForUser } from '@/services/transcription/TranscriptionPolicy';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useActiveSessionLock } from './useActiveSessionLock';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import type { Chunk } from './useSpeechRecognition/types';
import { TestFlags } from '@/config/TestFlags';

export const useSessionLifecycle = () => {
    const { session } = useAuthProvider();
    const { profile, isVerified } = useProfile();
    const queryClient = useQueryClient();
    const tick = useSessionStore(state => state.tick);
    const elapsedTime = useSessionStore(state => state.elapsedTime);
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { saveSession } = useSessionManager();
    const { userFillerWords } = useUserFillerWords();
    const stopSession = useSessionStore(state => state.stopSession);
    const activeEngine = useSessionStore(state => state.activeEngine);
    const { service } = useTranscriptionContext();
    const { acquireLock, releaseLock } = useActiveSessionLock();

    const isProUser = isPro(profile?.subscription_status);

    const [mode, setMode] = useState<'cloud' | 'native' | 'private'>('native');
    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const [sessionFeedbackMessage, setSessionFeedbackMessage] = useState<string | null>(null);
    const [sunsetModal, setSunsetModal] = useState<{ type: 'daily' | 'monthly'; open: boolean }>({ type: 'daily', open: false });
    const isProcessingRef = useRef(false);
    const isMounted = useRef(false);

    // Stable ref for handleStartStop to prevent dependency loops
    const handleStartStopRef = useRef<((options?: { skipRedirect?: boolean; stopReason?: string }) => Promise<void>) | null>(null);

    // Guards to prevent double stops in the same session
    const hasAutoStoppedRef = useRef(false);
    const hasVADStoppedRef = useRef(false);

    const speechConfig = useMemo(() => ({
        userWords: userFillerWords,
        userVocabulary: userFillerWords,
        session,
        profile,
        profileLoading: false // Guaranteed by ProfileGuard
    }), [userFillerWords, session, profile]);

    const speechRecognition = useSpeechRecognition(speechConfig);
    const {
        transcript,
        chunks,
        fillerData,
        startListening,
        stopListening,
        isListening,
        isReady,
        modelLoadingProgress,
        sttStatus,
        mode: activeMode,
        pauseMetrics
    } = speechRecognition;

    // ✅ STABLE REFS for cleanup effects - defined AFTER speechRecognition
    const isListeningRef = useRef(isListening);
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    const stopListeningRef = useRef(stopListening);
    useEffect(() => {
        stopListeningRef.current = stopListening;
    }, [stopListening]);

    const metrics = useSessionMetrics({
        transcript: transcript.transcript,
        chunks: chunks as Chunk[],
        fillerData: fillerData as FillerCounts,
        elapsedTime,
    });

    const handleStartStop = useCallback(async (options?: { skipRedirect?: boolean; stopReason?: string }) => {
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        if (isListening) {
            // Immediate UI flip and lock release
            // This prevents ANY hang or service promise from delaying the button reversion.
            stopSession();
            releaseLock();
            if (TestFlags.IS_TEST_MODE) {
                (window as unknown as { __lockAcquired__?: boolean }).__lockAcquired__ = false;
            }

            // Bypass minimum duration check if there is an external stop reason (e.g. tier limits)
            if (elapsedTime < MIN_SESSION_DURATION_SECONDS && !options?.stopReason) {
                await stopListening();
                setShowAnalyticsPrompt(false);
                setSessionFeedbackMessage(`⚠️ Session too short (${elapsedTime}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required.`);
                isProcessingRef.current = false;
                return;
            }

            try {
                // stopListening() performs async engine cleanup but store state is already flipped
                const finalStats = await stopListening();

                if (!finalStats) {
                    logger.warn('[useSessionLifecycle] stopListening returned null, skipping save');
                    return;
                }

                // ... (stats calculation and save logic)

                // ... (rest of stats calculation and save logic)
                const finalWpm = finalStats.duration > 0
                    ? Math.round((finalStats.total_words / finalStats.duration) * 60)
                    : 0;

                const finalFillerCount = Object.entries(finalStats.filler_words)
                    .filter(([key]) => key !== 'total')
                    .reduce((sum, [, data]) => sum + (data?.count ?? 0), 0);

                posthog.capture('session_ended', {
                    duration: elapsedTime,
                    wpm: finalWpm,
                    clarity_score: finalStats.accuracy,
                    filler_count: finalFillerCount
                });

                const streakResult = updateStreak();
                const engineType = (activeEngine === 'cloud') ? 'cloud' : 'native';

                // ✅ SURGICAL FIX 4: FSM & Mount Guards
                // Only save if FSM confirms STOPPING state and component is still mounted
                const currentState = service?.getState();
                if (currentState !== 'STOPPING' && currentState !== 'READY') {
                    logger.warn(`[useSessionLifecycle] saveSession skipped — FSM in ${currentState} state (expected STOPPING/READY)`);
                    return;
                }

                // ✅ TRACE: Log mount state for debugging
                logger.debug({ isMounted: isMounted.current, currentState }, '[useSessionLifecycle] Proceeding to saveSession');

                // We allow saveSession to proceed even if unmounted to ensure persistence,
                // but we guard the UI state updates.
                const result = await saveSession({
                    id: service?.getSessionId() || undefined,
                    transcript: finalStats.transcript,
                    duration: elapsedTime,
                    filler_words: finalStats.filler_words as FillerCounts,
                    wpm: finalWpm,
                    clarity_score: finalStats.accuracy,
                    title: `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
                    engine: (activeEngine || 'unknown') as string
                }, engineType);

                if (result.session) {
                    let finalMsg = streakResult.isNewDay
                        ? ` 🔥 ${streakResult.currentStreak} Day Streak! Session saved.`
                        : '✓ Great practice! Session saved.';

                    if (options?.stopReason) {
                        finalMsg = options.stopReason;
                    }

                    setSessionFeedbackMessage(finalMsg);
                    queryClient.invalidateQueries({ queryKey: ['usageLimit'] });
                    queryClient.invalidateQueries({ queryKey: ['sessionHistory'] });
                    queryClient.invalidateQueries({ queryKey: ['sessionCount'] });
                    setShowAnalyticsPrompt(true);

                    // ✅ E2E SIGNAL: Stable attribute for test runners to wait for
                    (window as unknown as { __E2E_LAST_SAVED_SESSION__?: string }).__E2E_LAST_SAVED_SESSION__ = result.session.id;
                    document.documentElement.setAttribute('data-session-saved', 'true');
                    setTimeout(() => {
                        // Clear signal after a delay to allow tests to catch it but not persist forever
                        if (document.documentElement.getAttribute('data-session-saved') === 'true') {
                            document.documentElement.removeAttribute('data-session-saved');
                        }
                    }, 10000);
                } else {
                    // Handle save failure if necessary, though saveSession typically throws on error
                    logger.error({ result }, '[useSessionLifecycle] Session save did not return a session object.');
                    setSessionFeedbackMessage('⚠️ Failed to save session.');
                }

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

            if (!isProUser && usageLimit && !usageLimit.can_start) {
                const errorMsg = usageLimit.error || 'Daily usage limit reached.';
                const prefix = errorMsg.startsWith('⚠️') || errorMsg.startsWith('⛔') ? '' : '⛔ ';
                setSessionFeedbackMessage(`${prefix}${errorMsg}`);
                isProcessingRef.current = false;
                return;
            }

            try {
                setSessionFeedbackMessage(null);

                // Mutex Check: Prevent multi-tab session bypass for ALL users
                const lockAcquired = acquireLock();

                // ✅ Expert Diagnostic: Structured logging for state machine observability
                if (TestFlags.IS_TEST_MODE) {
                    logger.info({
                        isListening,
                        isProUser,
                        lockAcquired,
                        remaining_seconds: usageLimit?.remaining_seconds,
                        hasAutoStopped: hasAutoStoppedRef.current,
                        hasVADStopped: hasVADStoppedRef.current
                    }, '[SESSION_DIAG]');
                }

                // Mutex is enforced for all users to prevent parallel session state corruption
                if (!lockAcquired) {
                    setSessionFeedbackMessage('⛔ Active session in another tab. Switch to that tab to continue.');
                    if (TestFlags.IS_TEST_MODE) {
                        (window as { __lockAcquired__?: boolean }).__lockAcquired__ = false;
                    }
                    return;
                }

                // ✅ Lock acquired – signal to E2E
                if (TestFlags.IS_TEST_MODE) {
                    (window as { __lockAcquired__?: boolean }).__lockAcquired__ = true;
                }

                const policy = buildPolicyForUser(isProUser, mode);
                await startListening(policy);
                posthog.capture('session_started', { mode });
            } finally {
                isProcessingRef.current = false;
            }
        }
    }, [isListening, elapsedTime, stopListening, updateStreak, saveSession, queryClient, isProUser, usageLimit, mode, activeEngine, startListening, acquireLock, stopSession, releaseLock, service]);

    // ✅ Keep the stable ref up to date with the latest callback (Synchronous to avoid effect race)
    handleStartStopRef.current = handleStartStop;

    // ✅ isMounted logic
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // ✅ Reset guards when starting a new session
    useEffect(() => {
        if (isListening) {
            hasAutoStoppedRef.current = false;
            hasVADStoppedRef.current = false;
        }
    }, [isListening]);

    // Timer logic: Heartbeat for the store's tick
    useEffect(() => {
        if (isListening) {
            const interval = setInterval(() => {
                tick();
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [isListening, tick]);



    // Tier enforcement: Auto-stop and 5-minute Warning
    useEffect(() => {
        // ✅ GUARANTEE: Never enforce limits for Pro users or if unlimited flag (-1) is present.
        // ✅ HYDRATION GUARD: Don't enforce until profile isVerified
        if (!isVerified || isProUser || (usageLimit && usageLimit.remaining_seconds === -1)) return;

        if (isListening && usageLimit && typeof usageLimit.remaining_seconds === 'number' && usageLimit.remaining_seconds > 0) {
            const remaining = usageLimit.remaining_seconds - elapsedTime;

            // 5-minute warning (300 seconds)
            if (remaining > 0 && remaining <= 300) {
                const minutes = Math.ceil(remaining / 60);
                const warningMsg = `⚠️ Great session! ${minutes} minute${minutes > 1 ? 's' : ''} remaining for today's practice limit.`;
                if (sessionFeedbackMessage !== warningMsg) {
                    setSessionFeedbackMessage(warningMsg);
                    posthog.capture('session_limit_warning', { remaining_seconds: remaining });
                }
            } else if (remaining <= 0) {
                // ✅ GUARD: Only auto-stop once per session
                if (hasAutoStoppedRef.current) return;
                hasAutoStoppedRef.current = true;

                logger.warn({ elapsedTime, remaining }, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: limit reached');

                // Determine modal type
                const isMonthly = usageLimit.monthly_remaining <= 0;
                setSunsetModal({ type: isMonthly ? 'monthly' : 'daily', open: true });

                // ✅ Use stable ref to prevent re-triggering the effect
                handleStartStopRef.current?.({
                    stopReason: "⛔ Daily usage limit reached."
                });
            }
        }
    }, [elapsedTime, isListening, usageLimit, sessionFeedbackMessage, isProUser, isVerified]);

    // VAD Auto-Pause Logic: 5 minutes of silence detected via transcript inactivity
    const lastTranscriptRef = useRef(transcript.transcript);
    const lastActivityTimeRef = useRef(Date.now());

    useEffect(() => {
        if (!isListening) {
            lastActivityTimeRef.current = Date.now();
            return;
        }

        if (transcript.transcript !== lastTranscriptRef.current) {
            lastTranscriptRef.current = transcript.transcript;
            lastActivityTimeRef.current = Date.now();
        }

        const inactivityLimit = 300 * 1000; // 5 minutes
        const checkInactivity = setInterval(() => {
            const now = Date.now();
            if (now - lastActivityTimeRef.current > inactivityLimit) {
                // ✅ GUARD: Only auto-stop once
                if (hasVADStoppedRef.current) return;
                hasVADStoppedRef.current = true;

                logger.warn({
                    now,
                    lastActivity: lastActivityTimeRef.current,
                    diff: now - lastActivityTimeRef.current
                }, '[useSessionLifecycle] 🔇 VAD AUTO-STOP: 5 minutes of silence detected');

                // ✅ Use stable ref
                handleStartStopRef.current?.({
                    stopReason: '🔇 Auto-paused due to 5 minutes of inactivity.'
                });
            }
        }, 1000); // Check more frequently in dev/test

        return () => clearInterval(checkInactivity);
    }, [isListening, transcript.transcript]); // Removed handleStartStop dependency

    // Ensure lock is released on unmount
    useEffect(() => {
        const currentLockRelease = releaseLock;
        return () => {
            // Note: handleStartStop handles releaseLock for normal stops.
            // This is only for the "unmount while listening" case.
            if (isListeningRef.current) currentLockRelease();
        };
    }, [releaseLock]); // releaseLock is stable from useActiveSessionLock

    // Mode sync: Ensure UI and Engine mode stay aligned
    useEffect(() => {
        if (isListening && activeEngine && activeEngine !== 'none' && activeEngine !== mode) {
            setMode(activeEngine as 'cloud' | 'native' | 'private');
        }
    }, [isListening, activeEngine, mode]);

    // Engine Warm-up: Pre-initialize heavy engines (WASM) when mode is selected
    useEffect(() => {
        if (mode === 'private' && service && !isListening) {
            logger.info('[useSessionLifecycle] Mode set to private - triggering warm-up');
            service.warmUp('private');
        }
    }, [mode, service, isListening]);

    // Cleanup on unmount - TRULY only on unmount
    useEffect(() => {
        // Reset save signal on mount to ensure we don't catch a previous session's signal
        document.documentElement.removeAttribute('data-session-saved');

        return () => {
            logger.debug('[useSessionLifecycle] Component unmounting - Cleanup running');
            if (isListeningRef.current) {
                logger.debug('[useSessionLifecycle] Session active on unmount - forcing save');
                stopListeningRef.current(); 
            }
        };
    }, []); // Empty dependencies! Truly only on unmount.

    return {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        activeMode,
        mode,
        setMode,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        setShowAnalyticsPrompt,
        sessionFeedbackMessage,
        setSessionFeedbackMessage,
        sunsetModal,
        setSunsetModal,
        pauseMetrics,
        transcriptContent: transcript.transcript,
        fillerData,
        isProUser,
        activeEngine,
        isButtonDisabled: isListening && !isReady, // Only disable IF we have started (isListening) but aren't yet ready. Always allow start (when !isListening) and always allow stop (once ready or if error occurs).
        showPromoExpiredDialog: !!usageLimit?.promo_just_expired,
        usageLimit,
        profileLoading: false,
        profileError: null
    };
};
