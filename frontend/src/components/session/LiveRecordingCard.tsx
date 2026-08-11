import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, Lock, Mic, Square, Loader2 } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';

import { RuntimeState } from '@/services/SpeechRuntimeController';
import { PRIVATE_SAMPLE_EVENTS, emitPrivateSample } from '@/services/transcription/privateSampleTelemetry';
import { formatTrialAllotmentTitle, formatTrialRemainingTitle } from '@/utils/privateSampleDuration';


export type RecordingMode = 'cloud' | 'native' | 'private' | 'mock';

interface LiveRecordingCardProps {
    // State
    mode: RecordingMode;
    isListening: boolean;
    isReady: boolean;
    canUsePrivate: boolean;
    isPaidProUser?: boolean;
    canUseCloudStt?: boolean;
    /** #1047 conversion repair: the authenticated Free user has an AVAILABLE Private sample (server
     *  `check-usage-limit`: not Pro, `private_sample_available`, remaining seconds > 0). Combined with
     *  the card's own idle/Browser/unlocked state it gates the compact Free→Private trial nudge. */
    privateTrialAvailable?: boolean;
    /** True only when the sample is FULL and UNSTARTED — the sole case where the "N-minute trial
     *  available" claim is truthful. A partially-consumed sample uses "Continue with Private" copy. */
    privateTrialFresh?: boolean;
    /** Server-reported remaining sample seconds — used for the truthful "X minutes remaining" copy. */
    privateTrialRemainingSeconds?: number;
    /** Server-reported total sample allotment (`private_sample_limit_seconds`) — the "N-minute" figure
     *  is derived from THIS, never a hard-coded 5, so the duration claim matches the server. */
    privateTrialLimitSeconds?: number;
    statusMessage?: string; // Optional message from the STT service
    formattedTime: string;
    elapsedSeconds: number; // Added for minimum session duration check
    isButtonDisabled: boolean;
    isPaused?: boolean;
    activeEngine: RecordingMode | 'none' | null;
    fsmState?: RuntimeState; // master FSM state from controller
    sttStatusType?: string; // status type from service status (transient — DO NOT gate readiness on this)
    /**
     * DURABLE Private model availability, projected from `data-model-status` by the lifecycle hook.
     * Values: 'idle' | 'loading' | 'ready' | 'download-required' | 'init-failed' | 'error'. This is
     * the source of truth for "can Private start / is the model downloaded", because unlike the
     * transient sttStatus pulse it survives idle/post-session (so returning users can record again).
     */
    privateModelStatus?: string;
    recordingIntent?: boolean; // explicit user intent to record
    isFinalizing?: boolean; // post-Stop whole-utterance decode in progress (#891)
    className?: string;
    // Callbacks
    /** #1033 Part-2b: the AUTHORITATIVE engine-selection lock published by the controller. This is
     *  strictly broader than `isListening`: it also covers Start intent (before RECORDING), a pending
     *  save/attribution resolution, and a started-but-unresolved recording. The selector must use THIS,
     *  never `isListening`, or the UI would offer an engine change the runtime will reject. */
    engineSelectionLocked?: boolean;
    /** #1033 Part-2b: drives truthful locked-state copy — what the user must do to unlock. */
    pendingResolutionKind?: 'initial_save' | 'full_save' | 'attribution' | null;
    onModeChange: (mode: RecordingMode) => void;
    onStartStop: () => void;
    onDownloadModel?: () => void;
}

import { LocalErrorBoundary } from '@/components/LocalErrorBoundary';
import { SESSION_SURFACE_CLASS } from '@/components/session/sessionSurface';

/**
 * The main recording control panel with mode selector, mic indicator,
 * timer, and start/stop button.
 * Extracted from SessionPage for better reusability and testability.
 */
// Decorative "recording active" indicator bar heights (px). Deterministic on purpose:
// the previous implementation used Math.random() evaluated during render, which (a) only changed
// on a React re-render — so it froze between renders and jumped abruptly rather than animating, and
// (b) implied a live volume meter it never was. These fixed heights + a CSS `animate-pulse` give a
// smooth, compositor-driven activity cue with zero render coupling. A real RMS-driven meter
// (rAF + ref, no per-frame React state) is tracked as a separate enhancement.
const RECORDING_BAR_HEIGHTS = [6, 11, 16, 9, 13, 7, 14, 10, 12, 8] as const;

// Compact ONE-LINE mode row. The per-mode description is NOT inlined here — hovering or keyboard-
const LiveRecordingCardContent: React.FC<LiveRecordingCardProps> = ({
    mode,
    isListening,
    isReady,
    canUsePrivate,
    isPaidProUser = canUsePrivate,
    privateTrialAvailable = false,
    privateTrialFresh = false,
    privateTrialRemainingSeconds = 0,
    privateTrialLimitSeconds = 0,
    statusMessage: _statusMessage,
    formattedTime,
    elapsedSeconds,
    isButtonDisabled,
    isPaused = false,
    activeEngine,
    fsmState,
    sttStatusType,
    privateModelStatus = 'idle',
    recordingIntent = false,
    isFinalizing = false,
    className = "",
    engineSelectionLocked = false,
    onModeChange,
    onStartStop,
    onDownloadModel,
}) => {
    // Emit private_sample_selected once when the user shows intent to use Private mode
    // (selection, not passive render), then delegate to the real handler.
    const privateSelectedRef = React.useRef(false);
    const handleModeChange = (next: RecordingMode) => {
        if (next === 'private' && !privateSelectedRef.current) {
            privateSelectedRef.current = true;
            emitPrivateSample(PRIVATE_SAMPLE_EVENTS.SELECTED);
        }
        onModeChange(next);
    };

    // #1033 Part-2b: ONE source of truth for "may the user change engine right now?". `isListening` is
    // kept only as a fallback for callers that have not yet been migrated to the published lock.
    const selectionLocked = engineSelectionLocked || isListening;

    // #1047 conversion repair: a compact idle nudge that restores the Free→Private path #1094 removed
    // from the ambient status bar — WITHOUT re-adding permanent chrome. Offered when the eligible Free
    // account (server-confirmed AVAILABLE sample — full OR partially used) is idle on Browser with
    // engine selection unlocked. Gate on `canUsePrivate` too: never offer the trial when Private is
    // unavailable in this runtime/browser (the switch would fail). Eligibility (Free + available) is
    // server-authoritative via `privateTrialAvailable`; the card adds the runtime/UI conditions.
    const eligibleForTrialNudge =
        privateTrialAvailable && canUsePrivate && !isPaidProUser
        && mode === 'native' && !isListening && !selectionLocked;
    // Truthful nudge copy from the SERVER-reported allotment/remaining, via the shared conservative
    // formatter (never a hard-coded 5, never a rounded-up overstatement): a FULL, unstarted sample
    // offers the trial by its real whole-minute length; a partially-used sample invites the user to
    // continue with the minutes that actually remain (floored). The partial formatter FAILS CLOSED
    // (null) for a non-positive/non-finite remaining, so the nudge then shows nothing rather than a
    // false "less than a minute" — the final visibility folds that in.
    const privateTrialNudgeTitle = privateTrialFresh
        ? formatTrialAllotmentTitle(privateTrialLimitSeconds)
        : formatTrialRemainingTitle(privateTrialRemainingSeconds);
    const showPrivateTrialNudge = eligibleForTrialNudge && privateTrialNudgeTitle !== null;
    // NUDGE_VIEWED fires at most ONCE per mount — NOT per appearance — so toggling modes (hide/show)
    // cannot inflate the top-of-funnel count. A genuine new view (fresh navigation) is a new mount.
    const nudgeViewedRef = React.useRef(false);
    React.useEffect(() => {
        if (showPrivateTrialNudge && !nudgeViewedRef.current) {
            nudgeViewedRef.current = true;
            emitPrivateSample(PRIVATE_SAMPLE_EVENTS.NUDGE_VIEWED);
        }
    }, [showPrivateTrialNudge]);
    // "Try Private" selects Private only — it does NOT start recording and does NOT download the model;
    // the existing mic action stays responsible for first-time setup. NUDGE_SELECTED attributes the
    // mode switch to the nudge; handleModeChange still emits SELECTED for the switch itself.
    const handleTryPrivate = () => {
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.NUDGE_SELECTED);
        handleModeChange('private');
    };
    // #1184: the STT selector is removed (Private is the only engine), so the locked-reason copy, the
    // mode-dropdown state, and the flyout/About state that drove it are gone. Engine selection can no
    // longer change, so there is nothing to lock or describe as switchable.

    // Deriving visibility and recording state from the master FSM + Intent
    // isIndicatorVisible: Shows the waveform when the engine is active OR initializing
    const ACTIVE_INDICATOR_STATES: RuntimeState[] = ['RECORDING', 'ENGINE_INITIALIZING', 'INITIATING', 'STOPPING'];
    const ACTIVE_INDICATOR_TYPES = ['recording', 'warming', 'initializing', 'downloading', 'download-required', 'paused'];

    const isIndicatorVisible = fsmState
        ? (ACTIVE_INDICATOR_STATES.includes(fsmState) || ACTIVE_INDICATOR_TYPES.includes(sttStatusType || '') || isPaused)
        : (isListening || isPaused) && isReady;

    const isStopControlVisible = isListening || recordingIntent;
    // data-recording: Pure intent signal for E2E tests and accessibility
    const isRecordingSignal = isStopControlVisible ? 'true' : 'false';

    // Check if session is too short to save
    const isTooShort = isListening && elapsedSeconds > 0 && elapsedSeconds < MIN_SESSION_DURATION_SECONDS;
    // First-run Private: clicking the mic triggers the one-time model download (no separate "Set up"
    // button). All three flags read the DURABLE `privateModelStatus` (data-model-status), NOT the
    // transient sttStatus pulse — so they survive idle/post-session and never lock out a returning user.
    const isPrivateDownloadRequired = mode === 'private' && privateModelStatus === 'download-required' && !isListening;
    // #891 immediate-start gate: the mic is warming up; the UI must NOT invite speech yet.
    const isWarming = sttStatusType === 'warming';
    // Blue "downloading" pill ONLY during the actual model byte-download (sttStatusType 'downloading'
    // carries the %). Mode-gated so Native/Cloud mic-init ('initializing') is never mislabelled.
    const isDownloadingModel = mode === 'private' && sttStatusType === 'downloading';
    // DURABLE positive readiness: green "Ready to record" only when the model is warm+ready. Mic
    // START-ability is NOT gated on this (it uses the durable isButtonDisabled, which already blocks
    // download-required/loading/init-failed/error and stays enabled at idle/ready) — so a returning
    // user at post-session `idle` can record again without a reload.
    const isPrivateModelReady =
        mode === 'private'
        && privateModelStatus === 'ready'
        && !isListening
        && !isFinalizing;
    // Surface a PROMINENT "Getting mic ready… -> Ready, speak now" cue. Hold the green "ready"
    // state briefly after the mic becomes ready so the user clearly sees the transition and starts.
    const [justBecameReady, setJustBecameReady] = React.useState(false);
    const wasWarmingRef = React.useRef(false);
    React.useEffect(() => {
        const wasWarming = wasWarmingRef.current;
        wasWarmingRef.current = isWarming;
        if (wasWarming && !isWarming && isListening) {
            setJustBecameReady(true);
            const timer = setTimeout(() => setJustBecameReady(false), 2500);
            return () => clearTimeout(timer);
        }
    }, [isWarming, isListening]);
    // #891 state-colored status pill (white card stays; only the oval pill tints by state).
    // neutral idle -> amber warming -> green ready -> blue finalizing. Recording stays neutral.
    const pillState: 'finalizing' | 'downloading' | 'warming' | 'ready' | 'recording' | 'idle' =
        isFinalizing ? 'finalizing'
            : isDownloadingModel ? 'downloading'
                : isWarming ? 'warming'
                    : (justBecameReady || isPrivateModelReady) ? 'ready'
                        : isListening ? 'recording'
                            : 'idle';
    const pillSurface = {
        finalizing: 'bg-blue-100 text-blue-800 ring-1 ring-blue-300',
        downloading: 'bg-blue-100 text-blue-800 ring-1 ring-blue-300',
        warming: 'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
        // Ready green intentionally a couple shades darker/greener than idle amber-adjacent tones.
        ready: 'bg-green-200 text-green-900 ring-1 ring-green-500',
        recording: 'bg-muted/55 text-foreground/70 ring-1 ring-border',
        idle: 'bg-muted/55 text-foreground/70 ring-1 ring-border',
    }[pillState];
    const pillDot = {
        finalizing: 'bg-blue-500',
        downloading: 'bg-blue-500 animate-pulse',
        warming: 'bg-amber-500 animate-pulse',
        ready: 'bg-green-600',
        recording: 'bg-primary animate-pulse',
        idle: 'bg-muted-foreground',
    }[pillState];
    let displayStatusMessage = _statusMessage;
    if (isPrivateDownloadRequired) {
        displayStatusMessage = 'Private model setup';
    } else if (/^error occurred$/i.test(_statusMessage?.trim() || '')) {
        displayStatusMessage = 'Recording could not start';
    }
    // Pill text, precedence-ordered. download-required never shows "Ready to record"; the actual
    // model download shows progress; failures (init-failed/error/loading) carry their own status
    // message and are never green. With the durable gate, Private `idle` is startable (model
    // available), so "Ready to record" is correct there — no string-coupled scrub needed.
    let pillText: string;
    if (isPrivateDownloadRequired) {
        pillText = 'Tap the mic to set up';
    } else if (isDownloadingModel) {
        pillText = displayStatusMessage || 'Downloading model…';
    } else if (isFinalizing) {
        pillText = 'Finalizing your transcript…';
    } else if (isWarming) {
        pillText = 'Getting mic ready — one moment…';
    } else if (justBecameReady) {
        pillText = 'Ready — speak now';
    } else if (isPrivateModelReady) {
        pillText = 'Ready to record';
    } else if (isPaused) {
        pillText = displayStatusMessage || 'Paused';
    } else if (isListening) {
        pillText = displayStatusMessage || (activeEngine && activeEngine !== 'none' ? 'Recording' : 'Listening');
    } else if (sttStatusType === 'ready' || sttStatusType === 'idle') {
        // #1047: at rest the pill speaks in the RECORDER's own voice. `statusMessage` carries the
        // service's AMBIENT status text ("Mic ready"), which belongs on the status bar; piping it into
        // the pill made the control under the timer describe the microphone instead of telling the
        // user what they can do. This is a display mapping only — the service/store status text and
        // #1090's setSTTStatus logic are untouched.
        pillText = 'Ready to record';
    } else {
        // A not-ready Private state (init-failed/error/loading) supplies a real status message, which
        // must still win here; otherwise fall back to the idle wording.
        pillText = displayStatusMessage || 'Ready to record';
    }
    // #1184: mode labels, per-mode descriptions, and the model-size note are removed with the selector —
    // there is one engine (Private) and the header cue names it. The Private per-recording cap still
    // applies at the engine level; it simply is no longer surfaced through the removed selector copy.
    // #1184 Private-only product truth: the removed selector has no retired-mode fallback copy. The cue
    // names the one customer engine and its device boundary.
    const sttCue = isPrivateDownloadRequired ? 'Private · on-device (setup)' : 'Private · on this device';

    // #1184: the "About transcription modes" help panel and the per-row flyout are removed with the
    // selector — there are no modes to describe/choose. The header cue ("Private · on this device") + the
    // sr-only privacy descriptor carry the engine's identity + privacy claim.

    return (
        <LocalErrorBoundary componentName="LiveRecordingCard">
            <div className={`${SESSION_SURFACE_CLASS} relative z-10 flex flex-col gap-2.5 p-4 surface-shadow-primary ${className}`} data-testid="live-recording-card">
                {/* #1046 slice 0.2: the card HEADER is the status line the removed ambient bar used to
                    carry — permission + device on the left, engine on the right — split from the mic
                    cluster below by a hairline (matches the recorder-card mockup). */}
                <div className="flex flex-col items-stretch gap-3 border-b border-[hsl(var(--border))] pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2 sm:w-[min(100%,260px)]">
                        {isPrivateDownloadRequired && (
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                                <Lock className="h-3.5 w-3.5" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                {/* #1046 slice 0.2: a small status dot carries the permission+device state
                                    (green = mic ready). Cloud is the one case audio leaves the device — amber
                                    there — so the dot never over-promises "on this device". */}
                                <span
                                    aria-hidden="true"
                                    className={`h-2 w-2 shrink-0 rounded-full ${mode === 'cloud' ? 'bg-amber-500' : 'bg-[hsl(var(--session-green-deep))]'}`}
                                />
                                <span className="text-[13px] font-bold leading-snug text-foreground" data-testid="stt-mode-cue">
                                    {sttCue}
                                </span>
                            </div>

                            {/* P0.2: the single Browser→Private transition happens AFTER a Browser save
                                (post-save status-bar CTA in StatusNotificationBar). The selector already
                                advertises Private (Stays local) before recording, so there is intentionally
                                NO pre-save card CTA here — avoids a duplicate transition. */}

                            {/* Private first-run: no separate "Set up" button — clicking the mic starts the
                                one-time model download and the pill below shows progress until it's ready. */}
                            {isPrivateDownloadRequired && (
                                <p className="mt-1 text-[11px] font-medium text-muted-foreground" data-testid="private-first-run-note">
                                    First-time use: click the mic to download the model. Available once the status turns green.
                                </p>
                            )}
                        </div>
                    </div>
                    {/* #1047: the mode row is the PILL ALONE at the right — no `?` beside it. The wrapper
                        must NOT be `shrink-0`: the mode-select trigger inside is `w-full sm:w-auto`, so on
                        mobile it needs a wrapper that can take the remaining row width, or `w-full` would
                        resolve against a content-sized box and collapse the control. */}
                    {/* #1184: Private is the ONLY STT — there is no engine choice, so the selector dropdown,
                        the "About transcription modes" help, and the mode-description flyout are removed
                        (Browser + Cloud are gone from the product). A compact, non-interactive indicator
                        restates the engine truthfully beside the controls; the header cue above carries the
                        full "Private · on this device" wording, and the privacy sentence stays available to
                        screen readers via the persistent descriptor. */}
                    <div className="flex min-w-0 flex-1 flex-col items-end gap-1 sm:flex-none">
                        <div
                            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border px-3.5 text-[11px] font-semibold text-foreground"
                            data-testid={TEST_IDS.STT_MODE_SELECT}
                            data-state="private"
                            aria-describedby="stt-private-descriptor"
                        >
                            <Lock className="h-3 w-3 text-green-600 dark:text-green-500" aria-hidden="true" data-testid="stt-private-lock" />
                            Private
                        </div>
                        <span id="stt-private-descriptor" className="sr-only">Stays local. Transcription runs on this device; audio is not uploaded.</span>
                    </div>
                </div>

                {/* #1047 conversion repair: the compact Free→Private trial nudge. This is the pre-save
                    card CTA that #1094 removed — restored here (near the mode selector, NOT in the
                    ambient status bar) per Product Owner direction, and gated so it only appears for an
                    eligible, idle Free user on Browser. "Try Private" selects Private only; the mic still
                    owns first-time setup. The post-Browser-save CTA remains the second conversion path. */}
                {showPrivateTrialNudge && (
                    <div
                        data-testid="private-trial-nudge"
                        className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2"
                    >
                        <div className="min-w-0">
                            <p className="text-[13px] font-bold leading-snug text-foreground" data-testid="private-trial-nudge-title">{privateTrialNudgeTitle}</p>
                            <p className="text-[11px] font-medium leading-snug text-muted-foreground">Audio stays on this device.</p>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="shrink-0"
                            data-testid="private-trial-nudge-cta"
                            onClick={handleTryPrivate}
                        >
                            Try Private
                        </Button>
                    </div>
                )}

                <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <div className="flex flex-col items-center gap-2">
                        <div className="relative">
                            {isListening && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="absolute w-16 h-16 rounded-full bg-primary/20 animate-ping opacity-75" />
                                </div>
                            )}

                            {!isStopControlVisible ? (
                                <Button
                                    onClick={() => {
                                        // download-required is the ONE model-less state — the mic downloads instead
                                        // of starting. Every other state uses the durable isButtonDisabled gate,
                                        // which already blocks the not-ready model states (loading/init-failed/error)
                                        // and stays enabled at idle/ready — so a not-ready engine can never start.
                                        if (isPrivateDownloadRequired) { onDownloadModel?.(); return; }
                                        onStartStop();
                                    }}
                                    disabled={isPrivateDownloadRequired ? false : isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    data-recording={isRecordingSignal}
                                    aria-label={isPrivateDownloadRequired ? 'Set up Private — download the on-device model' : 'Start Recording'}
                                    title={isPrivateDownloadRequired ? 'Click to download the on-device model (one-time)' : isDownloadingModel ? 'Downloading model…' : 'Start Recording'}
                                    className="w-16 h-16 rounded-full bg-primary text-primary-foreground ring-1 ring-primary/35 hover:bg-primary/90 cta-shadow hover:scale-105 transition-all duration-300 p-0 disabled:cursor-not-allowed disabled:pointer-events-none disabled:bg-primary disabled:text-primary-foreground disabled:opacity-100 disabled:shadow-none disabled:ring-1 disabled:ring-primary/35"
                                >
                                    {/* #1046 slice 0.1: a PLAIN mic — no slash. A slashed mic is the "muted /
                                        unavailable" convention, the opposite of a ready Start control. Permission-
                                        denied is surfaced by the status pill / error state, not by defacing the
                                        button. The button is also enlarged (w-16) so the mic is the page's hero. */}
                                    <Mic className="h-7 w-7 text-primary-foreground" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={onStartStop}
                                    disabled={isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    data-recording={isRecordingSignal}
                                    aria-label="Stop Recording"
                                    className="w-16 h-16 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground active:scale-95 transition-all duration-300 animate-pulse p-0"
                                >
                                    <Square className="w-6 h-6 fill-current" />
                                </Button>
                            )}
                        </div>

                        {/* Timer.
                            #1047 is PRESENTATION ONLY here. The value comes straight from `formattedTime`,
                            which #1090 already made correct: `useSessionStore.setSTTStatus` zeroes the live
                            timer on every route into Ready/Idle (so Ready can honestly read 00:00), and the
                            completed take's real length lives separately in
                            `completedSessionDurationSeconds`. Do NOT reimplement or second-guess that here —
                            a duplicate timer rule is exactly the defect #1090 fixed.
                            Idle reads grey and running reads dark ink, so the number only claims attention
                            while it is actually counting. tabular-nums keeps digits from jittering. */}
                        <div className="flex flex-col items-center">
                            <div
                                className={`text-[40px] font-mono font-extrabold leading-none tracking-tighter [font-variant-numeric:tabular-nums] transition-colors duration-300 ${
                                    isListening || isPaused ? 'text-foreground' : 'text-muted-foreground'
                                }`}
                                data-testid="session-timer"
                                data-timer-active={isListening || isPaused ? 'true' : 'false'}
                            >
                                {formattedTime}
                            </div>
                            {/* #891 state-colored status pill: the white card stays; ONLY this oval tints
                                by state — neutral idle, amber warming, green "speak now", blue finalizing. */}
                            <div
                                className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors duration-300 ${pillSurface}`}
                                aria-live="polite"
                            >
                                {isFinalizing
                                    ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    : <div className={`h-1.5 w-1.5 rounded-full ${pillDot}`} />}
                                <span className="text-[11px] font-bold tracking-[0.06em]" data-testid="stt-status-label" data-pill-state={pillState}>
                                    {pillText}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="h-4 w-full max-w-[140px] self-center flex items-center justify-center gap-0.5 overflow-hidden opacity-60">
                    {isIndicatorVisible && (
                        <div
                            className={`flex items-center gap-0.5 ${isPaused ? '' : 'animate-pulse'}`}
                            data-testid="recording-indicator"
                            data-recording={isRecordingSignal}
                            data-paused={isPaused}
                        >
                            {RECORDING_BAR_HEIGHTS.map((barHeight, i) => (
                                <div
                                    key={i}
                                    className={`w-0.5 rounded-full ${isPaused ? 'bg-amber-500/40' : 'bg-primary/40'}`}
                                    style={{ height: isPaused ? '4px' : `${barHeight}px` }}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Min Duration Warning */}
                {isTooShort && (
                    <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-1.5 text-amber-500 text-[8px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-bottom-2">
                        <AlertCircle className="h-2.5 w-2.5" />
                        <span>Min {MIN_SESSION_DURATION_SECONDS}s required</span>
                    </div>
                )}
            </div>
        </LocalErrorBoundary>
    );
};

export const LiveRecordingCard = (props: LiveRecordingCardProps) => (
    <LocalErrorBoundary componentName="LiveRecordingCard">
        <LiveRecordingCardContent {...props} />
    </LocalErrorBoundary>
);

export default LiveRecordingCard;
