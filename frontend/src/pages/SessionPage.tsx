import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { PauseMetricsDisplay } from '@/components/session/PauseMetricsDisplay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UserFillerWordsManager } from '@/components/session/UserFillerWordsManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { ClarityScoreCard } from '@/components/session/ClarityScoreCard';
import { SpeakingRateCard } from '@/components/session/SpeakingRateCard';
import { FillerWordsCard } from '@/components/session/FillerWordsCard';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { SpeakingTipsCard } from '@/components/session/SpeakingTipsCard';
import { LiveRecordingCard } from '@/components/session/LiveRecordingCard';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { StatusNotificationBar, SttStatus } from '@/components/session/StatusNotificationBar';
import { PromoExpiredDialog } from '@/components/PromoExpiredDialog';

/**
 * ARCHITECTURE (Senior Architect):
 * SessionPage is now a "Thin View" component.
 * All complex state orchestration, timer logic, and persistence flows 
 * have been extracted into useSessionLifecycle.
 */
export const SessionPage: React.FC = () => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        mode,
        setMode,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        sessionFeedbackMessage,
        pauseMetrics,
        transcriptContent,
        fillerData,
        isProUser,
        isButtonDisabled,
        showPromoExpiredDialog,
        profileLoading,
        profileError
    } = useSessionLifecycle();

    // Auto-scroll transcript to bottom
    useEffect(() => {
        if (transcriptContainerRef.current && transcriptContent) {
            transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
        }
    }, [transcriptContent]);

    // Error/Loading states
    if (profileLoading) return <SessionPageSkeleton />;
    if (profileError) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-6">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-destructive mb-2">Error Loading Profile</h2>
                    <p className="text-muted-foreground">{profileError.message || 'Please check your connection and try again.'}</p>
                    <Button onClick={() => window.location.reload()} className="mt-4">Retry</Button>
                </div>
            </div>
        );
    }
    if (!metrics) return <SessionPageSkeleton />;

    // Derived display status for notification bar
    const displayStatus: SttStatus = sessionFeedbackMessage
        ? {
            type: sessionFeedbackMessage.startsWith('⚠️') || sessionFeedbackMessage.startsWith('⛔') ? 'error' : 'ready',
            message: sessionFeedbackMessage
        }
        : showAnalyticsPrompt
            ? { type: 'ready' as const, message: '✓ Session saved. Click Analytics above to review.' }
            : modelLoadingProgress != null
                ? { type: 'downloading' as const, message: 'Downloading model...', progress: modelLoadingProgress }
                : sttStatus;

    return (
        <div className="min-h-screen bg-gradient-subtle pt-20">
            {/* Page Header */}
            <div className="text-center py-8 px-6 max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-foreground mb-2">Practice Session</h1>
                <p className="text-sm text-muted-foreground">We'll analyze your speech patterns in real-time</p>
            </div>

            {/* Status Bar */}
            <div className="max-w-7xl mx-auto px-6 mb-6">
                <StatusNotificationBar status={displayStatus} />
            </div>

            {/* Main Content Grid */}
            <div className="max-w-7xl mx-auto px-6 pb-12">
                <div className="space-y-6">
                    {/* Row 1: Session Control & Pause Analysis */}
                    <div className="grid lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <LiveRecordingCard
                                mode={mode}
                                isListening={isListening}
                                isReady={isReady}
                                isProUser={isProUser}
                                modelLoadingProgress={modelLoadingProgress}
                                formattedTime={metrics.formattedTime}
                                elapsedSeconds={elapsedTime}
                                isButtonDisabled={isButtonDisabled}
                                onModeChange={setMode}
                                onStartStop={handleStartStop}
                            />
                        </div>
                        <div className="h-full">
                            <PauseMetricsDisplay
                                metrics={pauseMetrics}
                                isListening={isListening}
                                className="h-full"
                            />
                        </div>
                    </div>

                    {/* Row 2: Transcript & Filler Words */}
                    <div className="grid lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <LiveTranscriptPanel
                                transcript={transcriptContent}
                                isListening={isListening}
                                containerRef={transcriptContainerRef}
                                className="h-full"
                            />
                        </div>
                        <div className="h-full">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={fillerData}
                                headerAction={
                                    <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-primary underline-offset-4 hover:underline"
                                                data-testid="add-custom-word-button"
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
                        </div>
                    </div>

                    {/* Row 3: Secondary Metrics & Tips */}
                    <div className="grid lg:grid-cols-3 gap-6">
                        <ClarityScoreCard
                            clarityScore={metrics.clarityScore}
                            clarityLabel={metrics.clarityLabel}
                        />
                        <SpeakingRateCard
                            wpm={metrics.wpm}
                            wpmLabel={metrics.wpmLabel}
                        />
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
                onOpenChange={() => { }} // Controlled by hook data
            />
        </div>
    );
};

export default SessionPage;