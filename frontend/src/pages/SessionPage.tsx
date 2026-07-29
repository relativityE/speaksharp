import React, { useState, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
// ... existing imports ...
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { useUnresolvedRecovery } from '@/hooks/useUnresolvedRecovery';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { UserFillerWordsManager } from '@/components/session/UserFillerWordsManager';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { FillerWordsCard } from '@/components/session/FillerWordsCard';
import { LiveTranscriptPanel } from '@/components/session/LiveTranscriptPanel';
import { LiveCoachingScoreCard } from '@/components/session/LiveCoachingScoreCard';
import { LiveRecordingCard } from '@/components/session/LiveRecordingCard';
import { UnresolvedRecoveryBanner } from '@/components/session/UnresolvedRecoveryBanner';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { StatusNotificationBar } from '@/components/session/StatusNotificationBar';
import { FreestyleHelpOverlay } from '@/components/session/FreestyleHelpOverlay';
import { SttStatus } from '@/types/transcription';
import { LocalErrorBoundary } from '@/components/LocalErrorBoundary';
import { SunsetModals } from '@/components/session/SunsetModals';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import {
    getSessionCoachingAssignment,
} from '@/services/sessionCoachingExperiment';
import { useUsageLimit } from '@/hooks/useUsageLimit';
import { useSessionStore } from '@/stores/useSessionStore';
import { reconciliationStatusCopy } from '@/utils/finalizedSessionAnalysis';

/**
 * ARCHITECTURE:
 * SessionPage is now a "Thin View" component.
 * All complex state orchestration, timer logic, and persistence flows 
 * have been extracted into useSessionLifecycle.
 */
export const SessionPage: React.FC = () => {
    const { session: authSession } = useAuthProvider();
    // #1033 A5/A6: the resolved authenticated owner. Recovery reads/rehydration are scoped to it and
    // fail closed while it is unresolved — never an unscoped read.
    const authUserId = authSession?.user?.id ?? null;
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const { runtimeState } = useTranscriptionContext();
    const transcriptContainerRef = useRef<HTMLDivElement>(null);
    const previousTranscriptScrollHeightRef = useRef(0);
    const [coachingAssignment] = useState(() => getSessionCoachingAssignment());
    const { data: usageLimit } = useUsageLimit();
    // #1033 Part-2b: authoritative engine-selection lock + pending recovery, published by the controller.
    const engineSelectionLocked = useSessionStore(state => state.engineSelectionLocked);
    const pendingResolutionKind = useSessionStore(state => state.pendingResolutionKind);
    const sessionSaved = useSessionStore(state => state.sessionSaved);
    const isTranscriptFinalizing = useSessionStore(state => state.isTranscriptFinalizing);
    // #1089: the duration of the session under review. Falls back to the live timer while recording
    // (the snapshot is only published at stop); after a stop the live timer is 0 but this is not.
    const completedSessionDurationSeconds = useSessionStore(state => state.completedSessionDurationSeconds);
    const nativeFormatting = useSessionStore(state => state.nativeFormatting);
    const finalizedAnalysis = useSessionStore(state => state.finalizedAnalysis);

    const {
        isListening,
        isReady,
        metrics,
        sttStatus,
        modelLoadingProgress,
        privateModelStatus,
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
        isProUser,
        canUsePrivateStt,
        canUseCloudStt,
        activeEngine,
        isButtonDisabled,
        history
    } = useSessionLifecycle();

    // #1033 Part-2b (A5/A6): all owner-scoped recovery orchestration lives in this hook —
    // owner-scoped read, fail-closed on unresolved auth, same-user rehydrate-once, account-change
    // isolation, and scoped (never destructive no-arg) draft deletion.
    const { recoveryDraft, restoreRecoveryDraft, dismissRecoveryDraft } = useUnresolvedRecovery({
        authUserId,
        isListening,
        sessionSaved,
        transcriptContent,
    });

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
    // #1042 PR2: the "How Freestyle Practice works" help overlay is available only when the session is idle
    // (before recording / after a successful save). It is disabled during starting, initializing, recording,
    // stopping, finalizing/saving, or an unresolved recovery. This is derived ENTIRELY from the existing
    // authoritative projection (runtime FSM + isActiveStt + finalizing + pendingResolutionKind) — no second
    // lock model. The controller's recording lifecycle is INITIATING/ENGINE_INITIALIZING/RECORDING/STOPPING.
    const scoringDurationSeconds = completedSessionDurationSeconds ?? elapsedTime;

    const helpOverlayAvailable = !(
        // engineSelectionLocked is set synchronously on Start INTENT (before the FSM reaches INITIATING),
        // so it closes the start-intent window where runtimeState/isListening/sttStatus are still idle —
        // the same authoritative lock the mode selector uses; no separate lock model. When it flips true
        // the overlay's own effect also auto-closes an already-open guide.
        engineSelectionLocked ||
        isActiveStt ||
        isTranscriptFinalizing ||
        pendingResolutionKind !== null ||
        runtimeState === 'INITIATING' ||
        runtimeState === 'ENGINE_INITIALIZING' ||
        runtimeState === 'RECORDING' ||
        runtimeState === 'STOPPING'
    );

    // Track 1: the post-save UI (settled copy, Analytics action, Private CTA, toast) is shown only once
    // finalization is TERMINAL — the controller publishes finalizedAnalysis after persistence +
    // reconciliation + the native formatter reaches complete/failed and the final text is applied. Until
    // then the transcript keeps its finalizing/tidying treatment and no settled/ready claim is made.
    const postSaveReady = showAnalyticsPrompt && !!finalizedAnalysis;
    // Mode-aware reconciliation status copy for the consolidated status bar's left side.
    // Native discrepancy → "…Browser transcription may omit some…"; Private never gets Browser copy.
    const reconciliationCopy = finalizedAnalysis
        ? reconciliationStatusCopy(finalizedAnalysis.reconciliation, { mode: finalizedAnalysis.mode })
        : null;
    // After a saved Native session, the status-bar Private CTA replaces the Browser-card nudge — never both.

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

        // 2b. Post-save (TERMINAL success only): the mode-aware reconciliation copy is the authoritative
        // left-side status once BOTH finalization tracks succeed (finalizedAnalysis published). It
        // supersedes the generic save-feedback message but NOT the FAILED/download guards above.
        if (postSaveReady && reconciliationCopy) {
            return { type: 'ready', message: reconciliationCopy } as SttStatus;
        }

        // 2c. Persistence-degraded: the controller set a warning (e.g. filler/metrics persistence failed).
        // Preserve it — never let a "saved/ready" claim or the finalizing status overwrite a real warning.
        if ((sttStatus as SttStatus).type === 'warning') {
            return sttStatus as SttStatus;
        }

        // 2d. P2 — pre-terminal: persisted, but the finalized signal has NOT published yet (native formatter
        // still tidying, or reconciliation/persistence not yet joined). Show an EXPLICIT finalizing status;
        // never a "Session saved / Review in Analytics" ready claim while showAnalyticsPrompt && !postSaveReady.
        if (showAnalyticsPrompt && !postSaveReady) {
            return { type: 'initializing', message: 'Finalizing your transcript…' } as SttStatus;
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
                message: reconciliationCopy ?? '✓ Session saved. Review it in Analytics when you are ready.'
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
            {/* Page Header.
                #1047: the "How Freestyle Practice works" guide now lives INSIDE this title block, centered
                directly beneath the subhead, as its own dark-green island. It used to sit 12px above the
                Mic-ready status bar as a white outlined button — two same-width white rounded rectangles
                stacked, which read as a second status row instead of an action. Up here it is
                unambiguously an entry point into the page, and the status bar below it is free to recede. */}
            <div className="px-6 pt-4 max-w-7xl mx-auto">
                <div className="flex flex-col items-center gap-[22px] text-center mb-[34px]" data-testid="session-title-block">
                    <div>
                        <h1 className="mb-1 text-3xl font-extrabold tracking-tight text-foreground">Practice Session</h1>
                        <p className="text-xs font-semibold text-foreground/70">Record, review, and track your speaking patterns</p>
                    </div>
                    <FreestyleHelpOverlay available={helpOverlayAvailable} />
                </div>
            </div>

            {/* Status Bar - Spans full width of the main content area.
                Post-save, this ONE bar carries the reconciliation copy (left), the quiet Private CTA
                (Native + eligible), and the Analytics action (rightmost). There is no separate post-save
                surface — so a deployed state never contains two Analytics actions. */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-0">
                {/* #1042 PR2's help affordance moved UP into the title block (#1047) — see the header above. */}
                <StatusNotificationBar
                    status={displayStatus}
                    analyticsAction={postSaveReady ? { cueKey: finalizedAnalysis?.sessionId } : undefined}
                    privateCta={
                        postSaveReady && mode === 'native' && canUsePrivateStt
                            ? { onSelect: () => setMode('private') }
                            : undefined
                    }
                />
                {/* #1033 Part-2b (A3/A4): unresolved-recording recovery. Driven by the controller's
                    pendingResolutionKind — NOT by local UI guesses — so what we offer always matches what
                    the runtime will actually do. Discard is two-step confirmed and reports honestly when
                    persistence could not be reconciled (outcome 'retryable'), instead of claiming success. */}
                <UnresolvedRecoveryBanner
                    pendingResolutionKind={pendingResolutionKind}
                    hasRecoverableWords={Boolean(
                        (recoveryDraft?.transcript ?? '').trim() || (transcriptContent ?? '').trim()
                    )}
                    onRetry={() => import('@/services/SpeechRuntimeController')
                        .then(m => m.speechRuntimeController.retryRecordingSave())}
                    onDiscard={() => import('@/services/SpeechRuntimeController')
                        .then(m => m.speechRuntimeController.discardUnresolvedRecording())}
                />
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
                                onClick={() => dismissRecoveryDraft(recoveryDraft)}
                                data-testid="session-recovery-dismiss"
                            >
                                Dismiss
                            </Button>
                        </div>
                    </div>
                )}
                {/* The separate post-save-review-actions surface was removed and its actions folded into
                    the single StatusNotificationBar above (atomic with this removal). */}
            </div>

            {/* Main Content — one live workflow: controls, transcript + coach, evidence band. */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-36 md:pb-6 mt-0">
                {/* #1047: columns size to their CONTENT. `items-stretch` forced both columns to the height
                    of the taller one, which is what let the coaching card's `margin-top:auto` footer open
                    ~116px of blank space in the middle of that card, and what kept the empty transcript
                    inflated to a full-height void. */}
                <div>
                    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
                        <div className="flex flex-col gap-6">
                            <LocalErrorBoundary isolationKey="recording-controls" componentName="LiveRecordingCard">
                                <LiveRecordingCard
                                    mode={mode || 'native'}
                                    isListening={isListening}
                                    isReady={isReady}
                                    isPaused={sttStatus.type === 'paused'}
                                    fsmState={runtimeState}
                                    sttStatusType={sttStatus.type}
                                    privateModelStatus={privateModelStatus}
                                    recordingIntent={recordingIntent}
                                    isFinalizing={isTranscriptFinalizing}
                                    canUsePrivate={canUsePrivateStt}
                                    isPaidProUser={usageLimit?.is_pro === true}
                                    canUseCloudStt={canUseCloudStt}
                                    activeEngine={activeEngine}
                                    // Post-save, StatusNotificationBar owns the "Session saved" message. Suppress the
                                    // recording-card pill message as soon as showAnalyticsPrompt begins — NOT only once
                                    // postSaveReady (finalizedAnalysis) arrives — so the lifecycle's intermediate
                                    // "✓ Great practice! Session saved." never becomes a duplicate visual or aria-live
                                    // announcement in the window before finalization completes.
                                    statusMessage={showAnalyticsPrompt ? undefined : sttStatus.message}
                                    formattedTime={metrics.formattedTime}
                                    elapsedSeconds={elapsedTime}
                                    isButtonDisabled={isButtonDisabled}
                                    engineSelectionLocked={engineSelectionLocked}
                                    pendingResolutionKind={pendingResolutionKind}
                                    onModeChange={setMode}
                                    onStartStop={() => { void handleStartStop(); }}
                                    onDownloadModel={() => {
                                        void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private'));
                                    }}
                                />
                            </LocalErrorBoundary>

                            {/* StatusNotificationBar (above) is the SINGLE post-save surface. The separate
                                "Next: Analytics" toast was removed so there is exactly one saved-state signal
                                and one aria-live announcement. */}
                            <div className="relative">
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
                                    recordingDurationSeconds={scoringDurationSeconds}
                                    nativeFormatting={nativeFormatting}
                                    // No forced 340px floor: the panel now sizes to its content and grows
                                    // as words arrive (#1047).
                                />
                              </LocalErrorBoundary>
                            </div>
                        </div>

                        <LocalErrorBoundary isolationKey="live-coaching-score" componentName="LiveCoachingScoreCard">
                            <LiveCoachingScoreCard
                                transcript={transcriptContent}
                                wordCount={metrics.wordCount}
                                wpm={metrics.wpm}
                                clarityScore={metrics.clarityScore}
                                fillerCount={metrics.fillerCount}
                                // #1089: the score's usability gate (>= 30s) must judge the session under
                                // review, not the live timer that resets to 0 for the next recording.
                                elapsedSeconds={scoringDurationSeconds}
                                pauseMetrics={pauseMetrics}
                                engine={mode || 'native'}
                                isListening={isListening}
                                experimentAssignment={coachingAssignment}
                                // #1047: sizes to content, never stretched to match the recorder+transcript
                                // column (see the grid comment above).
                                className="min-h-0 self-start"
                            />
                        </LocalErrorBoundary>
                    </div>

                    <div className="mt-6">
                        <LocalErrorBoundary isolationKey="filler-words" componentName="FillerWordsCard">
                            <FillerWordsCard
                                fillerCount={metrics.fillerCount}
                                fillerData={metrics.fillerData}
                                fillerExplanation={metrics.fillerExplanation}
                                className="min-h-0"
                                headerAction={
                                    <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                                        <PopoverTrigger asChild>
                                            {/* #1047: teal secondary action, and the ONLY action on the
                                                collapsed pre-session row. Named for the OUTCOME, not the
                                                mechanism: "Customize" describes machinery and leaves the
                                                user guessing, whereas this card's whole job is to say what
                                                will be tracked — so the action says what you get. Same
                                                popover, same custom-filler-word manager as before; label
                                                only. The gear is decorative so the accessible name is
                                                exactly the visible text. */}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-accent underline-offset-4 hover:bg-accent/10 hover:text-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                data-testid="add-custom-word-button"
                                            >
                                                <Settings className="h-4 w-4" aria-hidden="true" />
                                                Add your filler words
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
                mode={mode}
                privateModelStatus={privateModelStatus}
                onDownloadModel={() => { void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private')); }}
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
