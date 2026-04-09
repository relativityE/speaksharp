import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import posthog from 'posthog-js';
import logger from '../lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useProfile } from './useProfile';
import { useSessionStore } from '../stores/useSessionStore';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useSessionMetrics } from './useSessionMetrics';
import { useUsageLimit } from './useUsageLimit';
import { useStreak } from './useStreak';
import { useUserFillerWords } from './useUserFillerWords';
import { isPro } from '@/constants/subscriptionTiers';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { ENV } from '@/config/TestFlags';

export const useSessionLifecycle = () => {
    const { session } = useAuthProvider();
    const { profile, isVerified } = useProfile();
    const queryClient = useQueryClient();
    const tick = useSessionStore(state => state.tick);
    const elapsedTime = useSessionStore(state => state.elapsedTime);
    const isLockHeldByOther = useSessionStore(state => state.isLockHeldByOther);
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { userFillerWords } = useUserFillerWords();
    const activeEngine = useSessionStore(state => state.activeEngine);
    const { runtimeState } = useTranscriptionContext();

    const isProUser = isPro(profile?.subscription_status);

    const sttStatus = useSessionStore(state => state.sttStatus);
    const setSTTStatus = useSessionStore(state => state.setSTTStatus);
    const sttMode = useSessionStore(state => state.sttMode);
    const setSTTMode = useSessionStore(state => state.setSTTMode);
    const sunsetModal = useSessionStore(state => state.sunsetModal);
    const setSunsetModal = useSessionStore(state => state.setSunsetModal);

    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const isProcessingRef = useRef(false);
    const isMounted = useRef(false);

    // Pure Projection from FSM (Source of Truth)
    // We drive the "recording" visual strictly from the authoritative runtimeState.
    const isRecordingIntent = ['RECORDING', 'ENGINE_INITIALIZING', 'INITIATING', 'STOPPING'].includes(runtimeState);

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

    const isListening = useSessionStore(state => state.isListening);
    const history = useSessionStore(state => state.history);

    const speechRecognition = useSpeechRecognition(speechConfig);
    const {
        transcript,
        chunks,
        fillerData,
        isReady,
        modelLoadingProgress,
        mode: activeMode,
        pauseMetrics
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
        if (isProcessingRef.current && !isListening) return;
        isProcessingRef.current = true;

        if (isListening) {
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
                await speechRuntimeController.stopRecording();

                const streakResult = updateStreak(); // UI layer still needs streak for display
                
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

            if (!isProUser && usageLimit && !usageLimit.can_start) {
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

                if (typeof document !== 'undefined') {
                    document.body.setAttribute('data-user-tier', isProUser ? 'pro' : 'free');
                }
                
                // SpeechRuntimeController.startRecording() handles FSM, Service Init, and DB Session
                await speechRuntimeController.startRecording(undefined, userFillerWords);
                posthog.capture('session_started', { mode: sttMode });
            } catch (error) {
                logger.error({ error }, '[useSessionLifecycle] Failed to start recording');
                setSTTStatus({ type: 'error', message: '⚠️ Failed to start recording.' });
            } finally {
                isProcessingRef.current = false;
            }
        }
    }, [isListening, elapsedTime, updateStreak, queryClient, isProUser, usageLimit, sttMode, isLockHeldByOther, setSTTStatus, userFillerWords]);

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


    // Tier enforcement: Auto-stop and 5-minute Warning
    useEffect(() => {
        if (!isVerified || isProUser || (usageLimit && usageLimit.remaining_seconds === -1)) return;

        if (isListening && usageLimit && typeof usageLimit.remaining_seconds === 'number' && usageLimit.remaining_seconds > 0) {
            const remaining = usageLimit.remaining_seconds - elapsedTime;

            // 5-minute warning (300 seconds)
            if (remaining > 0 && remaining <= 300) {
                const minutes = Math.ceil(remaining / 60);
                const warningMsg = `⚠️ Great practice! ${minutes} minute${minutes > 1 ? 's' : ''} remaining for today's practice limit.`;
                if (sttStatus.message !== warningMsg) {
                    setSTTStatus({ type: 'info', message: warningMsg });
                    posthog.capture('session_limit_warning', { remaining_seconds: remaining });
                }
            } else if (remaining <= 0) {
                if (hasAutoStoppedRef.current) return;
                hasAutoStoppedRef.current = true;

                logger.warn({ elapsedTime, remaining }, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: limit reached');

                const isMonthly = usageLimit.monthly_remaining <= 0;
                setSunsetModal({ type: isMonthly ? 'monthly' : 'daily', open: true });

                void handleStartStopRef.current?.({
                    stopReason: "⛔ Daily usage limit reached."
                });
            }
        }
    }, [elapsedTime, isListening, usageLimit, sttStatus.message, isProUser, isVerified, setSTTStatus, setSunsetModal]);

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

    // Mode sync: Ensure UI and Engine mode stay aligned
    useEffect(() => {
        if (isListening && activeEngine && activeEngine !== 'none' && activeEngine !== sttMode) {
            setSTTMode(activeEngine as TranscriptionMode);
        }
    }, [isListening, activeEngine, sttMode, setSTTMode]);

    // Engine Warm-up: Pre-initialize heavy engines (WASM) when mode is selected
    useEffect(() => {
        if (sttMode === 'private' && !isListening) {
            logger.info('[useSessionLifecycle] Mode set to private - triggering warm-up');
            void speechRuntimeController.warmUp('private');
        }
    }, [sttMode, isListening]);

    // Cleanup on unmount - TRULY only on unmount
    useEffect(() => {
        return () => {
            logger.debug('[useSessionLifecycle] Component unmounting - Cleanup running');
            if (isListeningRef.current) {
                logger.debug('[useSessionLifecycle] Session active on unmount - forcing stop');
                void speechRuntimeController.stopRecording(); 
            }
        };
    }, []);

    return {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        activeMode,
        mode: sttMode,
        setMode: setSTTMode,
        recordingIntent: isRecordingIntent,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        setShowAnalyticsPrompt,
        sessionFeedbackMessage: sttStatus.message,
        sunsetModal,
        setSunsetModal,
        pauseMetrics,
        transcriptContent: transcript.transcript,
        fillerData,
        isProUser,
        activeEngine,
        isButtonDisabled: !['IDLE', 'READY', 'RECORDING', 'FAILED', 'ENGINE_INITIALIZING'].includes(runtimeState), // Permitting ENGINE_INITIALIZING allows "Stop" (Cancel) during downloads.
        showPromoExpiredDialog: !!usageLimit?.promo_just_expired,
        usageLimit,
        history,
        profileLoading: false,
        profileError: null
    };
};
