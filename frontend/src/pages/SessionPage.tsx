import React, { useState, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
// ... existing imports ...
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { PauseMetricsDisplay } from '@/components/session/PauseMetricsDisplay';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
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
    const previousTranscriptScrollHeightRef = useRef(0);

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
        micLevel,
        hasSpeechActivity,
        transcriptContent,
        interimTranscript,
        fillerData,
        isProUser,
        canUseCloudStt,
        activeEngine,
        isButtonDisabled,
        history
    } = useSessionLifecycle();

    // Keep live transcript pinned only while the user is already reading the latest text.
    useEffect(() => {
        const container = transcriptContainerRef.current;
        if (container && transcriptContent) {
            const previousScrollHeight = previousTranscriptScrollHeightRef.current;
            const previousDistanceFromBottom = previousScrollHeight - container.clientHeight - container.scrollTop;
            const wasAtBottom = previousScrollHeight <= container.clientHeight || previousDistanceFromBottom <= 48;

            if (wasAtBottom) {
                container.scrollTop = container.scrollHeight;
            }

            previousTranscriptScrollHeightRef.current = container.scrollHeight;
        }
    }, [transcriptContent, interimTranscript]);

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

    const visibleModelLoadingProgress =
        isProUser && mode === 'private' ? modelLoadingProgress : null;
    // 2. Compose Final Status (Attach active Private model progress only)
    const displayStatus: SttStatus = {
        ...baseStatus,
        progress: visibleModelLoadingProgress ?? undefined
    };

    return (
        <main 
            aria-label="Practice Session" 
            data-testid="session-page" 
            className="min-h-screen bg-background pt-20"
        >
            {/* Page Header */}
            <div className="py-4 px-6 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="text-center md:col-start-2">
                    <h1 className="text-2xl font-bold text-foreground mb-1">Practice Session</h1>
                    <p className="text-xs text-muted-foreground">Record, review, and track your speaking patterns</p>
                </div>

            </div>

            {/* Status Bar - Spans full width of the main content area */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-0">
                <StatusNotificationBar status={displayStatus} className="shadow-card" />
            </div>

            {/* Main Content — recording/transcript workspace with filler words as a right rail */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-36 md:pb-6 mt-0">
                {/* Workspace grid is isolated so the sticky filler rail cannot overlap stats below. */}
                <div className="grid grid-cols-1 items-start gap-6 pt-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">

                    <div className="contents lg:block lg:space-y-6">
                        {/* === WORKSPACE LEFT: Recording Control === */}
                        <div className="order-1 lg:order-none">
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
                                    canUseCloudStt={canUseCloudStt}
                                    activeEngine={activeEngine}
                                    statusMessage={sttStatus.message}
                                    formattedTime={metrics.formattedTime}
                                    elapsedSeconds={elapsedTime}
                                    isButtonDisabled={isButtonDisabled}
                                    onModeChange={setMode}
                                    onPrivateSetup={() => {
                                        void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private'));
                                    }}
                                    onStartStop={() => { void handleStartStop(); }}
                                    className="min-h-[300px] md:min-h-[340px]"
                                />
                            </LocalErrorBoundary>
                        </div>

                        {/* === WORKSPACE LEFT: Live Transcript === */}
                        <div className="order-3 lg:order-none">
                            <LocalErrorBoundary isolationKey="live-transcript" componentName="LiveTranscriptPanel">
                                <LiveTranscriptPanel
                                    transcript={transcriptContent}
                                    interimTranscript={interimTranscript}
                                    history={history}
                                    isListening={isListening}
                                    sttMode={mode}
                                    micLevel={micLevel}
                                    hasSpeechActivity={hasSpeechActivity}
                                    containerRef={transcriptContainerRef}
                                    className="min-h-[360px] bg-white border border-border rounded-lg h-full"
                                />
                            </LocalErrorBoundary>
                        </div>
                    </div>

                    {/* === WORKSPACE RIGHT: Filler Words Rail === */}
                    <aside className="order-2 self-start lg:sticky lg:top-24 lg:order-none">
                        <LocalErrorBoundary isolationKey="filler-words" componentName="FillerWordsCard">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={fillerData}
                                fillerExplanation={metrics.fillerExplanation}
                                className="min-h-[300px] md:min-h-[340px] bg-white border border-border rounded-lg lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"
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
                    </aside>
                </div>

                {/* === ROW 3: Secondary Metrics === */}
                <div
                    className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3"
                    data-testid="metrics-panel"
                    data-metrics-settled={elapsedTime > 0 ? "true" : "false"}
                >
                    <LocalErrorBoundary isolationKey="clarity-score" componentName="ClarityScoreCard">
                        <ClarityScoreCard
                            clarityScore={metrics.clarityScore}
                            clarityLabel={metrics.clarityLabel}
                            clarityExplanation={metrics.clarityExplanation}
                            isClarityScorable={metrics.isClarityScorable}
                            className="bg-white border border-border rounded-lg h-full"
                        />
                    </LocalErrorBoundary>
                    <LocalErrorBoundary isolationKey="speaking-rate" componentName="SpeakingRateCard">
                        <SpeakingRateCard
                            wpm={metrics.wpm}
                            wpmLabel={metrics.wpmLabel}
                            wpmExplanation={metrics.wpmExplanation}
                            className="bg-white border border-border rounded-lg h-full"
                        />
                    </LocalErrorBoundary>
                    <LocalErrorBoundary isolationKey="pause-metrics" componentName="PauseMetricsDisplay">
                        <PauseMetricsDisplay
                            metrics={pauseMetrics}
                            className="bg-white border border-border rounded-lg h-full"
                        />
                    </LocalErrorBoundary>
                </div>

                {/* === ROW 4: Full-Width Quick Tips === */}
                <div className="mt-6">
                    <LocalErrorBoundary isolationKey="speaking-tips" componentName="SpeakingTipsCard">
                        <SpeakingTipsCard
                            wpm={metrics.wpm}
                            fillerCount={metrics.fillerCount}
                            clarityScore={metrics.clarityScore}
                            pauseMetrics={pauseMetrics}
                            className="bg-white border border-border rounded-lg compact"
                        />
                    </LocalErrorBoundary>
                </div>
            </div>

            {/* Mobile Sticky Action Bar */}
            <MobileActionBar
                isListening={isListening}
                isButtonDisabled={isButtonDisabled}
                modelLoadingProgress={visibleModelLoadingProgress}
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

        </main>
    );
};

export default SessionPage;
