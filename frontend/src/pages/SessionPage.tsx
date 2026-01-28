import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionStore } from '../stores/useSessionStore';
import { useVocalAnalysis } from '../hooks/useVocalAnalysis';
import { useQueryClient } from '@tanstack/react-query';

import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { Square } from 'lucide-react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSessionMetrics } from '@/hooks/useSessionMetrics';
import { useUsageLimit, formatRemainingTime } from '@/hooks/useUsageLimit';
import { useStreak } from '@/hooks/useStreak';
import { isPro } from '@/constants/subscriptionTiers';
import { buildPolicyForUser } from '@/services/transcription/TranscriptionPolicy';
import { useSessionManager } from '@/hooks/useSessionManager';
import { PauseMetricsDisplay } from '@/components/session/PauseMetricsDisplay';
import { toast } from 'sonner';
import { useUserFillerWords } from '@/hooks/useUserFillerWords';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Settings } from 'lucide-react';
import { UserFillerWordsManager } from '@/components/session/UserFillerWordsManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { ClarityScoreCard } from '@/components/session/ClarityScoreCard';
import { SpeakingRateCard } from '@/components/session/SpeakingRateCard';
import { FillerWordsCard } from '@/components/session/FillerWordsCard';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { SpeakingTipsCard } from '@/components/session/SpeakingTipsCard';
import { LiveRecordingCard } from '@/components/session/LiveRecordingCard';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { StatusNotificationBar } from '@/components/session/StatusNotificationBar';
import { PromoExpiredDialog } from '@/components/PromoExpiredDialog';

export const SessionPage: React.FC = () => {
    const { session } = useAuthProvider();
    const navigate = useNavigate();
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useUserProfile();

    // Use zustand store for session state
    const { updateElapsedTime, elapsedTime } = useSessionStore();

    const isProUser = isPro(profile?.subscription_status);

    // Usage limit check for pre-session validation
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { saveSession } = useSessionManager();
    const queryClient = useQueryClient();

    // Renaming for clarity: Custom Vocabulary = User Defined Filler Words
    // These are used for 1. Analysis (finding them in transcript) and 2. Boosting (helping Cloud STT hear them)
    const { userFillerWords } = useUserFillerWords();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [mode, setMode] = useState<'cloud' | 'native' | 'private'>('native');
    const [showPromoExpiredDialog, setShowPromoExpiredDialog] = useState(false);
    const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);
    const [sessionFeedbackMessage, setSessionFeedbackMessage] = useState<string | null>(null);
    const startTimeRef = useRef<number | null>(null);
    // Rate-limited debug canary ref
    const prevStateRef = useRef({ isListening: false, isReady: false });
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const speechConfig = React.useMemo(() => ({
        customWords: userFillerWords,
        customVocabulary: userFillerWords,
        session,
        profile
    }), [userFillerWords, session, profile]);

    const speechRecognition = useSpeechRecognition(speechConfig);

    const { transcript, fillerData, startListening, stopListening, isListening, isReady, modelLoadingProgress, sttStatus, mode: activeMode } = speechRecognition;
    const { pauseMetrics } = useVocalAnalysis(isListening);

    // Sync UI mode with actual active mode from service (e.g. after fallback)
    useEffect(() => {
        if (isListening && activeMode && activeMode !== mode) {
            console.log(`[SessionPage] [DEBUG-SWITCH] Mode mismatch detected (Active: ${activeMode}, UI: ${mode}). Syncing UI.`);
            setMode(activeMode);
        }
    }, [isListening, activeMode, mode]);

    // Enhanced status derived from sttStatus + fallback history
    // If we are in Native mode but requested Private/Cloud, effectively we fell back.
    // However, tracking "requested" is tricky if we update `mode` to match active.
    // We rely on `sttStatus` messages. If `sttStatus.type` is 'ready', it might hide the fallback error.
    // We can use a local state to hold the last error/fallback message until session end.
    const [persistentStatus, setPersistentStatus] = useState<typeof sttStatus | null>(null);

    useEffect(() => {
        if (sttStatus) {
            if (sttStatus.type === 'fallback' || sttStatus.type === 'error') {
                setPersistentStatus(sttStatus);
            } else if (sttStatus.type === 'initializing') {
                setPersistentStatus(null);
            }
        }
    }, [sttStatus]);

    // Compute display status: Prefer persistent fallback warning over generic "Ready"
    const displayStatus = (persistentStatus && sttStatus?.type === 'ready')
        ? persistentStatus
        : sttStatus;

    // Reset analytics prompt when a new session starts
    useEffect(() => {
        if (isListening) {
            setShowAnalyticsPrompt(false);
            setSessionFeedbackMessage(null);
        }
    }, [isListening]);

    // AUDIT FIX: Extract metrics calculation to custom hook
    // Must be called before early returns to comply with React Hooks rules
    const metrics = useSessionMetrics({
        transcript: transcript.transcript,
        fillerData,
        elapsedTime,
    });

    // Ref to ensure we only reset the timer once on mount/initialization
    const hasResetTimerRef = useRef(false);
    // Ref to access the latest handleStartStop without triggering effect re-runs
    const handleStartStopRef = useRef<((options?: { skipRedirect?: boolean }) => Promise<void>) | null>(null);



    useEffect(() => {
        console.log('[SessionPage] [DEBUG-REDIRECT] Mount. Validating auth/pro status...');
        if (!isProUser) {
            console.log('[SessionPage] [DEBUG-REDIRECT] User is NOT pro. Subscription:', profile?.subscription_status);
        } else {
            console.log('[SessionPage] [DEBUG-REDIRECT] User IS pro. Verified.');
        }

        posthog.capture('session_page_viewed');

        // Reset timer ONLY ONCE to ensure fresh state for new sessions
        if (!isListening && !hasResetTimerRef.current) {
            updateElapsedTime(0);
            hasResetTimerRef.current = true;
        }
        // STRICT DEPS: We depend on `isListening`, `updateElapsedTime` etc.
        // We use refs inside to control "run once" logic if needed, but here we actually rely on `hasResetTimerRef` guard
        // to prevent repeated execution, while confusing the linter less by including typical deps.
        // However, standard exhaustive-deps wants all used values.
    }, [isListening, updateElapsedTime, isProUser, profile?.subscription_status]);

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

    // Auto-scroll transcript to bottom when content changes
    useEffect(() => {
        if (transcriptContainerRef.current && transcript.transcript) {
            transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
        }
    }, [transcript.transcript]);

    // Derived state for usage limit enforcement
    // A user is over limit if they have 0 or less seconds remaining and are NOT currently listening
    const sessionRemainingSeconds = (usageLimit?.remaining_seconds ?? 0) - elapsedTime;
    const isActuallyOverLimit = !isProUser && sessionRemainingSeconds <= 0 && elapsedTime > 0;

    // Show promo expiry dialog when backend signals promo has expired
    useEffect(() => {
        if (usageLimit?.promo_just_expired) {
            setShowPromoExpiredDialog(true);
        }
    }, [usageLimit?.promo_just_expired]);

    // TIER ENFORCEMENT: Auto-stop session when daily limit is reached
    useEffect(() => {
        // Strategic log to debug E2E timing issues
        if (isListening) {
            console.log('[TIER] Auto-stop check:', {
                isProUser,
                isListening,
                elapsedTime,
                remaining: usageLimit?.remaining_seconds,
                wouldTrigger: !isProUser && usageLimit && elapsedTime >= (usageLimit?.remaining_seconds ?? 0)
            });
        }

        if (!isProUser && isListening && usageLimit && usageLimit.remaining_seconds > 0) {
            if (elapsedTime >= usageLimit.remaining_seconds) {
                console.log('[TIER] ⚠️ AUTO-STOPPING: elapsedTime >= remaining_seconds');
                // Use ref to avoid dependency cycle
                if (handleStartStopRef.current) {
                    handleStartStopRef.current({ skipRedirect: true });
                }
            }
        }
    }, [elapsedTime, isListening, usageLimit, isProUser]);

    const handleStartStop = async (_options?: { skipRedirect?: boolean }) => {
        if (isListening) {
            // Check minimum session duration before saving
            if (elapsedTime < MIN_SESSION_DURATION_SECONDS) {
                // Stop recording but don't save - show warning in status bar
                await stopListening();
                setShowAnalyticsPrompt(false);
                setSessionFeedbackMessage(`⚠️ Session too short (${elapsedTime}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required for accurate metrics.`);
                return;
            }

            try {
                await stopListening();
                // Track session end with metrics
                posthog.capture('session_ended', {
                    duration: elapsedTime,
                    wpm: metrics.wpm,
                    clarity_score: metrics.clarityScore,
                    filler_count: metrics.fillerCount
                });

                // Update Streak for positive reinforcement
                const { currentStreak, isNewDay } = updateStreak();

                const result = await saveSession({
                    transcript: transcript.transcript,
                    duration: elapsedTime,
                    filler_words: fillerData,
                    wpm: metrics.wpm,
                    clarity_score: metrics.clarityScore,
                    title: `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`
                });

                if (result.session) {
                    // Show streak message in status bar
                    const streakText = isNewDay ? `🔥 ${currentStreak} Day Streak!` : '✓ Great practice!';
                    setSessionFeedbackMessage(`${streakText} Session saved.`);

                    // Refetch usage limit to reflect new session duration
                    queryClient.invalidateQueries({ queryKey: ['usageLimit'] });

                    // Prompt user to view analytics instead of auto‑redirect
                    setShowAnalyticsPrompt(true);
                } else {
                    console.error('[SessionPage] Session save failed or returned null session.');
                }

            } catch (error) {
                console.error('[SessionPage] Error stopping recording:', error);
                console.error('[SessionPage] Error details:', {
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    isListening,
                    mode
                });
            }
        } else {
            try {
                // PRE-SESSION USAGE CHECK: Validate before starting
                if (!isProUser && usageLimit && !usageLimit.can_start) {
                    setSessionFeedbackMessage('⛔ Monthly usage limit reached. Upgrade to Pro for unlimited practice.');
                    return;
                }

                // Warn if running low on time (less than 5 minutes)
                if (!isProUser && usageLimit && usageLimit.remaining_seconds > 0 && usageLimit.remaining_seconds < 300) {
                    toast.warning(
                        `Only ${formatRemainingTime(usageLimit.remaining_seconds)} remaining this month.`,
                        { duration: 5000 }
                    );
                }

                // Reset timer for new session
                updateElapsedTime(0);
                // Build policy based on user tier and selected mode
                const policy = buildPolicyForUser(isProUser, mode as 'native' | 'cloud' | 'private');
                await startListening(policy);
                // Track session start
                posthog.capture('session_started', { mode });
            } catch (error) {
                console.error('[SessionPage] Error starting recording:', error);
                console.error('[SessionPage] Error details:', {
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    mode,
                    profileStatus: profile?.subscription_status
                });
            }
        }
    };

    const isButtonDisabled = false; // Always allow stopping/canceling

    // Keep handleStartStopRef updated
    useEffect(() => {
        handleStartStopRef.current = handleStartStop;
    });

    if (isProfileLoading) {
        console.log('[DEBUG] SessionPage: Loading profile...');

        return <SessionPageSkeleton />;
    }

    if (usageLimit && (!usageLimit.can_start || isActuallyOverLimit) && !isListening) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] px-6">
                <div className="max-w-md w-full p-8 bg-card rounded-xl border border-border shadow-elegant text-center">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Square className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold mb-4">Daily Limit Reached</h2>
                    <p className="text-muted-foreground mb-8">
                        You've reached your 1-hour practice limit for today. Upgrade to Pro for unlimited practice sessions and advanced metrics.
                    </p>
                    <div className="space-y-3">
                        <Button onClick={() => window.location.href = '/#pricing'} className="w-full py-6 text-lg">
                            Upgrade to Pro
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => navigate('/analytics')}
                            className="w-full py-6 text-lg"
                        >
                            View Session History
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    if (profileError) {
        console.log('[DEBUG] SessionPage: Profile error:', profileError);
        return (
            <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
                <div className="text-center p-6 max-w-md">
                    <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Profile</h2>
                    <p className="text-muted-foreground mb-4">We couldn't load your profile settings. Please try refreshing the page.</p>
                    <Button onClick={() => window.location.reload()}>Refresh Page</Button>
                </div>
            </div>
        );
    }



    // Rate-limited debug canary - only log when state changes
    if (prevStateRef.current.isListening !== isListening || prevStateRef.current.isReady !== isReady) {
        console.log('[DEBUG] Button state changed:', { isButtonDisabled, isListening, isReady });
        prevStateRef.current = { isListening, isReady };
    }

    return (
        <div className="min-h-screen bg-gradient-subtle pt-20">
            {/* Page Header */}
            <div className="text-center py-8 px-6 max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-foreground mb-2">Practice Session</h1>
                <p className="text-sm text-muted-foreground">We'll analyze your speech patterns in real-time</p>
            </div>



            {/* Main Content Grid */}
            <div className="max-w-7xl mx-auto px-6 pb-12">
                <div className="grid lg:grid-cols-3 gap-6">

                    {/* LEFT COLUMN: Recording & Transcript (Span 2) */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Status Bar */}
                        <StatusNotificationBar
                            status={
                                sessionFeedbackMessage
                                    ? { type: sessionFeedbackMessage.includes('⚠️') ? 'error' : 'ready', message: sessionFeedbackMessage }
                                    : showAnalyticsPrompt
                                        ? { type: 'ready', message: '✓ Session saved. Click Analytics above to review your performance.' }
                                        : modelLoadingProgress != null
                                            ? { type: 'downloading', message: 'Downloading model...', progress: modelLoadingProgress }
                                            : (usageLimit?.promo_just_expired)
                                                ? { type: 'error', message: '⚠️ Promo code expired. Session limit reverted to 5 mins.' }
                                                : displayStatus
                            }
                        />

                        {/* Main Recording Card */}
                        <LiveRecordingCard
                            mode={mode}
                            isListening={isListening}
                            isReady={isReady}
                            isProUser={isProUser}
                            modelLoadingProgress={modelLoadingProgress}
                            formattedTime={metrics.formattedTime}
                            elapsedSeconds={elapsedTime}
                            isButtonDisabled={isButtonDisabled}
                            onModeChange={(newMode) => {
                                console.log(`[SessionPage] [DEBUG-SWITCH] UI Dropdown changed to: ${newMode}`);
                                setMode(newMode);
                            }}
                            onStartStop={handleStartStop}
                        />

                        {/* Live Transcript */}
                        <LiveTranscriptPanel
                            transcript={transcript.transcript}
                            isListening={isListening}
                            containerRef={transcriptContainerRef}
                            customWords={userFillerWords}
                        />
                    </div>

                    {/* RIGHT COLUMN: Real-time Stats Sidebar (Span 1) */}
                    <div className="space-y-6">
                        <FillerWordsCard
                            fillerCount={metrics.fillerCount}
                            fillerData={fillerData}
                            headerAction={
                                <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            data-testid="add-custom-word-button"
                                            className="text-primary underline-offset-4 hover:underline"
                                        >
                                            <Settings className="h-4 w-4" />
                                            Custom
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80 bg-card border-border shadow-xl mr-6">
                                        <UserFillerWordsManager onWordAdded={() => setIsSettingsOpen(false)} />
                                    </PopoverContent>
                                </Popover>
                            }
                        />

                        {/* Clarity Score */}
                        <ClarityScoreCard
                            clarityScore={metrics.clarityScore}
                            clarityLabel={metrics.clarityLabel}
                        />

                        {/* Speaking Rate */}
                        <SpeakingRateCard
                            wpm={metrics.wpm}
                            wpmLabel={metrics.wpmLabel}
                        />

                        {/* Pause Analysis */}
                        <div className="bg-card border border-border rounded-xl overflow-hidden">
                            <PauseMetricsDisplay metrics={pauseMetrics} isListening={isListening} />
                        </div>

                        {/* Tips */}
                        <SpeakingTipsCard />
                    </div>

                </div>
            </div>

            {/* Mobile Sticky Action Bar */}
            <MobileActionBar
                isListening={isListening}
                isButtonDisabled={isButtonDisabled}
                modelLoadingProgress={modelLoadingProgress}
                onStartStop={handleStartStop}
            />

            {/* Promo Expired Dialog */}
            <PromoExpiredDialog
                open={showPromoExpiredDialog}
                onOpenChange={setShowPromoExpiredDialog}
            />
        </div>

    );
};

export default SessionPage;