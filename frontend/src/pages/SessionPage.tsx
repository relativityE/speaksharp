import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { clearSessionRecoveryDraft, getSessionRecoveryDraft, type SessionRecoveryDraft } from '@/services/sessionRecoveryDraft';
import { useSessionStore } from '@/stores/useSessionStore';

/**
 * ARCHITECTURE:
 * SessionPage is now a "Thin View" component.
 * All complex state orchestration, timer logic, and persistence flows 
 * have been extracted into useSessionLifecycle.
 */
export const SessionPage: React.FC = () => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [recoveryDraft, setRecoveryDraft] = useState<SessionRecoveryDraft | null>(null);
    const { runtimeState } = useTranscriptionContext();
    const transcriptContainerRef = useRef<HTMLDivElement>(null);
    const previousTranscriptScrollHeightRef = useRef(0);
    const [coachingAssignment] = useState(() => getSessionCoachingAssignment());
    const { data: usageLimit } = useUsageLimit();
    const updateRecoveredTranscript = useSessionStore(state => state.updateTranscript);
    const setRecoveredChunks = useSessionStore(state => state.setChunks);
    const setRecoveredStatus = useSessionStore(state => state.setSTTStatus);
    const sessionSaved = useSessionStore(state => state.sessionSaved);
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
        canUsePrivateStt,
        canUseCloudStt,
        activeEngine,
        isButtonDisabled,
        history
    } = useSessionLifecycle();

    const restoreRecoveryDraft = useCallback((draft: SessionRecoveryDraft) => {
        clearSessionRecoveryDraft(draft.sessionId);
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
        setRecoveryDraft(null);
    }, [setRecoveredChunks, setRecoveredStatus, updateRecoveredTranscript]);

    useEffect(() => {
        if (isListening) {
            setRecoveryDraft(null);
            return;
        }
        // A successfully-saved session is NOT an orphaned draft to recover. The stop flow writes a
        // transient crash-safety recovery draft and clears it only after the async save completes;
        // surfacing it on isListening->false would falsely tell the user their saved work is "unsaved".
        // Suppress the banner (and drop the stale draft) once the current session is persisted.
        if (sessionSaved) {
            clearSessionRecoveryDraft();
            setRecoveryDraft(null);
            return;
        }
        const draft = getSessionRecoveryDraft();
        setRecoveryDraft(draft);
        if (!draft || transcriptContent.trim()) return;

        restoreRecoveryDraft(draft);
    }, [isListening, sessionSaved, restoreRecoveryDraft, transcriptContent]);

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
                message: '✓ Session saved. Review it in Analytics when you are ready.'
            } as SttStatus;
        }
        return sttStatus as SttStatus;
    };

    const baseStatus = getBaseStatus();
    const privateSampleSecondsRemaining = usageLimit?.private_sample_available
        ? Math.max(0, usageLimit.private_sample_seconds_remaining ?? 0)
        : 0;
    const privateSampleStatusDetail = privateSampleSecondsRemaining > 0
        ? 'Private sample: up to 5 minutes. We’ll stop and save when the sample ends.'
        : usageLimit && !usageLimit.is_pro && usageLimit.private_sample_completed_at
            ? 'Private transcription is part of Early Access. Upgrade to keep using local Private transcription, full session history, and deeper reports. Browser transcription is still available.'
        : undefined;
    const shouldShowPrivateSampleDetail = ['idle', 'ready', 'recording', 'info'].includes(baseStatus.type);

    const visibleModelLoadingProgress =
        canUsePrivateStt && mode === 'private' ? modelLoadingProgress : null;
    // 2. Compose Final Status (Attach active Private model progress only)
    const displayStatus: SttStatus = {
        ...baseStatus,
        detail: baseStatus.detail ?? (shouldShowPrivateSampleDetail ? privateSampleStatusDetail : undefined),
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
                {recoveryDraft && !isListening && (
                    <div
                        className="mt-3 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
                        data-testid="session-recovery-actions"
                    >
                        <span className="font-medium text-foreground/80">
                            An unsaved transcript draft is available from this browser.
                        </span>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => restoreRecoveryDraft(recoveryDraft)}
                                data-testid="session-recovery-restore"
                            >
                                Restore draft
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    clearSessionRecoveryDraft(recoveryDraft.sessionId);
                                    setRecoveryDraft(null);
                                }}
                                data-testid="session-recovery-dismiss"
                            >
                                Dismiss
                            </Button>
                        </div>
                    </div>
                )}
                {showAnalyticsPrompt && (
                    <div
                        className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
                        data-testid="post-save-review-actions"
                    >
                        <span className="font-medium text-foreground/80">
                            Your session is saved. Review trends, transcript detail, and coaching notes in Analytics.
                        </span>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            {mode === 'native' && canUsePrivateStt && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setMode('private')}
                                    data-testid="post-save-private-cta"
                                >
                                    Set up Private for cleaner local transcription
                                </Button>
                            )}
                            <Button asChild size="sm" data-testid="post-save-review-session-link">
                                <Link to="/analytics">View analytics</Link>
                            </Button>
                        </div>
                    </div>
                )}
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
                                    isFinalizing={isTranscriptFinalizing}
                                    canUsePrivate={canUsePrivateStt}
                                    isPaidProUser={usageLimit?.is_pro === true}
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
                                    recordingDurationSeconds={elapsedTime}
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
