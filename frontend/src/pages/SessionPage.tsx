import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';
// ... existing imports ...
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
import { StatusNotificationBar } from '@/components/session/StatusNotificationBar';
import { SttStatus } from '@/types/transcription';
import { PromoExpiredDialog } from '@/components/PromoExpiredDialog';
import { LocalErrorBoundary } from '@/components/LocalErrorBoundary';
import { SunsetModals } from '@/components/session/SunsetModals';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';

/**
 * ARCHITECTURE:
 * SessionPage is now a "Thin View" component.
 * All complex state orchestration, timer logic, and persistence flows 
 * have been extracted into useSessionLifecycle.
 */
export const SessionPage: React.FC = () => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const { runtimeState } = useTranscriptionContext();
    const transcriptContainerRef = useRef<HTMLDivElement>(null);

    const {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        mode,
        setMode,
        recordingIntent,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        sessionFeedbackMessage,
        sunsetModal,
        setSunsetModal,
        pauseMetrics,
        transcriptContent,
        fillerData,
        isProUser,
        activeEngine,
        isButtonDisabled,
        showPromoExpiredDialog,
        history
    } = useSessionLifecycle();

    // Auto-scroll transcript to bottom
    useEffect(() => {
        if (transcriptContainerRef.current && transcriptContent) {
            transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
        }
    }, [transcriptContent]);


    if (!metrics) return <SessionPageSkeleton />;

    // Dual-State Status Derivation (FSM + Service State)
    // We no longer choose between "Recording" OR "Downloading".
    // We pass "Recording" as the primary state, and "Downloading" as the secondary state (via progress).

    // 1. Determine Primary Status (Session State)
    const isActiveStt = sttStatus.type === 'initializing' || sttStatus.type === 'downloading' || sttStatus.type === 'fallback' || isListening;

    // Status resolution logic
    const getBaseStatus = (): SttStatus => {
        // 1. High Priority: FSM Failure Hold (Controller Lock)
        // If the controller is in a failure sequence, we DO NOT permit 
        // sessionFeedbackMessage or analytics to overwrite the error.
        if (runtimeState === 'FAILED' || runtimeState === 'FAILED_VISIBLE') {
            return sttStatus as SttStatus;
        }

        // 2. Medium Priority: Download Required (Pre-session)
        if (sttStatus.type === 'download-required') {
            return sttStatus as SttStatus;
        }

        // 3. User Feedback (Transient messages like "Session saved")
        if (sessionFeedbackMessage) {
            const isError = sessionFeedbackMessage.startsWith('⚠️') || sessionFeedbackMessage.startsWith('⛔');
            return {
                type: isError ? 'error' : 'ready',
                message: sessionFeedbackMessage
            } as SttStatus;
        }

        // 4. Default: Current STT state (Recording, Ready, etc.)
        if (isActiveStt && (sttStatus as SttStatus).type !== 'idle') {
            return sttStatus as SttStatus;
        }
        if (showAnalyticsPrompt) {
            return {
                type: 'ready',
                message: '✓ Session saved. Click Analytics above to review.'
            } as SttStatus;
        }
        return sttStatus as SttStatus;
    };

    const baseStatus = getBaseStatus();

    // 2. Compose Final Status (Attach Background Progress)
    const displayStatus: SttStatus = {
        ...baseStatus,
        progress: modelLoadingProgress ?? undefined
    };

    return (
        <main aria-label="Practice Session" data-testid="session-page" data-runtime-state={runtimeState} data-engine-ready={isReady ? 'true' : 'false'} className="min-h-screen bg-gradient-subtle pt-20">
            {/* Page Header */}
            <div className="relative text-center py-4 px-6 max-w-7xl mx-auto flex flex-col items-center">
                <h1 className="text-2xl font-bold text-foreground mb-1">Practice Session</h1>
                <p className="text-xs text-muted-foreground">We'll analyze your speech patterns in real-time</p>

                {/* Top-Right Action Area: Manual Download Trigger */}
                {isProUser && mode === 'private' && sttStatus.type === 'download-required' && (
                    <div className="absolute top-4 right-6 animate-in fade-in slide-in-from-right-4 duration-500" data-model-status="not-downloaded">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private'));
                            }}
                            className="gap-2 h-9 px-4 text-[10px] font-black uppercase tracking-[0.2em] bg-primary/10 border-primary/30 hover:bg-primary/20 text-primary shadow-sm hover:shadow-md transition-all group"
                            data-testid="download-model-button"
                        >
                            <div className="relative">
                                <Settings className="h-3 w-3 animate-spin-slow group-hover:scale-110 transition-transform" />
                                <div className="absolute -top-1 -right-1 h-1.5 w-1.5 bg-primary rounded-full animate-pulse" />
                            </div>
                            <span>Download Offline Model</span>
                        </Button>
                    </div>
                )}
            </div>

            {/* Status Bar - Spans full width of the main content area */}
            <div className="max-w-7xl mx-auto px-6 mb-0">
                <StatusNotificationBar status={displayStatus} className="shadow-lg" />
            </div>

            {/* Main Content Grid — Symmetrically Aligned */}
            <div className="max-w-7xl mx-auto px-6 pb-6 mt-0">
                <div className="grid lg:grid-cols-3 gap-6 pt-6">

                    {/* === ROW 1: Half-Height (Recording + Pause | Live Stats) === */}
                    {/* Left: Recording + Pause side-by-side */}
                    <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <LocalErrorBoundary isolationKey="recording-controls" componentName="LiveRecordingCard">
                            <LiveRecordingCard
                                mode={mode || 'native'}
                                isListening={isListening}
                                isReady={isReady}
                                isPaused={sttStatus.type === 'paused'}
                                fsmState={runtimeState}
                                sttStatusType={sttStatus.type}
                                recordingIntent={recordingIntent}
                                isProUser={isProUser}
                                activeEngine={activeEngine}
                                statusMessage={sttStatus.message}
                                formattedTime={metrics.formattedTime}
                                elapsedSeconds={elapsedTime}
                                isButtonDisabled={isButtonDisabled}
                                onModeChange={setMode}
                                onStartStop={() => { void handleStartStop(); }}
                                className="min-h-half"
                            />
                        </LocalErrorBoundary>

                        <LocalErrorBoundary isolationKey="pause-metrics" componentName="PauseMetricsDisplay">
                            <PauseMetricsDisplay
                                metrics={pauseMetrics}
                                className="min-h-half bg-background/40 border border-white/5 rounded-xl"
                            />
                        </LocalErrorBoundary>
                    </div>

                    {/* Right: Live Stats (Clarity + Pace) — matches Row 1 height */}
                    <div
                        className="grid grid-cols-2 gap-4 min-h-half content-start"
                        data-testid="metrics-panel"
                        data-metrics-settled={elapsedTime > 0 ? "true" : "false"}
                    >
                        <LocalErrorBoundary isolationKey="clarity-score" componentName="ClarityScoreCard">
                            <ClarityScoreCard
                                clarityScore={metrics.clarityScore}
                                clarityLabel={metrics.clarityLabel}
                                className="bg-background/40 border border-white/5 rounded-xl h-full"
                            />
                        </LocalErrorBoundary>
                        <LocalErrorBoundary isolationKey="speaking-rate" componentName="SpeakingRateCard">
                            <SpeakingRateCard
                                wpm={metrics.wpm}
                                wpmLabel={metrics.wpmLabel}
                                className="bg-background/40 border border-white/5 rounded-xl h-full"
                            />
                        </LocalErrorBoundary>
                    </div>

                    {/* === ROW 2: Double-Height (Transcript | Filler Words) === */}
                    {/* Left: Transcript */}
                    <div className="lg:col-span-2">
                        <LocalErrorBoundary isolationKey="live-transcript" componentName="LiveTranscriptPanel">
                            <LiveTranscriptPanel
                                transcript={transcriptContent}
                                history={history}
                                isListening={isListening}
                                containerRef={transcriptContainerRef}
                                className="min-h-double bg-background/40 border border-white/5 rounded-xl h-full"
                            />
                        </LocalErrorBoundary>
                    </div>

                    {/* Right: Filler Words — matches Row 2 height */}
                    <div>
                        <LocalErrorBoundary isolationKey="filler-words" componentName="FillerWordsCard">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={fillerData}
                                className="min-h-double bg-background/40 border border-white/5 rounded-xl h-full"
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
                        </LocalErrorBoundary>
                    </div>

                    {/* === ROW 3: Full-Width Quick Tips === */}
                    <div className="lg:col-span-3">
                        <LocalErrorBoundary isolationKey="speaking-tips" componentName="SpeakingTipsCard">
                            <SpeakingTipsCard className="bg-background/40 border border-white/5 rounded-xl compact" />
                        </LocalErrorBoundary>
                    </div>

                </div>
            </div>

            {/* Mobile Sticky Action Bar */}
            <MobileActionBar
                isListening={isListening}
                isButtonDisabled={isButtonDisabled}
                modelLoadingProgress={modelLoadingProgress}
                onStartStop={() => { void handleStartStop(); }}
                isFrozen={sttStatus.isFrozen}
                onSwitchToNative={() => { void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.switchToNative()); }}
            />

            {/* Sunset Modals */}
            <SunsetModals
                open={sunsetModal.open}
                onOpenChange={(open) => setSunsetModal({ ...sunsetModal, open })}
                type={sunsetModal.type}
                isPro={isProUser}
            />

            {/* Promo Expired Dialog */}
            <PromoExpiredDialog
                open={showPromoExpiredDialog}
                onOpenChange={() => { }} // Controlled by hook data
            />
        </main>
    );
};

export default SessionPage;