import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import posthog from 'posthog-js';
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

    const handleStartStop = useCallback(async (_options?: { skipRedirect?: boolean }) => {
        if (isListening) {
            if (elapsedTime < MIN_SESSION_DURATION_SECONDS) {
                await stopListening();
                setShowAnalyticsPrompt(false);
                setSessionFeedbackMessage(`⚠️ Session too short (${elapsedTime}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required.`);
                return;
            }

            try {
                await stopListening();
                posthog.capture('session_ended', {
                    duration: elapsedTime,
                    wpm: metrics.wpm,
                    clarity_score: metrics.clarityScore,
                    filler_count: metrics.fillerCount
                });

                const streakResult = updateStreak();

                const result = await saveSession({
                    transcript: transcript.transcript,
                    duration: elapsedTime,
                    filler_words: fillerData,
                    wpm: metrics.wpm,
                    clarity_score: metrics.clarityScore,
                    title: `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`
                });

                if (result.session) {
                    const finalMsg = streakResult.isNewDay
                        ? ` 🔥 ${streakResult.currentStreak} Day Streak! Session saved.`
                        : '✓ Great practice! Session saved.';
                    setSessionFeedbackMessage(finalMsg);
                    queryClient.invalidateQueries({ queryKey: ['usageLimit'] });
                    setShowAnalyticsPrompt(true);
                }

            } catch (error) {
                console.error('[useSessionLifecycle] Error stopping recording:', error);
            }
        } else {
            if (!isProUser && usageLimit && !usageLimit.can_start) {
                setSessionFeedbackMessage('⛔ Monthly usage limit reached.');
                return;
            }

            updateElapsedTime(0);
            const policy = buildPolicyForUser(isProUser, mode);
            await startListening(policy);
            posthog.capture('session_started', { mode });
        }
    }, [isListening, elapsedTime, stopListening, metrics, updateStreak, saveSession, transcript, fillerData, queryClient, isProUser, usageLimit, updateElapsedTime, mode, startListening]);

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
                console.log('[useSessionLifecycle] ⚠️ AUTO-STOPPING: limit reached');
                handleStartStop({ skipRedirect: true });
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
