import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionStore } from '../stores/useSessionStore';
import { useVocalAnalysis } from '../hooks/useVocalAnalysis';

import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSessionMetrics } from '@/hooks/useSessionMetrics';
import { useUsageLimit, formatRemainingTime } from '@/hooks/useUsageLimit';
import { useStreak } from '@/hooks/useStreak';
import { isPro } from '@/constants/subscriptionTiers';
import { useSessionManager } from '@/hooks/useSessionManager';
import { PauseMetricsDisplay } from '@/components/session/PauseMetricsDisplay';
import { toast } from 'sonner';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CustomVocabularyManager } from '@/components/session/CustomVocabularyManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { ClarityScoreCard } from '@/components/session/ClarityScoreCard';
import { SpeakingRateCard } from '@/components/session/SpeakingRateCard';
import { FillerWordsCard } from '@/components/session/FillerWordsCard';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { SpeakingTipsCard } from '@/components/session/SpeakingTipsCard';
import { LiveRecordingCard } from '@/components/session/LiveRecordingCard';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { PromoExpiredDialog } from '@/components/PromoExpiredDialog';

export const SessionPage: React.FC = () => {
    const { session, profile: authProfile } = useAuthProvider();
    const navigate = useNavigate();
    const { data: queryProfile, isLoading: isQueryLoading, error: profileError } = useUserProfile();

    // STABILITY FIX: Combine Auth profile (fast) with Query profile (canonical)
    // This eliminates the navigation "flicker" because AuthProvider already has the profile
    const profile = authProfile || queryProfile;
    const isProfileLoading = isQueryLoading && !authProfile;

    // Use zustand store for session state
    const { updateElapsedTime, elapsedTime } = useSessionStore();

    const isProUser = isPro(profile?.subscription_status);

    // Usage limit check for pre-session validation
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { saveSession } = useSessionManager();

    const [customWords] = useState<string[]>([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [mode, setMode] = useState<'cloud' | 'native' | 'private'>('native');
    const [showPromoExpiredDialog, setShowPromoExpiredDialog] = useState(false);
    const startTimeRef = useRef<number | null>(null);
    // Rate-limited debug canary ref
    const prevStateRef = useRef({ isListening: false, isReady: false });
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const speechRecognition = useSpeechRecognition({
        customWords,
        customVocabulary: [],
        session,
        profile
    });

    const { transcript, fillerData, startListening, stopListening, isListening, isReady, modelLoadingProgress, mode: activeMode } = speechRecognition;
    const { pauseMetrics } = useVocalAnalysis(isListening);

    // Sync local mode state if the service falls back (e.g. Private -> Native)
    useEffect(() => {
        if (activeMode && activeMode !== mode) {
            console.log(`[SessionPage] Syncing mode state to active transcription mode: ${activeMode}`);
            setMode(activeMode as 'cloud' | 'native' | 'private');
        }
    }, [activeMode, mode]);

    // AUDIT FIX: Extract metrics calculation to custom hook
    // Must be called before early returns to comply with React Hooks rules
    const metrics = useSessionMetrics({
        transcript: transcript.transcript,
        fillerData,
        elapsedTime,
    });

    useEffect(() => {
        posthog.capture('session_page_viewed');
    }, []);

    useEffect(() => {
        if (isListening) {
            startTimeRef.current = Date.now();
            const interval = setInterval(() => {
                if (startTimeRef.current) {
                    updateElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
                }
            }, 1000);
            return () => clearInterval(interval);
        } else {
            updateElapsedTime(0);
        }
    }, [isListening, updateElapsedTime]);

    // Auto-scroll transcript to bottom when content changes
    useEffect(() => {
        if (transcriptContainerRef.current && transcript.transcript) {
            transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
        }
    }, [transcript.transcript]);

    // Show promo expiry dialog when backend signals promo has expired
    useEffect(() => {
        if (usageLimit?.promo_just_expired) {
            setShowPromoExpiredDialog(true);
        }
    }, [usageLimit?.promo_just_expired]);

    if (isProfileLoading) {
        console.log('[DEBUG] SessionPage: Loading profile...');

        return <SessionPageSkeleton />;
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

    const handleStartStop = async () => {
        if (isListening) {
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

                // DATA PERSISTENCE FIX: Save session to database
                console.log('[SessionPage] 💾 Saving session via useSessionManager...');
                console.log('[SessionPage] Session Data:', {
                    duration: elapsedTime,
                    transcriptLength: transcript.transcript.length,
                    wpm: metrics.wpm
                });

                const result = await saveSession({
                    transcript: transcript.transcript,
                    duration: elapsedTime,
                    filler_words: fillerData,
                    wpm: metrics.wpm,
                    clarity_score: metrics.clarityScore,
                    title: `Session ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`
                });
                console.log('[SessionPage] Save result received:', result);

                if (result.session) {
                    console.log('[SessionPage] Session saved successfully. Initiating redirect...');

                    // Show single consolidated toast with streak + save confirmation
                    const streakText = isNewDay ? `🔥 ${currentStreak} Day Streak!` : '✓ Great practice!';
                    toast.success(streakText, {
                        id: 'session-feedback',
                        description: 'Session saved • Redirecting to analysis...',
                        duration: 3000,
                    });

                    // Short delay to let the toast be seen and ensure state updates
                    setTimeout(() => {
                        console.log('[SessionPage] calling navigate(/analytics)');
                        navigate('/analytics');
                    }, 1000);
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
                    toast.error(
                        `Monthly usage limit reached (${formatRemainingTime(usageLimit.limit_seconds)}). Upgrade to Pro for unlimited practice.`,
                        {
                            action: {
                                label: 'Upgrade',
                                onClick: () => window.location.href = '/#pricing'
                            },
                            duration: 8000
                        }
                    );
                    return;
                }

                // Warn if running low on time (less than 5 minutes)
                if (!isProUser && usageLimit && usageLimit.remaining_seconds > 0 && usageLimit.remaining_seconds < 300) {
                    toast.warning(
                        `Only ${formatRemainingTime(usageLimit.remaining_seconds)} remaining this month.`,
                        { duration: 5000 }
                    );
                }

                console.log('[SessionPage] Starting session with mode:', mode);
                await startListening({
                    forceNative: mode === 'native',
                    forcePrivate: mode === 'private',
                    forceCloud: mode === 'cloud'
                });
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

    const isButtonDisabled = isListening && !isReady;

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

            <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <SheetContent>
                    <SheetHeader>
                        <SheetTitle>Session Settings</SheetTitle>
                    </SheetHeader>
                    <div className="mt-6">
                        <CustomVocabularyManager />
                    </div>
                </SheetContent>
            </Sheet>

            <div className="max-w-7xl mx-auto px-6 pb-12 space-y-6">
                {/* Live Recording Card - Full Width */}
                <LiveRecordingCard
                    mode={mode}
                    isListening={isListening}
                    isReady={isReady}
                    isProUser={isProUser}
                    modelLoadingProgress={modelLoadingProgress}
                    formattedTime={metrics.formattedTime}
                    isButtonDisabled={isButtonDisabled}
                    onModeChange={setMode}
                    onSettingsOpen={() => setIsSettingsOpen(true)}
                    onStartStop={handleStartStop}
                />

                {/* Live Transcript Display - Right below Live Recording */}
                <LiveTranscriptPanel
                    transcript={transcript.transcript}
                    isListening={isListening}
                    containerRef={transcriptContainerRef}
                />
            </div>

            {/* Metrics Cards - Full Width Stacked */}
            <div className="max-w-7xl mx-auto px-6 pb-12 space-y-6">
                {/* Clarity Score */}
                <ClarityScoreCard
                    clarityScore={metrics.clarityScore}
                    clarityLabel={metrics.clarityLabel}
                />

                {/* Pause Analysis - Right below Clarity Score */}
                <div>
                    <PauseMetricsDisplay metrics={pauseMetrics} isListening={isListening} />
                </div>

                {/* Filler Words */}
                <FillerWordsCard
                    fillerCount={metrics.fillerCount}
                    fillerData={fillerData}
                />

                {/* Speaking Rate - Above Speaking Tips */}
                <SpeakingRateCard
                    wpm={metrics.wpm}
                    wpmLabel={metrics.wpmLabel}
                />

                {/* Speaking Tips */}
                <SpeakingTipsCard />

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