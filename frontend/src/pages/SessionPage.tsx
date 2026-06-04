import React, { useState, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
// ... existing imports ...
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { UserFillerWordsManager } from '@/components/session/UserFillerWordsManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { FillerWordsCard } from '@/components/session/FillerWordsCard';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { LiveCoachingScoreCard } from '@/components/session/LiveCoachingScoreCard';
import { LiveRecordingCard } from '@/components/session/LiveRecordingCard';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { StatusNotificationBar } from '@/components/session/StatusNotificationBar';
import { SttStatus } from '@/types/transcription';
import { LocalErrorBoundary } from '@/components/LocalErrorBoundary';
import { SunsetModals } from '@/components/session/SunsetModals';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import {
    getSessionCoachingAssignment,
} from '@/services/sessionCoachingExperiment';
import { formatRemainingTime, useUsageLimit } from '@/hooks/useUsageLimit';
import { getSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';
import { useSessionStore } from '@/stores/useSessionStore';

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
    const [coachingAssignment] = useState(() => getSessionCoachingAssignment());
    const { data: usageLimit } = useUsageLimit();
    const updateRecoveredTranscript = useSessionStore(state => state.updateTranscript);
    const setRecoveredChunks = useSessionStore(state => state.setChunks);
    const setRecoveredStatus = useSessionStore(state => state.setSTTStatus);
    const isTranscriptFinalizing = useSessionStore(state => state.isTranscriptFinalizing);
    const nativeFormatting = useSessionStore(state => state.nativeFormatting);

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

    useEffect(() => {
        if (isListening || transcriptContent.trim()) return;
        const draft = getSessionRecoveryDraft();
        if (!draft) return;

        updateRecoveredTranscript(draft.transcript, '');
        setRecoveredChunks([{
            transcript: draft.transcript,
            timestamp: new Date(draft.savedAt).getTime() || Date.now(),
            isFinal: true,
        }]);
        setRecoveredStatus({
            type: 'warning',
            message: 'Recovered unsaved session draft.',
            detail: 'Your last transcript was kept on this device after a save issue.',
        });
    }, [isListening, setRecoveredChunks, setRecoveredStatus, transcriptContent, updateRecoveredTranscript]);

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
    const trialSecondsRemaining = usageLimit?.trial_active
        ? Math.max(0, usageLimit.trial_seconds_remaining ?? 0)
        : 0;
    const trialStatusDetail = trialSecondsRemaining > 0
        ? `Trial access: ${formatRemainingTime(trialSecondsRemaining)} left for Private/Vault Mode.`
        : undefined;
    const shouldShowTrialDetail = ['idle', 'ready', 'recording', 'info'].includes(baseStatus.type);

    const visibleModelLoadingProgress =
        isProUser && mode === 'private' ? modelLoadingProgress : null;
    // 2. Compose Final Status (Attach active Private model progress only)
    const displayStatus: SttStatus = {
        ...baseStatus,
        detail: baseStatus.detail ?? (shouldShowTrialDetail ? trialStatusDetail : undefined),
        progress: visibleModelLoadingProgress ?? undefined
    };
    return (
        <main 
            aria-label="Practice Session" 
            data-testid="session-page" 
            className="min-h-screen bg-background pt-20"
        >
            {/* Page Header */}
            <div className="py-4 px-6 max-w-7xl mx-auto">
                <div className="text-center">
                    <h1 className="mb-1 text-3xl font-extrabold tracking-tight text-foreground">Practice Session</h1>
                    <p className="text-xs font-semibold text-foreground/70">Record, review, and track your speaking patterns</p>
                </div>
            </div>

            {/* Status Bar - Spans full width of the main content area */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-0">
                <StatusNotificationBar status={displayStatus} />
            </div>

            {/* Main Content — one live workflow: controls, transcript + coach, evidence band. */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-36 md:pb-6 mt-0">
                <div className="pt-6">
                    <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
                        <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-6">
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
                                    onStartStop={() => { void handleStartStop(); }}
                                    onDownloadModel={() => {
                                        void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private'));
                                    }}
                                />
                            </LocalErrorBoundary>

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
                                    isFinalizing={isTranscriptFinalizing}
                                    nativeFormatting={nativeFormatting}
                                    className="min-h-[340px] h-full"
                                />
                            </LocalErrorBoundary>
                        </div>

                        <LocalErrorBoundary isolationKey="live-coaching-score" componentName="LiveCoachingScoreCard">
                            <LiveCoachingScoreCard
                                transcript={transcriptContent}
                                wordCount={metrics.wordCount}
                                wpm={metrics.wpm}
                                clarityScore={metrics.clarityScore}
                                fillerCount={metrics.fillerCount}
                                elapsedSeconds={elapsedTime}
                                pauseMetrics={pauseMetrics}
                                engine={mode || 'native'}
                                isListening={isListening}
                                experimentAssignment={coachingAssignment}
                                className="h-full min-h-0 self-stretch"
                            />
                        </LocalErrorBoundary>
                    </div>

                    <div className="mt-6">
                        <LocalErrorBoundary isolationKey="filler-words" componentName="FillerWordsCard">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={fillerData}
                                fillerExplanation={metrics.fillerExplanation}
                                className="min-h-0"
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
                                        <PopoverContent className="w-80 bg-white border-[hsl(var(--border-strong))] surface-shadow mr-6">
                                            <UserFillerWordsManager onWordAdded={() => setIsSettingsOpen(false)} />
                                        </PopoverContent>
                                    </Popover>
                                }
                            />
                        </LocalErrorBoundary>
                    </div>
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
