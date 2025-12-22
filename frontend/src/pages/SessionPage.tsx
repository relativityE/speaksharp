import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionStore } from '../stores/useSessionStore';
import { useVocalAnalysis } from '../hooks/useVocalAnalysis';
import { TEST_IDS } from '@/constants/testIds';

import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Square, Play, AlertTriangle, Lightbulb, Settings } from 'lucide-react';
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

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';

export const SessionPage: React.FC = () => {
    const { session } = useAuthProvider();
    const navigate = useNavigate();
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useUserProfile();

    // Use zustand store for session state
    const { updateElapsedTime, elapsedTime } = useSessionStore();

    console.log('[DEBUG] SessionPage rendered. Session:', session?.user?.id);
    console.log('[DEBUG] SessionPage profile state:', { isProfileLoading, profileError: profileError || 'none', profileId: profile?.id });

    const isProUser = isPro(profile?.subscription_status);

    // Usage limit check for pre-session validation
    const { data: usageLimit } = useUsageLimit();
    const { updateStreak } = useStreak();
    const { saveSession } = useSessionManager();

    const [customWords] = useState<string[]>([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [mode, setMode] = useState<'cloud' | 'native' | 'on-device'>('native');
    const startTimeRef = useRef<number | null>(null);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const speechRecognition = useSpeechRecognition({
        customWords,
        customVocabulary: [],
        session,
        profile
    });

    const { transcript, fillerData, startListening, stopListening, isListening, isReady, modelLoadingProgress } = speechRecognition;
    const { pauseMetrics } = useVocalAnalysis(isListening);
    console.log('[DEBUG] SessionPage speechRecognition state:', { isListening, isReady });

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

                // Update Streak & Show Positive Reinforcement
                const { currentStreak, isNewDay } = updateStreak();
                if (isNewDay) {
                    toast.success(`🔥 ${currentStreak} Day Streak!`, {
                        description: "Consistency is key. Great job!",
                        duration: 5000,
                    });
                } else {
                    toast.success("Great practice session!", {
                        description: "You're making progress.",
                    });
                }

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
                    toast.success("Session saved successfully", {
                        description: "Redirecting to analysis...",
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
                    forceOnDevice: mode === 'on-device',
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
    console.log('[DEBUG] Button render. Disabled:', isButtonDisabled, 'isListening:', isListening, 'isReady:', isReady);

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
                <div className="bg-card border border-border rounded-lg shadow-elegant">
                    <div className="p-8">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-4">
                                <h2 className="text-xl font-semibold text-foreground">Live Recording</h2>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" className="gap-2">
                                            {mode === 'native' ? 'Native' : mode === 'on-device' ? 'On-Device' : 'Cloud'}
                                            <ChevronDown className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as 'cloud' | 'native' | 'on-device')}>
                                            <DropdownMenuRadioItem value="native">Native (Browser)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="on-device" disabled={!isProUser}>
                                                On-Device (Whisper) {!isProUser && '(Pro)'}
                                            </DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="cloud" disabled={!isProUser}>
                                                Cloud (AssemblyAI) {!isProUser && '(Pro)'}
                                            </DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)} data-testid={TEST_IDS.SESSION_SETTINGS_BUTTON}>
                                    <Settings className="h-5 w-5" />
                                </Button>
                                <Badge
                                    className={`${isListening && isReady ? 'bg-green-600 text-white border-green-600' : 'bg-secondary text-white border-secondary'}`}
                                    data-testid={TEST_IDS.SESSION_STATUS_INDICATOR}
                                >
                                    {isListening
                                        ? (isReady ? '● Recording' : 'Connecting...')
                                        : 'Ready'
                                    }
                                </Badge>
                            </div>
                        </div>

                        <div className="flex flex-col items-center py-4 bg-background/30 rounded-lg border border-white/10">
                            {/* Mic Icon Circle */}
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isListening ? 'bg-red-500/20' : 'bg-primary'}`}>
                                {isListening ? (
                                    <Mic className="w-8 h-8 text-red-500" strokeWidth={2} />
                                ) : (
                                    <MicOff className="w-8 h-8 text-white" strokeWidth={2} />
                                )}
                            </div>

                            {/* Model Loading Indicator */}
                            {modelLoadingProgress !== null && (
                                <div className="mb-6 w-full max-w-md" data-testid={TEST_IDS.MODEL_LOADING_INDICATOR}>
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="text-muted-foreground">Downloading model...</span>
                                        <span className="text-primary font-medium">{Math.round(modelLoadingProgress * 100)}%</span>
                                    </div>
                                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-300 ease-out"
                                            style={{ width: `${modelLoadingProgress * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Timer */}
                            <div className="text-3xl font-medium text-foreground mb-2">{metrics.formattedTime}</div>
                            <p className="text-muted-foreground" data-testid={TEST_IDS.TRANSCRIPT_DISPLAY}>
                                {isListening ? 'Recording in progress...' : 'Click start to begin recording'}
                            </p>
                        </div>

                        {/* Control Button - Outside shaded box */}
                        <div className="flex justify-center mt-6">
                            <Button
                                onClick={handleStartStop}
                                size="lg"
                                variant={isListening ? 'destructive' : 'default'}
                                className="w-48 h-12 text-lg font-semibold hidden md:flex"
                                disabled={isButtonDisabled || modelLoadingProgress !== null}
                                data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                            >
                                {modelLoadingProgress !== null ? (
                                    <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" /> Initializing...</>
                                ) : isListening ? (
                                    <><Square className="w-5 h-5 mr-2" /> Stop</>
                                ) : (
                                    <><Play className="w-5 h-5 mr-2" /> Start</>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Live Transcript Display - Right below Live Recording */}
                <div className="bg-card border border-border rounded-lg p-6 shadow-elegant" data-testid={TEST_IDS.TRANSCRIPT_PANEL}>
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-5 bg-primary rounded"></div>
                        <h3 className="text-base font-semibold text-foreground">Live Transcript</h3>
                    </div>
                    <div
                        ref={transcriptContainerRef}
                        className="h-[250px] overflow-y-auto p-4 rounded-lg bg-background/50 border border-white/10 scroll-smooth"
                        data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                        aria-live="polite"
                        aria-label="Live transcript of your speech"
                        role="log"
                    >
                        {isListening && (!transcript.transcript || transcript.transcript.trim() === '') ? (
                            <p className="text-muted-foreground italic animate-pulse">Listening...</p>
                        ) : transcript.transcript && transcript.transcript.trim() !== '' ? (
                            <p className="text-white leading-relaxed">{transcript.transcript}</p>
                        ) : (
                            <p className="text-white/60 italic">words appear here...</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Metrics Cards - Full Width Stacked */}
            <div className="max-w-7xl mx-auto px-6 pb-12 space-y-6">
                {/* Clarity Score */}
                <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
                    <h3 className="text-lg font-semibold text-foreground mb-6">Clarity Score</h3>
                    <div className="flex flex-col items-center">
                        <div data-testid={TEST_IDS.CLARITY_SCORE_VALUE} style={{ color: '#2aa198', fontSize: '60px', fontWeight: 700, lineHeight: 1.2, marginBottom: '1rem' }}>{Math.round(metrics.clarityScore)}%</div>
                        {/* Progress bar - teal filled, orange remaining */}
                        <div className="w-full h-3 rounded-full overflow-hidden flex bg-secondary mb-3">
                            <div
                                className="h-full bg-accent transition-all duration-300"
                                style={{ width: `${metrics.clarityScore}%` }}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {metrics.clarityLabel || 'Excellent clarity!'}
                        </p>
                    </div>
                </div>

                {/* Pause Analysis - Right below Clarity Score */}
                <div>
                    <PauseMetricsDisplay metrics={pauseMetrics} isListening={isListening} />
                </div>

                {/* Filler Words */}
                <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
                    <div className="flex items-center gap-2 mb-6">
                        <AlertTriangle className="size-5 text-secondary" />
                        <h3 className="text-lg font-semibold text-foreground">Filler Words</h3>
                    </div>
                    <div className="flex flex-col items-center mb-4">
                        <div data-testid={TEST_IDS.FILLER_COUNT_VALUE} style={{ color: '#f5a623', fontSize: '60px', fontWeight: 700, lineHeight: 1.2, marginBottom: '0.5rem' }}>{metrics.fillerCount}</div>
                        <p className="text-sm text-muted-foreground">detected this session</p>
                    </div>
                    <div className="mt-4">
                        <p className="text-xs text-muted-foreground mb-2">Recent:</p>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(fillerData).map(([word, data]) => (
                                data.count > 0 && (
                                    <Badge key={word} variant="outline" className="text-xs bg-muted/50">
                                        "{word}"
                                    </Badge>
                                )
                            ))}
                            {metrics.fillerCount === 0 && (
                                <div className="flex gap-2">
                                    <Badge variant="outline" className="text-xs bg-muted/50">"um"</Badge>
                                    <Badge variant="outline" className="text-xs bg-muted/50">"uh"</Badge>
                                    <Badge variant="outline" className="text-xs bg-muted/50">"like"</Badge>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Speaking Rate - Above Speaking Tips */}
                <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
                    <h3 className="text-lg font-semibold text-foreground mb-6">Speaking Rate</h3>
                    <div className="flex flex-col items-center">
                        <div data-testid={TEST_IDS.WPM_VALUE} style={{ color: '#2aa198', fontSize: '60px', fontWeight: 700, lineHeight: 1.2, marginBottom: '0.5rem' }}>{metrics.wpm}</div>
                        <p className="text-sm text-muted-foreground mb-3">words per minute</p>
                        <Badge className="bg-secondary text-white border-secondary">
                            {metrics.wpmLabel || 'Optimal Range'}
                        </Badge>
                    </div>
                </div>

                {/* Speaking Tips */}
                <div className="bg-card border border-border rounded-lg p-8 shadow-elegant">
                    <div className="flex items-center gap-2 mb-6">
                        <Lightbulb className="size-5 text-secondary" />
                        <h3 className="text-lg font-semibold text-foreground">Speaking Tips</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SpeakingTipCard
                            title="Pace Yourself"
                            description="Maintain 120-160 words per minute for optimal clarity"
                        />
                        <SpeakingTipCard
                            title="Pause Instead"
                            description="Use intentional pauses instead of filler words"
                        />
                        <SpeakingTipCard
                            title="Practice Daily"
                            description="Regular practice builds confident speaking habits"
                        />
                    </div>
                </div>

            </div>

            {/* Mobile Sticky Action Bar */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/90 backdrop-blur-lg border-t border-white/10 md:hidden z-50 flex justify-center shadow-lg safe-area-bottom">
                <Button
                    onClick={handleStartStop}
                    size="lg"
                    variant={isListening ? 'destructive' : 'default'}
                    className="w-full max-w-sm h-12 text-lg font-semibold shadow-lg"
                    disabled={isButtonDisabled || modelLoadingProgress !== null}
                    data-testid={`${TEST_IDS.SESSION_START_STOP_BUTTON}-mobile`}
                >
                    {modelLoadingProgress !== null ? (
                        <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" /> Initializing...</>
                    ) : isListening ? (
                        <><Square className="w-5 h-5 mr-2" /> Stop Recording</>
                    ) : (
                        <><Play className="w-5 h-5 mr-2" /> Start Recording</>
                    )}
                </Button>
            </div>
        </div>

    );
};

const SpeakingTipCard: React.FC<{ title: string; description: string }> = ({ title, description }) => (
    <div className="p-3 rounded-lg bg-card/80 border border-white/15 shadow-sm">
        <h4 className="font-semibold text-foreground mb-1 text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
    </div>
);