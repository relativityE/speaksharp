import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, Lock, Mic, Square, ChevronDown, Loader2 } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

import { RuntimeState } from '@/services/SpeechRuntimeController';
import { HelpPopover } from './HelpPopover';
import { ModeDescriptionFlyout, STT_FLYOUT_ID } from './ModeDescriptionFlyout';
import { PRIV_STT_MODELS, PRIV_STT } from '@/services/transcription/sttConstants';
import { PRIVATE_SAMPLE_EVENTS, emitPrivateSample } from '@/services/transcription/privateSampleTelemetry';
import { resolvePrivateModel } from '@/services/transcription/utils/privateModelFlag';


export type RecordingMode = 'cloud' | 'native' | 'private' | 'mock';

interface LiveRecordingCardProps {
    // State
    mode: RecordingMode;
    isListening: boolean;
    isReady: boolean;
    canUsePrivate: boolean;
    isPaidProUser?: boolean;
    canUseCloudStt?: boolean;
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
// focusing a row drives the SINGLE controlled ModeDescriptionFlyout (one bubble, disjoint from the
// menu). No per-row tooltip elements.
const STT_MODE_ITEM_CLASS =
    'group relative py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground focus:bg-muted focus:text-foreground';

const LiveRecordingCardContent: React.FC<LiveRecordingCardProps> = ({
    mode,
    isListening,
    isReady,
    canUsePrivate,
    isPaidProUser = canUsePrivate,
    canUseCloudStt = canUsePrivate,
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
    pendingResolutionKind = null,
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
    // Truthful locked-state copy: say what is actually blocking and what resolves it — never a generic
    // "recording in progress" when the real reason is an unsaved recording awaiting Retry Save/Discard.
    const lockedReason =
        pendingResolutionKind === 'initial_save' || pendingResolutionKind === 'full_save'
            ? 'Save or discard your unsaved recording to change the transcription method'
            : pendingResolutionKind === 'attribution'
                ? 'Finish saving your last recording to change the transcription method'
                : isListening
                    ? 'Stop recording to change the transcription method'
                    : 'Finish your current recording to change the transcription method';

    // Single controlled description surface for the mode dropdown: one `activeMode` (the hovered/focused
    // row) drives one ModeDescriptionFlyout. Mutually exclusive by construction — moving to another row
    // just changes activeMode; leaving the menu or closing it clears it. NOT three separate bubbles.
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [activeMode, setActiveMode] = React.useState<RecordingMode | null>(null);
    const menuContentRef = React.useRef<HTMLDivElement>(null);
    // The touch "About transcription modes" help and the mode dropdown are MUTUALLY EXCLUSIVE: at most
    // one description/help surface exists at a time. Both are controlled here so opening one closes the
    // other (and the flyout is already gated on menuOpen, so it hides whenever About opens).
    const [aboutOpen, setAboutOpen] = React.useState(false);

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
    } else {
        // Idle at rest. A not-ready Private state (init-failed/error/loading) supplies a real status
        // message which wins here; otherwise the engine is idle+startable → "Ready to record".
        pillText = displayStatusMessage || 'Ready to record';
    }
    const getModeLabel = (m: RecordingMode) => {
        switch (m) {
            case 'native': return 'Browser';
            case 'private': return 'Private';
            case 'cloud': return 'Cloud';
        }
    };
    // #891 beta: individual Private recordings are capped (decode latency control). Surface it up front.
    const privateCapSeconds = PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS;
    const privateCapLabel = privateCapSeconds % 60 === 0 ? `${privateCapSeconds / 60} minutes` : `${privateCapSeconds}s`;
    const privateModeDescription = isPaidProUser
        ? `Private transcription runs on your device after setup — audio processing stays local. During beta, each recording is capped at ${privateCapLabel} and saves automatically.`
        : canUsePrivate
            ? `Try one Private sample session — up to ${privateCapLabel} per recording during beta. Private is the recommended main experience: transcription runs on your device and stays local.`
            : 'Private transcription is part of Early Access. Upgrade to keep using local Private transcription, full session history, and deeper reports.';
    const cloudModeDescription = canUseCloudStt
        ? 'Highest accuracy for Pro. Audio is sent for cloud transcription.'
        : 'Cloud transcription is a paid Early Access feature.';
    // Canonical per-mode descriptions shown as the dropdown option tooltip (revealed on hover /
    // keyboard focus). Unlocked options use the approved copy — the same wording as the
    // selected-mode help below; locked options keep their entitlement explanation.
    const cloudOptionDesc = canUseCloudStt
        ? 'Audio is sent to an external transcription server. Cloud is available for Pro users.'
        : cloudModeDescription;
    const nativeOptionDesc = "Uses your browser's speech recognition. Availability and accuracy vary by browser. Chrome recommended.";
    const privateOptionDesc = canUsePrivate
        ? 'Private runs on your device after a one-time setup. Audio stays local.'
        : privateModeDescription;

    // Short, scannable STT cue shown by default; the explanatory detail lives behind the accessible
    // help affordance (hover/focus/click/tap), never as a large paragraph.
    const modelSizeMB = PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].approxMB;
    let sttCue: string;
    if (mode === 'cloud') {
        sttCue = 'External server';
    } else if (mode === 'private') {
        sttCue = isPrivateDownloadRequired ? 'Private on-device' : 'Ready on this device';
    } else {
        sttCue = 'Browser';
    }

    // "About transcription modes" — a single, touch-friendly help surface that lists ALL THREE mode
    // descriptions together, so someone can read about (e.g.) Cloud WITHOUT selecting it first. Same
    // per-mode copy the desktop row tooltips use. This is informational only; the dropdown remains the
    // sole mode-selection control. Rendered through the existing HelpPopover affordance (no new icon):
    // opens on hover / keyboard-focus / click / tap, closes on Escape / outside click.
    const aboutModesHelp = (
        <div className="space-y-2.5" data-testid="stt-modes-about">
            <p className="text-[10px] font-bold uppercase tracking-wide text-foreground/50">About transcription modes</p>
            <div>
                <p className="font-semibold text-foreground">Private — Recommended</p>
                <p className="font-normal normal-case text-foreground/75" data-testid="stt-about-private">{privateOptionDesc}</p>
                {isPrivateDownloadRequired && (
                    <p className="mt-0.5 text-[11px] font-normal text-foreground/55" data-testid="private-model-size-note">
                        {`One-time download of the on-device speech model (about ${modelSizeMB} MB). Your audio is transcribed in your browser and never uploaded. If site storage is cleared, setup may be required again.`}
                    </p>
                )}
            </div>
            <div>
                <p className="font-semibold text-foreground">Browser</p>
                <p className="font-normal normal-case text-foreground/75" data-testid="stt-about-native">{nativeOptionDesc}</p>
            </div>
            <div>
                <p className="font-semibold text-foreground">Cloud — Pro</p>
                <p className="font-normal normal-case text-foreground/75" data-testid="stt-about-cloud">{cloudOptionDesc}</p>
            </div>
        </div>
    );

    // Content for the single flyout, resolved from the active row (same per-mode copy as the About panel).
    const activeFlyout = ((): { title: string; body: string } => {
        switch (activeMode) {
            case 'private': return { title: 'Private — Recommended', body: privateOptionDesc };
            case 'native': return { title: 'Browser', body: nativeOptionDesc };
            case 'cloud': return { title: 'Cloud — Pro', body: cloudOptionDesc };
            default: return { title: '', body: '' };
        }
    })();

    return (
        <LocalErrorBoundary componentName="LiveRecordingCard">
            <div className={`${SESSION_SURFACE_CLASS} relative z-10 flex flex-col gap-2.5 p-4 surface-shadow-primary ${className}`} data-testid="live-recording-card">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex w-[min(100%,260px)] items-start gap-2">
                        {isPrivateDownloadRequired && (
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                                <Lock className="h-3.5 w-3.5" />
                            </div>
                        )}
                        <div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-sm font-bold leading-snug text-primary" data-testid="stt-mode-cue">
                                    {sttCue}
                                </span>
                                <HelpPopover
                                    label="About transcription modes"
                                    testId="stt-mode-help"
                                    panelClassName="w-72"
                                    triggerSizeClass="h-11 w-11"
                                    open={aboutOpen}
                                    onOpenChange={(o) => { setAboutOpen(o); if (o) { setMenuOpen(false); setActiveMode(null); } }}
                                >
                                    {aboutModesHelp}
                                </HelpPopover>
                            </div>

                            {/* P0.2: the single Browser→Private transition happens AFTER a Browser save
                                (post-save status-bar CTA in StatusNotificationBar). The selector already
                                advertises Private as Recommended before recording, so there is intentionally
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
                    <DropdownMenu open={menuOpen} onOpenChange={(o) => { setMenuOpen(o); if (o) setAboutOpen(false); if (!o) setActiveMode(null); }}>
                        <DropdownMenuTrigger asChild disabled={selectionLocked}>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-10 w-full justify-center gap-1.5 rounded-md border border-border px-3.5 text-[11px] font-semibold text-foreground transition-all hover:bg-muted hover:text-foreground sm:w-auto"
                                title={selectionLocked ? lockedReason : "Select mode"}
                                aria-disabled={selectionLocked}
                                data-locked={selectionLocked ? 'true' : 'false'}
                                data-testid={TEST_IDS.STT_MODE_SELECT}
                                data-state={mode}
                            >
                                <span className="text-primary">•</span>
                                {getModeLabel(mode)}
                                {!selectionLocked && <ChevronDown className="h-2.5 w-2.5 opacity-50" />}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            ref={menuContentRef}
                            align="end"
                            // opaque: the STT menu must stay fully opaque at EVERY frame of the open
                            // transition — never let the mic/timer/status pill show through the fade.
                            opaque
                            className="w-56 max-w-[calc(100vw-2rem)]"
                            onPointerLeave={() => setActiveMode(null)}
                        >
                            {/* Private-first hierarchy (P0.2): Private (Recommended) → Browser → Cloud (Pro).
                                ONLY Private carries the Recommended tag. Rows are compact one-
                                liners; hover / keyboard-focus sets a SINGLE activeMode that drives one
                                ModeDescriptionFlyout (rendered below, disjoint from this menu) — mutually
                                exclusive by construction, never per-row tooltip elements. */}
                            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => handleModeChange(v as RecordingMode)}>
                                <DropdownMenuRadioItem
                                    value="private"
                                    className={STT_MODE_ITEM_CLASS}
                                    data-testid={TEST_IDS.STT_MODE_PRIVATE}
                                    disabled={!canUsePrivate}
                                    onPointerEnter={() => setActiveMode('private')}
                                    onFocus={() => setActiveMode('private')}
                                    aria-describedby={activeMode === 'private' ? STT_FLYOUT_ID : undefined}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {!canUsePrivate && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                                        Private
                                        <span data-testid="stt-mode-tag-recommended" className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">Recommended</span>
                                    </span>
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="native"
                                    className={STT_MODE_ITEM_CLASS}
                                    data-testid={TEST_IDS.STT_MODE_NATIVE}
                                    onPointerEnter={() => setActiveMode('native')}
                                    onFocus={() => setActiveMode('native')}
                                    aria-describedby={activeMode === 'native' ? STT_FLYOUT_ID : undefined}
                                >
                                    <span className="flex items-center gap-1.5">
                                        Browser
                                    </span>
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="cloud"
                                    className={STT_MODE_ITEM_CLASS}
                                    data-testid={TEST_IDS.STT_MODE_CLOUD}
                                    disabled={!canUseCloudStt}
                                    onPointerEnter={() => setActiveMode('cloud')}
                                    onFocus={() => setActiveMode('cloud')}
                                    aria-describedby={activeMode === 'cloud' ? STT_FLYOUT_ID : undefined}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {!canUseCloudStt && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                                        Cloud
                                        <span data-testid="stt-mode-tag-pro" className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Pro</span>
                                    </span>
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {/* The ONE description surface. Disjoint from the menu, beside it, at most one at a time;
                        suppressed (falls back to the About panel) when no non-overlapping side fits. */}
                    <ModeDescriptionFlyout
                        open={menuOpen && activeMode !== null}
                        anchorRef={menuContentRef}
                        mode={activeMode}
                        title={activeFlyout.title}
                        body={activeFlyout.body}
                        avoidSelector='[data-testid="live-coaching-score-card"]'
                    />
                </div>

                <div className="flex flex-col items-center justify-center gap-2 text-center">
                    <div className="flex flex-col items-center gap-2">
                        <div className="relative">
                            {isListening && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="absolute w-12 h-12 rounded-full bg-primary/20 animate-ping opacity-75" />
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
                                    className="w-12 h-12 rounded-full bg-primary text-primary-foreground ring-1 ring-primary/35 hover:bg-primary/90 cta-shadow hover:scale-105 transition-all duration-300 p-0 disabled:cursor-not-allowed disabled:pointer-events-none disabled:bg-primary disabled:text-primary-foreground disabled:opacity-100 disabled:shadow-none disabled:ring-1 disabled:ring-primary/35"
                                >
                                    <span className="relative flex h-6 w-6 items-center justify-center text-primary-foreground">
                                        <Mic className="h-5 w-5" />
                                        <span className="absolute h-0.5 w-7 -rotate-45 rounded-full bg-primary-foreground" aria-hidden="true" />
                                    </span>
                                </Button>
                            ) : (
                                <Button
                                    onClick={onStartStop}
                                    disabled={isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    data-recording={isRecordingSignal}
                                    aria-label="Stop Recording"
                                    className="w-12 h-12 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground active:scale-95 transition-all duration-300 animate-pulse p-0"
                                >
                                    <Square className="w-5 h-5 fill-current" />
                                </Button>
                            )}
                        </div>

                        {/* Timer (Matching Mic weight) */}
                        <div className="flex flex-col items-center">
                            <div className="text-3xl font-mono font-bold text-foreground tracking-tighter tabular-nums leading-none">
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
