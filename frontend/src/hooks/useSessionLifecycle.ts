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
import { useActiveSessionLock } from './useActiveSessionLock';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import type { Chunk } from './useSpeechRecognition/types';

export const useSessionLifecycle = () => {
    const { session } = useAuthProvider();
    const profile = useProfile();
    const queryClient = useQueryClient();
    const tick = useSessionStore(state => state.tick);
    const elapsedTime = useSessionStore(state => state.elapsedTime);
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { saveSession } = useSessionManager();
    const { userFillerWords } = useUserFillerWords();
    const activeEngine = useSessionStore(state => state.activeEngine);
    const { acquireLock, releaseLock } = useActiveSessionLock();

    const isProUser = isPro(profile?.subscription_status);

    const [mode, setMode] = useState<'cloud' | 'native' | 'private'>(isProUser ? 'private' : 'native');
    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const [sessionFeedbackMessage, setSessionFeedbackMessage] = useState<string | null>(null);
    const [sunsetModal, setSunsetModal] = useState<{ type: 'daily' | 'monthly'; open: boolean }>({ type: 'daily', open: false });
    const isProcessingRef = useRef(false);

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
            // Bypass minimum duration check if there is an external stop reason (e.g. tier limits)
            if (elapsedTime < MIN_SESSION_DURATION_SECONDS && !options?.stopReason) {
                await stopListening();
                setShowAnalyticsPrompt(false);
                setSessionFeedbackMessage(`⚠️ Session too short (${elapsedTime}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required.`);
                return;
            }

            try {
                // Use the result from stopListening() to avoid stale closures
                // The closure captures React state at invocation time, but stopListening() 
                // returns the absolute final transcript and metrics after all processing completes.
                const finalStats = await stopListening();

                if (!finalStats) {
                    logger.warn('[useSessionLifecycle] stopListening returned null, skipping save');
                    return;
                }

                // Calculate wpm from final stats (total_words / duration_in_minutes)
                const finalWpm = finalStats.duration > 0
                    ? Math.round((finalStats.total_words / finalStats.duration) * 60)
                    : 0;

                // Sum filler counts from FillerCounts object (each value is a FillerData with .count)
                const finalFillerCount = Object.entries(finalStats.filler_words)
                    .filter(([key]) => key !== 'total') // Exclude the 'total' key, we'll sum ourselves
                    .reduce((sum, [, data]) => sum + (data?.count ?? 0), 0);

                posthog.capture('session_ended', {
                    duration: elapsedTime,
                    wpm: finalWpm,
                    clarity_score: finalStats.accuracy,
                    filler_count: finalFillerCount
                });

                const streakResult = updateStreak();

                // Derive engine type for usage tracking
                const engineType = (activeEngine === 'cloud') ? 'cloud' : 'native';

                const result = await saveSession({
                    transcript: finalStats.transcript,
                    duration: elapsedTime,
                    filler_words: finalStats.filler_words as FillerCounts,
                    wpm: finalWpm,
                    clarity_score: finalStats.accuracy,
                    title: `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
                    engine: (activeEngine || 'unknown') as string // Fix: Handle null/none and cast to string for session record
                }, engineType);


                if (result.session) {
                    let finalMsg = streakResult.isNewDay
                        ? ` 🔥 ${streakResult.currentStreak} Day Streak! Session saved.`
                        : '✓ Great practice! Session saved.';

                    // Override with specific stop reason if provided (e.g. usage limit)
                    if (options?.stopReason) {
                        finalMsg = options.stopReason;
                    }

                    setSessionFeedbackMessage(finalMsg);
                    queryClient.invalidateQueries({ queryKey: ['usageLimit'] });
                    setShowAnalyticsPrompt(true);
                }

            } catch (error) {
                logger.error({ err: error }, '[useSessionLifecycle] Error stopping recording');
            } finally {
                isProcessingRef.current = false;
            }
        } else {
            if (!isProUser && usageLimit && !usageLimit.can_start) {
                const errorMsg = usageLimit.error || 'Daily usage limit reached.';
                const prefix = errorMsg.startsWith('⚠️') || errorMsg.startsWith('⛔') ? '' : '⛔ ';
                setSessionFeedbackMessage(`${prefix}${errorMsg}`);
                return;
            }

            try {
                setSessionFeedbackMessage(null);

                // Mutex Check: Prevent multi-tab session bypass for Free users
                // Direct call to acquireLock gives us an atomic check/acquisition
                if (!isProUser && !acquireLock()) {
                    setSessionFeedbackMessage('⛔ Active session in another tab. Switch to that tab to continue.');
                    return;
                }

                const policy = buildPolicyForUser(isProUser, mode);
                await startListening(policy);
                posthog.capture('session_started', { mode });
            } finally {
                isProcessingRef.current = false;
            }
        }
    }, [isListening, elapsedTime, stopListening, updateStreak, saveSession, queryClient, isProUser, usageLimit, mode, activeEngine, startListening, acquireLock]);

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
        if (isListening && usageLimit && typeof usageLimit.remaining_seconds === 'number') {
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
                logger.warn({ elapsedTime, remaining }, '[useSessionLifecycle] ⚠️ AUTO-STOPPING: limit reached');

                // Determine modal type
                const isMonthly = usageLimit.monthly_remaining <= 0;
                setSunsetModal({ type: isMonthly ? 'monthly' : 'daily', open: true });

                handleStartStop({
                    stopReason: "🚀 You've crushed your practice goals for today! Auto-saving now."
                });
            }
        }
    }, [elapsedTime, isListening, usageLimit, handleStartStop, sessionFeedbackMessage]);

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
                logger.warn({
                    now,
                    lastActivity: lastActivityTimeRef.current,
                    diff: now - lastActivityTimeRef.current
                }, '[useSessionLifecycle] 🔇 VAD AUTO-STOP: 5 minutes of silence detected');

                handleStartStop({
                    stopReason: '🔇 Auto-paused due to 5 minutes of inactivity.'
                });
            }
        }, 1000); // Check more frequently in dev/test

        return () => clearInterval(checkInactivity);
    }, [isListening, transcript.transcript, handleStartStop]);

    // Ensure lock is released on unmount or when listening stops
    useEffect(() => {
        return () => {
            if (isListening) releaseLock();
        };
    }, [isListening, releaseLock]);

    // Mode sync: Ensure UI and Engine mode stay aligned
    useEffect(() => {
        if (isListening && activeEngine && activeEngine !== 'none' && activeEngine !== mode) {
            setMode(activeEngine as 'cloud' | 'native' | 'private');
        }
    }, [isListening, activeEngine, mode]);

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
