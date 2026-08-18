import React, { useRef, useEffect } from 'react';
// ... existing imports ...
import { useSessionLifecycle } from '@/hooks/useSessionLifecycle';
import { useUnresolvedRecovery } from '@/hooks/useUnresolvedRecovery';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { Button } from '@/components/ui/button';
import { SessionPageSkeleton } from '@/components/session/SessionPageSkeleton';
import { UnresolvedRecoveryBanner } from '@/components/session/UnresolvedRecoveryBanner';
import { MobileActionBar } from '@/components/session/MobileActionBar';
import { StatusNotificationBar } from '@/components/session/StatusNotificationBar';
import { FreeformHelpOverlay } from '@/components/session/FreeformHelpOverlay';
import { SttStatus } from '@/types/transcription';
import { SessionOverhaulView } from '@/components/session/SessionOverhaulView';
import { usePracticeHistory } from '@/hooks/usePracticeHistory';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useSessionStore } from '@/stores/useSessionStore';
import { estimateFinalizeSeconds } from '@/services/transcription/finalizeRateStore';
import { reconciliationStatusCopy } from '@/utils/finalizedSessionAnalysis';
import { useNavigate } from 'react-router-dom';

/**
 * ARCHITECTURE:
 * SessionPage is now a "Thin View" component.
 * All complex state orchestration, timer logic, and persistence flows 
 * have been extracted into useSessionLifecycle.
 */
export const SessionPage: React.FC = () => {
    // #1222: the session overhaul is the ONLY session page (PO 2026-08-08). The legacy two-column body was
    // retained behind a never-true flag pending this test-migration ticket (#1231); it and its now-unused
    // imports have been removed. The live trial-unavailable notice it used to host was relocated into the
    // live chrome below (never silently dropped).
    const { session: authSession } = useAuthProvider();
    // #1033 A5/A6: the resolved authenticated owner. Recovery reads/rehydration are scoped to it and
    // fail closed while it is unresolved — never an unscoped read.
    const authUserId = authSession?.user?.id ?? null;
    const { runtimeState } = useTranscriptionContext();
    const transcriptContainerRef = useRef<HTMLDivElement>(null);
    const previousTranscriptScrollHeightRef = useRef(0);
    // #1222: real session history feeds the overhaul's Progress card (slot C, aggregate).
    const { data: practiceHistory } = usePracticeHistory();
    // #1033 Part-2b: authoritative engine-selection lock + pending recovery, published by the controller.
    const engineSelectionLocked = useSessionStore(state => state.engineSelectionLocked);
    const pendingResolutionKind = useSessionStore(state => state.pendingResolutionKind);
    const sessionSaved = useSessionStore(state => state.sessionSaved);
    const isTranscriptFinalizing = useSessionStore(state => state.isTranscriptFinalizing);
    // #1089: the duration of the session under review. Falls back to the live timer while recording
    // (the snapshot is only published at stop); after a stop the live timer is 0 but this is not.
    const completedSessionDurationSeconds = useSessionStore(state => state.completedSessionDurationSeconds);
    const finalizedAnalysis = useSessionStore(state => state.finalizedAnalysis);
    // #1306 Option A: the terminal review's word count comes from the FINAL snapshot (captured before the
    // transcript was purged), never from the now-empty live transcript.
    const finalizedWordCount = useSessionStore(state => state.finalizedWordCount);
    // #1046 slice 5a: per-point Focus Points coverage, published by the stop seam after an objective
    // session finalizes; null for Open Mic sessions (and cleared at the next recording start).
    const objectiveCoverageResult = useSessionStore(state => state.objectiveCoverageResult);
    // #1046 Focus Points: a bound brief means this is a Focus Points session — slot D shows the declared
    // points (before/during) then their resolved coverage (after), and the header help reads "How Focus
    // Points works". null ⇒ an Open Mic session (unchanged).
    const activeObjectiveBrief = useSessionStore(state => state.activeObjectiveBrief);
    // #1264 — the optional Open Mic Practice Focus (persists through a "Practice this next" repeat).
    const practiceFocus = useSessionStore(state => state.practiceFocus);
    // #1046 G6/G7 — the finished-brief snapshot, so the after-state review keeps its Focus Points coverage
    // after the live brief is cleared on save (see SpeechRuntimeController / SessionOverhaulView).
    const completedObjectiveBrief = useSessionStore(state => state.completedObjectiveBrief);
    const isObjectiveSession = Boolean(activeObjectiveBrief);
    // #891 — engine-specific finalize RTF (self-corrects from real decodes) for the "Finalizing… ~Ns"
    // countdown; the estimate itself is computed below once the recording duration is in scope.
    const activeEngineVersion = useSessionStore(state => state.activeEngineVersion);

    const {
        isListening,
        metrics,
        sttStatus,
        modelLoadingProgress,
        privateModelStatus,
        mode,
        elapsedTime,
        handleStartStop,
        showAnalyticsPrompt,
        sessionFeedbackMessage,
        micLevel,
        transcriptContent,
        interimTranscript,
        canUsePrivateStt,
        isButtonDisabled,
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

    const navigate = useNavigate();

    if (!metrics) return <SessionPageSkeleton />;

    // Dual-State Status Derivation (FSM + Service State)
    // We no longer choose between "Recording" OR "Downloading".
    // We pass "Recording" as the primary state, and "Downloading" as the secondary state (via progress).

    // 1. Determine Primary Status (Session State)
    const isActiveStt = sttStatus.type === 'initializing' || sttStatus.type === 'downloading' || sttStatus.type === 'fallback' || isListening;
    // #1042 PR2: the "How Rough Drafts works" help overlay is available only when the session is idle
    // (before recording / after a successful save). It is disabled during starting, initializing, recording,
    // stopping, finalizing/saving, or an unresolved recovery. This is derived ENTIRELY from the existing
    // authoritative projection (runtime FSM + isActiveStt + finalizing + pendingResolutionKind) — no second
    // lock model. The controller's recording lifecycle is INITIATING/ENGINE_INITIALIZING/RECORDING/STOPPING.
    const scoringDurationSeconds = completedSessionDurationSeconds ?? elapsedTime;
    // #891 — estimate now that the recording duration is in scope; feeds the "Finalizing… ~Ns" countdown.
    const finalizeEstimateSeconds = estimateFinalizeSeconds(activeEngineVersion, scoringDurationSeconds);

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

    // The post-save UI (settled copy, Analytics action, toast) is shown only once
    // finalization is TERMINAL — the controller publishes finalizedAnalysis after persistence +
    // reconciliation + formatting reaches complete/failed and the final text is applied. Until
    // then the transcript keeps its finalizing/tidying treatment and no settled/ready claim is made.
    const postSaveReady = showAnalyticsPrompt && !!finalizedAnalysis;
    // Mode-aware reconciliation status copy for the consolidated status bar's left side.
    const reconciliationCopy = finalizedAnalysis
        ? reconciliationStatusCopy(finalizedAnalysis.reconciliation, { mode: finalizedAnalysis.mode })
        : null;
    // #1222 G1: the title block (heading + dynamic subtitle + help entry) renders ONLY in the before-state
    // (idle: not recording, not finalizing, no post-save prompt). During/after it recedes so the live
    // workflow owns the frame — matching the PO's G1 mockup.
    const beforeState = !isListening && !showAnalyticsPrompt && !isTranscriptFinalizing;
    // Dynamic subtitle from REAL history. practiceHistory is newest-first, so the oldest (baseline) is last.
    const completedSessions = practiceHistory?.length ?? 0;
    const baselineIso = completedSessions > 0 ? practiceHistory?.[practiceHistory.length - 1]?.created_at : null;
    const baselineDateLabel = baselineIso ? new Date(baselineIso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
    // #1046 Focus Points: the subtitle names the SET, not the session history — "baseline" is an Open-Floor
    // concept. A Focus Points run reads "Focus Points · N points" (attempt-of-a-set numbering is deferred
    // with the same-set retry comparison).
    const objectivePointCount = activeObjectiveBrief?.points?.length ?? 0;
    const sessionSubtitle = isObjectiveSession
        ? `Focus Points · ${objectivePointCount} point${objectivePointCount === 1 ? '' : 's'}`
        : baselineDateLabel
            ? `Session ${completedSessions + 1} · baseline set ${baselineDateLabel}`
            : 'Session 1 · your baseline starts here';

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
    const visibleModelLoadingProgress =
        canUsePrivateStt && mode === 'private' ? modelLoadingProgress : null;
    // 2. Compose Final Status (Attach active Private model progress only)
    const displayStatus: SttStatus = {
        ...baseStatus,
        detail: baseStatus.detail,
        progress: visibleModelLoadingProgress ?? undefined
    };
    return (
        <main 
            aria-label="Practice Session" 
            data-testid="session-page" 
            className="min-h-screen bg-background pt-20"
        >
            {/* Page Header (#1222 G1).
                The title block renders ONLY in the before-state. It is a ROW: heading + dynamic subtitle on
                the left, the "How Rough Drafts works" help entry aligned top-right. The subtitle is derived
                from real history (session number + baseline date), so the page states its progress up front.
                During/after this block is gone and the live workflow owns the frame. */}
            {beforeState && (
                <div className="px-6 pt-4 max-w-7xl mx-auto">
                    <div className="mb-[34px] flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4" data-testid="session-title-block">
                        <div>
                            <h1 className="mb-1 text-3xl font-extrabold tracking-tight text-foreground">Practice Session</h1>
                            <p className="text-sm text-foreground/70" data-testid="session-subtitle">{sessionSubtitle}</p>
                        </div>
                        <FreeformHelpOverlay available={helpOverlayAvailable} className="shrink-0" variant={isObjectiveSession ? 'objective' : 'freeform'} />
                    </div>
                </div>
            )}

            {/* Status Bar - Spans full width of the main content area.
                Post-save, this ONE bar carries the reconciliation copy and Analytics action. There is no separate post-save
                surface — so a deployed state never contains two Analytics actions. */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-0">
                {/* #1042 PR2's help affordance moved UP into the title block (#1047) — see the header above. */}
                {/* #1046 E (slice 0): the quiet "Mic ready" green bar said the same thing three times — it
                    duplicated the recorder pill AND the "Ready on this device" card label. Suppress it ONLY
                    in the TRULY at-rest state: ready/idle, NOT recording, no post-save actions. The bar
                    STILL renders for every state it uniquely owns — attention (warming/recording/
                    downloading/error/warning) and the single post-save surface (Analytics + Private CTA).
                    The `!isListening` guard is load-bearing: `displayStatus` can read 'ready'/'idle' during
                    an active recording, and the bar carries `session-status-indicator` (with `data-engine`)
                    that the recording-signal contract relies on — so it must never be unmounted mid-record.
                    (Unmounting/remounting it across start also created a slow-CI race where the freshly
                    mounted indicator briefly reported engine 'none'.) */}
                {!((displayStatus.type === 'ready' || displayStatus.type === 'idle') && !postSaveReady && !isListening) && (
                    <StatusNotificationBar
                        // #1047: the page owns the gap below the status bar, not the shared component.
                        className="mb-[26px]"
                        status={displayStatus}
                        analyticsAction={postSaveReady ? { cueKey: finalizedAnalysis?.sessionId } : undefined}
                    />
                )}
                {/* #1033 Part-2b (A3/A4): unresolved-recording recovery. Driven by the controller's
                    pendingResolutionKind — NOT by local UI guesses — so what we offer always matches what
                    the runtime will actually do. Discard is two-step confirmed and reports honestly when
                    persistence could not be reconciled (outcome 'retryable'), instead of claiming success. */}
                <UnresolvedRecoveryBanner
                    pendingResolutionKind={pendingResolutionKind}
                    hasRecoverableWords={Boolean(
                        // #1306 content-free: gauge recoverable work by the draft's word COUNT (never a transcript)
                        // or the live in-memory transcript still on the page.
                        (recoveryDraft?.metrics?.totalWords ?? 0) > 0 || (transcriptContent ?? '').trim()
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
                            A locally saved transcript draft is available.
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
                {/* #1222: the session page is the fixed 4-slot overhaul shell driven by the live runtime
                    (before/during/after). The surrounding chrome — header, status bar, recovery banner,
                    access modals, mobile action bar — wraps it. This is the only session page. */}
                <SessionOverhaulView
                    authUserId={authUserId}
                    isListening={isListening}
                    sttStatus={sttStatus}
                    elapsedTime={elapsedTime}
                    scoringElapsedSeconds={scoringDurationSeconds}
                    micLevel={micLevel}
                    transcriptContent={transcriptContent}
                    finalizedWordCount={finalizedWordCount}
                    showAnalyticsPrompt={showAnalyticsPrompt}
                    metricsFillerCount={metrics.fillerCount}
                    onStartStop={() => { void handleStartStop(); }}
                    history={practiceHistory ?? []}
                    privateModelStatus={privateModelStatus}
                    modelLoadingProgress={visibleModelLoadingProgress}
                    onDownloadModel={() => {
                        void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private'));
                    }}
                    isButtonDisabled={isButtonDisabled}
                    fillerData={metrics.fillerData}
                    wpm={metrics.wpm}
                    aiSuggestions={undefined} /* #1306: coaching prose retired; next action replaces it */
                    onSeeAllSessions={() => navigate('/analytics')}
                    interimTranscript={interimTranscript}
                    isFinalizing={isTranscriptFinalizing}
                    finalizeEstimateSeconds={finalizeEstimateSeconds}
                    objectivePoints={activeObjectiveBrief?.points ?? null}
                    objectiveTopic={activeObjectiveBrief?.topic ?? null}
                    objectivePaceGuideSecPerPoint={activeObjectiveBrief?.paceGuideSecPerPoint ?? null}
                    completedObjectivePoints={completedObjectiveBrief?.points ?? null}
                    completedObjectiveTopic={completedObjectiveBrief?.topic ?? null}
                    completedObjectivePaceGuideSecPerPoint={completedObjectiveBrief?.paceGuideSecPerPoint ?? null}
                    objectiveCoverage={objectiveCoverageResult}
                    practiceFocus={practiceFocus}
                    onSelectFocus={(focus) => useSessionStore.getState().setPracticeFocus(focus)}
                    // #1256 P1 — "Retry these points" must REBIND the finished brief before starting, or the
                    // retry becomes an Open Mic take (the live brief was cleared on save) and can never
                    // finalize the saved point set. Rebinding restores it as the active Focus Points brief.
                    onRetryPoints={() => {
                        if (completedObjectiveBrief) {
                            useSessionStore.getState().setActiveObjectiveBrief(completedObjectiveBrief);
                        }
                        void handleStartStop();
                    }}
                />
            </div>

            {/* Mobile Sticky Action Bar */}
            <MobileActionBar
                isListening={isListening}
                isButtonDisabled={isButtonDisabled}
                modelLoadingProgress={visibleModelLoadingProgress}
                onStartStop={() => { void handleStartStop(); }}
                mode={mode}
                privateModelStatus={privateModelStatus}
                onDownloadModel={() => { void import('@/services/SpeechRuntimeController').then(m => m.speechRuntimeController.initiateModelDownload('private')); }}
            />

        </main>
    );
};

export default SessionPage;
