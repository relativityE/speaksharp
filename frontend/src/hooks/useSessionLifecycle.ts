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
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';

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

    const [mode, setMode] = useState<'cloud' | 'native' | 'private'>('native');
    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const [sessionFeedbackMessage, setSessionFeedbackMessage] = useState<string | null>(null);

    const isProUser = isPro(profile?.subscription_status);

    const speechConfig = useMemo(() => ({
        customWords: userFillerWords,
        customVocabulary: userFillerWords,
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
        chunks,
        fillerData,
        elapsedTime,
    });

    const handleStartStop = useCallback(async (options?: { skipRedirect?: boolean; stopReason?: string }) => {
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

                const result = await saveSession({
                    transcript: finalStats.transcript,
                    duration: elapsedTime,
                    filler_words: finalStats.filler_words,
                    wpm: finalWpm,
                    clarity_score: finalStats.accuracy,
                    title: `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`
                });


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
            }
        } else {
            if (!isProUser && usageLimit && !usageLimit.can_start) {
                const errorMsg = usageLimit.error || 'Daily usage limit reached.';
                const prefix = errorMsg.startsWith('⚠️') || errorMsg.startsWith('⛔') ? '' : '⛔ ';
                setSessionFeedbackMessage(`${prefix}${errorMsg}`);
                return;
            }

            setSessionFeedbackMessage(null);
            const policy = buildPolicyForUser(isProUser, mode);
            await startListening(policy);
            posthog.capture('session_started', { mode });
        }
    }, [isListening, elapsedTime, stopListening, updateStreak, saveSession, queryClient, isProUser, usageLimit, mode, startListening]);

    // Timer logic: Heartbeat for the store's tick
    useEffect(() => {
        if (isListening) {
            const interval = setInterval(() => {
                tick();
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [isListening, tick]);

    const hasMountedRef = useRef(false);

    // Initial clean state check
    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
        }
    }, []);

    // Tier enforcement: Auto-stop when daily limit reached
    useEffect(() => {
        if (!isProUser && isListening && usageLimit && usageLimit.remaining_seconds > 0) {
            if (elapsedTime >= usageLimit.remaining_seconds) {
                logger.warn('[useSessionLifecycle] ⚠️ AUTO-STOPPING: limit reached');
                const errorMsg = usageLimit.error || 'Daily usage limit reached.';
                const prefix = errorMsg.startsWith('⚠️') || errorMsg.startsWith('⛔') ? '' : '⛔ ';
                handleStartStop({
                    skipRedirect: true,
                    stopReason: `${prefix}${errorMsg}`
                });
            }
        }
    }, [elapsedTime, isListening, usageLimit, isProUser, handleStartStop]);

    // Mode sync
    useEffect(() => {
        if (isListening && activeMode && activeMode !== mode) {
            setMode(activeMode);
        }
    }, [isListening, activeMode, mode]);

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
        pauseMetrics,
        transcriptContent: transcript.transcript,
        fillerData,
        isProUser,
        isButtonDisabled: !isListening && !isReady, // Prevents starting while not ready, but always allow stopping
        showPromoExpiredDialog: !!usageLimit?.promo_just_expired,
        usageLimit,
        profileLoading: false,
        profileError: null
    };
};
