import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import posthog from 'posthog-js';
import logger from '@/lib/logger';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from './useUserProfile';
import { useSessionStore } from '../stores/useSessionStore';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useVocalAnalysis } from './useVocalAnalysis';
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
    const { data: profile, isLoading, error: profileError } = useUserProfile();
    const queryClient = useQueryClient();
    const { updateElapsedTime, elapsedTime } = useSessionStore();
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { saveSession } = useSessionManager();
    const { userFillerWords } = useUserFillerWords();

    const [mode, setMode] = useState<'cloud' | 'native' | 'private'>('native');
    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const [sessionFeedbackMessage, setSessionFeedbackMessage] = useState<string | null>(null);
    const startTimeRef = useRef<number | null>(null);

    const isProUser = isPro(profile?.subscription_status);

    const speechConfig = useMemo(() => ({
        customWords: userFillerWords,
        customVocabulary: userFillerWords,
        session,
        profile
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
        mode: activeMode
    } = speechRecognition;

    const { pauseMetrics } = useVocalAnalysis(isListening);

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

            updateElapsedTime(0);
            const policy = buildPolicyForUser(isProUser, mode);
            await startListening(policy);
            posthog.capture('session_started', { mode });
        }
    }, [isListening, elapsedTime, stopListening, updateStreak, saveSession, queryClient, isProUser, usageLimit, updateElapsedTime, mode, startListening]);

    // Timer logic
    useEffect(() => {
        if (isListening) {
            startTimeRef.current = Date.now();
            const interval = setInterval(() => {
                if (startTimeRef.current) {
                    updateElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
                }
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [isListening, updateElapsedTime]);

    const hasMountedRef = useRef(false);

    // Cleanup/Reset logic for testing and UI consistency
    useEffect(() => {
        if (!hasMountedRef.current) {
            if (!isListening) {
                updateElapsedTime(0);
            }
            hasMountedRef.current = true;
        }
    }, [isListening, updateElapsedTime]); // Run once on mount (guarded by ref) to ensure clean state

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
        isButtonDisabled: false, // Architectural decision: never block stop/cancel
        showPromoExpiredDialog: !!usageLimit?.promo_just_expired,
        usageLimit,
        profileLoading: isLoading,
        profileError
    };
};
