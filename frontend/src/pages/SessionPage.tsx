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
    const [isPromoExpiredDismissed, setIsPromoExpiredDismissed] = useState(false);
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

    useEffect(() => {
        if (!showPromoExpiredDialog) {
            setIsPromoExpiredDismissed(false);
        }
    }, [showPromoExpiredDialog]);


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
        <main 
            aria-label="Practice Session" 
            data-testid="session-page" 
            className="min-h-screen bg-gradient-subtle pt-20"
        >
            {/* Page Header */}
            <div className="py-4 px-6 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="text-center md:col-start-2">
                    <h1 className="text-2xl font-bold text-foreground mb-1">Practice Session</h1>
                    <p className="text-xs text-muted-foreground">Record, review, and track your speaking patterns</p>
                </div>

                {/* Manual Download Trigger */}
                {isProUser && mode === 'private' && sttStatus.type === 'download-required' && (
                    <div className="md:col-start-3 justify-self-center md:justify-self-end animate-in fade-in slide-in-from-top-2 duration-500" data-model-status="not-downloaded">
                        <Button
                            size="sm"
                            onClick={() => {
                                void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private'));
                            }}
                            className="gap-2 h-11 w-full min-w-40 px-4 text-xs font-semibold leading-tight transition-all group sm:w-auto"
                            data-testid="download-model-button"
                        >
                            <div className="relative">
                                <Settings className="h-4 w-4 animate-spin-slow group-hover:scale-110 transition-transform" />
                                <div className="absolute -top-1 -right-1 h-1.5 w-1.5 bg-primary-foreground rounded-full animate-pulse" />
                            </div>
                            <span className="flex flex-col items-start text-left">
                                <span>Download</span>
                                <span>Offline Model</span>
                            </span>
                        </Button>
                        <p className="mt-2 max-w-48 text-center text-[11px] leading-snug text-muted-foreground md:text-right">
                            One-time private setup. Your transcription runs locally after download.
                        </p>
                    </div>
                )}
            </div>

            {/* Status Bar - Spans full width of the main content area */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-0">
                <StatusNotificationBar status={displayStatus} className="shadow-card" />
            </div>

            {/* Main Content Grid — Symmetrically Aligned */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-36 md:pb-6 mt-0">
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
                                className="min-h-half bg-white border border-border rounded-lg"
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
                                className="bg-white border border-border rounded-lg h-full"
                            />
                        </LocalErrorBoundary>
                        <LocalErrorBoundary isolationKey="speaking-rate" componentName="SpeakingRateCard">
                            <SpeakingRateCard
                                wpm={metrics.wpm}
                                wpmLabel={metrics.wpmLabel}
                                className="bg-white border border-border rounded-lg h-full"
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
                                className="min-h-double bg-white border border-border rounded-lg h-full"
                            />
                        </LocalErrorBoundary>
                    </div>

                    {/* Right: Filler Words — matches Row 2 height */}
                    <div>
                        <LocalErrorBoundary isolationKey="filler-words" componentName="FillerWordsCard">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={fillerData}
                                className="min-h-double bg-white border border-border rounded-lg h-full"
                                headerAction={
                                    <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-primary underline-offset-4 hover:bg-primary/10 hover:text-primary"
                                                data-testid="add-custom-word-button"
                                            >
                                                <Settings className="h-4 w-4" />
                                                Custom
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-80 bg-white border-border shadow-card mr-6">
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
                            <SpeakingTipsCard className="bg-white border border-border rounded-lg compact" />
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
                open={showPromoExpiredDialog && !isPromoExpiredDismissed}
                onOpenChange={(open) => {
                    if (!open) {
                        setIsPromoExpiredDismissed(true);
                    }
                }}
            />
        </main>
    );
};

export default SessionPage;
