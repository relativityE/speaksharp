import React, { useState, useEffect, useRef } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSessionStore } from '../stores/useSessionStore';
import { useVocalAnalysis } from '../hooks/useVocalAnalysis';

import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mic, Square, Play } from 'lucide-react';
import { useAuthProvider } from '../contexts/AuthProvider';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSessionMetrics } from '@/hooks/useSessionMetrics';
import { PauseMetricsDisplay } from '@/components/session/PauseMetricsDisplay';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Settings } from 'lucide-react';
import { CustomVocabularyManager } from '@/components/session/CustomVocabularyManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';

export const SessionPage: React.FC = () => {
    const { session } = useAuthProvider();
    const { data: profile, isLoading: isProfileLoading, error: profileError } = useUserProfile();

    // Use zustand store for session state
    const { updateElapsedTime, elapsedTime } = useSessionStore();

    console.log('[DEBUG] SessionPage rendered. Session:', session?.user?.id);
    console.log('[DEBUG] SessionPage profile state:', { isProfileLoading, profileError, profileId: profile?.id });

    const [customWords] = useState<string[]>([]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [mode, setMode] = useState<'cloud' | 'native' | 'on-device'>('native');
    const startTimeRef = useRef<number | null>(null);

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

    if (isProfileLoading) {
        console.log('[DEBUG] SessionPage: Loading profile...');

        return <SessionPageSkeleton />;
    }

    if (profileError) {
        console.log('[DEBUG] SessionPage: Profile error:', profileError);
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
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
            await stopListening();
            // Track session end with metrics
            posthog.capture('session_ended', {
                duration: elapsedTime,
                wpm: metrics.wpm,
                clarity_score: metrics.clarityScore,
                filler_count: metrics.fillerCount
            });
        } else {
            await startListening({
                forceNative: mode === 'native',
                forceOnDevice: mode === 'on-device',
                forceCloud: mode === 'cloud'
            });
            // Track session start
            posthog.capture('session_started', { mode });
        }
    };

    const isButtonDisabled = isListening && !isReady;
    console.log('[DEBUG] Button render. Disabled:', isButtonDisabled, 'isListening:', isListening, 'isReady:', isReady);

    return (
        <div className="min-h-screen bg-background">
            {/* Page Header */}
            <div className="flex items-center justify-between py-8 px-6 max-w-7xl mx-auto">
                <div>
                    <h1 className="text-4xl font-bold text-foreground mb-2">Practice Session</h1>
                    <p className="text-muted-foreground">Speak clearly and we'll analyze your speech patterns in real-time</p>
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setIsSettingsOpen(true)}
                    data-testid="session-settings-button"
                    aria-label="Open session settings"
                >
                    <Settings className="h-5 w-5" aria-hidden="true" />
                </Button>
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
                <div className="bg-card border-2 border-white rounded-lg shadow-elegant">
                    <div className="p-8">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-4">
                                <h2 className="text-xl font-semibold text-foreground">Live Recording</h2>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="sm" className="gap-2">
                                            {mode === 'native' ? 'Native' : mode === 'on-device' ? 'On-Device' : 'Cloud AI'}
                                            <ChevronDown className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as 'cloud' | 'native' | 'on-device')}>
                                            <DropdownMenuRadioItem value="native">Native (Browser)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="on-device">On-Device (Whisper)</DropdownMenuRadioItem>
                                            <DropdownMenuRadioItem value="cloud">Cloud AI (AssemblyAI)</DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <Badge className={isReady ? "bg-orange-500/10 text-orange-500 border-orange-500/20" : "bg-muted/10 text-muted-foreground border-muted/20"} data-testid="session-status-indicator">
                                {isReady ? 'READY' : 'LOADING'}
                            </Badge>
                        </div>

                        <div className="flex flex-col items-center py-12 bg-background/30 rounded-lg border border-white/10">
                            {/* Mic Icon Circle */}
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${isListening ? 'bg-red-500/20' : 'bg-primary'}`}>
                                <Mic className={`w-12 h-12 ${isListening ? 'text-red-500' : 'text-white'}`} strokeWidth={2} />
                            </div>

                            {/* Model Loading Indicator */}
                            {modelLoadingProgress !== null && (
                                <div className="mb-6 w-full max-w-md" data-testid="model-loading-indicator">
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
                            <div className="text-5xl font-mono font-bold text-foreground mb-2">{metrics.formattedTime}</div>
                            <p className="text-muted-foreground mb-8" data-testid="transcript-display">
                                {isListening ? 'Recording in progress...' : 'Click start to begin recording'}
                            </p>

                            {/* Control Button */}
                            <Button
                                onClick={handleStartStop}
                                size="lg"
                                variant={isListening ? 'destructive' : 'default'}
                                className="w-48 h-14 text-lg font-semibold hidden md:flex"
                                disabled={isButtonDisabled || modelLoadingProgress !== null}
                                data-testid="session-start-stop-button"
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
            </div>

            {/* Metrics Grid - 2 Columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Clarity Score */}
                <div className="bg-card border-2 border-white rounded-lg p-8 shadow-elegant">
                    <h3 className="text-lg font-semibold text-foreground mb-6">Clarity Score</h3>
                    <div className="flex flex-col items-center">
                        <div className="text-6xl font-bold text-primary mb-2">{Math.round(metrics.clarityScore)}%</div>
                        <p className="text-sm text-muted-foreground">
                            {metrics.clarityLabel}
                        </p>
                    </div>
                </div>

                {/* Speaking Rate */}
                <div className="bg-card border-2 border-white rounded-lg p-8 shadow-elegant">
                    <h3 className="text-lg font-semibold text-foreground mb-6">Speaking Rate</h3>
                    <div className="flex flex-col items-center">
                        <div className="text-6xl font-bold text-primary mb-2">{metrics.wpm}</div>
                        <p className="text-sm text-muted-foreground mb-3">words per minute</p>
                        <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">
                            {metrics.wpmLabel}
                        </Badge>
                    </div>
                </div>

                {/* Filler Words */}
                <div className="bg-card border-2 border-white rounded-lg p-8 shadow-elegant">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                        <h3 className="text-lg font-semibold text-foreground">Filler Words</h3>
                    </div>
                    <div className="flex flex-col items-center mb-4">
                        <div className="text-5xl font-bold text-orange-500 mb-2">{metrics.fillerCount}</div>
                        <p className="text-sm text-muted-foreground">detected this session</p>
                    </div>
                    <div className="mt-4">
                        <p className="text-xs text-muted-foreground mb-2">Recent:</p>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(fillerData).map(([word, data]) => (
                                data.count > 0 && (
                                    <Badge key={word} variant="secondary" className="text-xs">
                                        "{word}"
                                    </Badge>
                                )
                            ))}
                            {metrics.fillerCount === 0 && (
                                <p className="text-xs text-muted-foreground italic">None detected yet</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Speaking Tips */}
                <div className="bg-card border-2 border-white rounded-lg p-8 shadow-elegant">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-1 h-6 bg-primary rounded"></div>
                        <h3 className="text-lg font-semibold text-foreground">Speaking Tips</h3>
                    </div>
                    <div className="space-y-4">
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

                {/* Pause Metrics */}
                <div className="md:col-span-2">
                    <PauseMetricsDisplay metrics={pauseMetrics} isListening={isListening} />
                </div>

                {/* Live Transcript Display */}
                <div className="bg-card border-2 border-white rounded-lg p-8 shadow-elegant md:col-span-2" data-testid="transcript-panel">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-1 h-6 bg-primary rounded"></div>
                        <h3 className="text-lg font-semibold text-foreground">Live Transcript</h3>
                    </div>
                    <div className="h-[250px] overflow-y-auto p-4 rounded-lg bg-background/50 border border-white/10" data-testid="transcript-container">
                        {isListening && (!transcript.transcript || transcript.transcript.trim() === '') ? (
                            <p className="text-muted-foreground italic animate-pulse">Listening...</p>
                        ) : transcript.transcript && transcript.transcript.trim() !== '' ? (
                            <p className="text-foreground leading-relaxed">{transcript.transcript}</p>
                        ) : (
                            <p className="text-muted-foreground italic">Your spoken words will appear here</p>
                        )}
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