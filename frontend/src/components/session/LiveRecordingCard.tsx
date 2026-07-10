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
    sttStatusType?: string; // status type from service status
    recordingIntent?: boolean; // explicit user intent to record
    isFinalizing?: boolean; // post-Stop whole-utterance decode in progress (#891)
    className?: string;
    // Callbacks
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

// A small, soft tooltip bubble that floats to the RIGHT of a dropdown row (open space —
// away from the mic/timer) on hover / keyboard focus (Radix sets data-highlighted on the
// active item). Rounded, neutral `muted` surface so it reads as part of the dropdown system,
// with a small caret pointing back at the row. Absolutely positioned so the row stays
// one-line; the parent menu is overflow-visible so it isn't clipped.
const STT_TOOLTIP_CLASS =
    'pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden w-60 max-w-[260px] -translate-y-1/2 rounded-2xl border border-border/70 bg-muted px-3 py-2 text-[11px] font-normal normal-case leading-relaxed text-foreground shadow-sm group-data-[highlighted]:block '
    + "before:absolute before:right-full before:top-1/2 before:-translate-y-1/2 before:border-[6px] before:border-transparent before:border-r-muted before:content-['']";

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
    recordingIntent = false,
    isFinalizing = false,
    className = "",
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
    const isPrivateDownloadRequired = mode === 'private' && sttStatusType === 'download-required' && !isListening;
    // #891 immediate-start gate: the mic is warming up; the UI must NOT invite speech yet.
    const isWarming = sttStatusType === 'warming';
    // First-run Private: clicking the mic triggers the one-time model download (no separate "Set up"
    // button). While it downloads, the mic can't start a session; the pill shows progress and turns
    // green when the on-device model is ready.
    const isDownloadingModel = sttStatusType === 'downloading' || sttStatusType === 'initializing';
    // POSITIVE readiness gate: the green "Ready to record" pill AND the ability to start a Private
    // session require the engine to REPORT a real ready state (`ready` status + FSM READY/IDLE) — never
    // inferred from the mere absence of transient states. This deliberately excludes every non-ready
    // Private status: error / init-failed / fallback / warning / info / downloading / initializing /
    // download-required / warming / unknown — none of which equal 'ready'.
    const isPrivateModelReady =
        mode === 'private'
        && sttStatusType === 'ready'
        && (fsmState === 'READY' || fsmState === 'IDLE')
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
    const getModeLabel = (m: RecordingMode) => {
        switch (m) {
            case 'native': return 'Browser';
            case 'private': return 'Private';
            case 'cloud': return 'Cloud';
        }
    };
    const hasPrivateSampleAccess = canUsePrivate && !isPaidProUser;
    // #891 beta: individual Private recordings are capped (decode latency control). Surface it up front.
    const privateCapSeconds = PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS;
    const privateCapLabel = privateCapSeconds % 60 === 0 ? `${privateCapSeconds / 60} minutes` : `${privateCapSeconds}s`;
    const privateModeDescription = isPaidProUser
        ? `Private transcription runs on your device after setup — audio processing stays local. During beta, each recording is capped at ${privateCapLabel} and saves automatically.`
        : canUsePrivate
            ? `Try one Private sample session — up to ${privateCapLabel} per recording during beta. Local transcription so you can compare it with Browser transcription.`
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
    const nativeOptionDesc = "Uses your browser's speech service. Audio may be processed by the browser provider.";
    const privateOptionDesc = canUsePrivate
        ? 'Private runs on your device after a one-time setup. Audio stays local.'
        : privateModeDescription;

    // Short, scannable STT cue shown by default; the explanatory detail lives behind
    // the accessible help affordance (hover/focus/click/tap), never as a large paragraph.
    const modelSizeMB = PRIV_STT_MODELS.CANDIDATES[resolvePrivateModel()].approxMB;
    let sttCue: string;
    let sttHelp: React.ReactNode;
    if (mode === 'cloud') {
        sttCue = 'External server';
        sttHelp = <p>Audio is sent to an external transcription server. Cloud is available for Pro users.</p>;
    } else if (mode === 'private') {
        if (isPrivateDownloadRequired) {
            sttCue = 'Private on-device';
            sttHelp = (
                <div className="space-y-1.5">
                    <p>Private runs on your device after a one-time setup.</p>
                    <p className="text-foreground/60" data-testid="private-model-size-note">
                        {`One-time download of the on-device speech model (about ${modelSizeMB} MB). Your audio is transcribed in your browser and never uploaded. If site storage is cleared, setup may be required again.`}
                    </p>
                </div>
            );
        } else {
            sttCue = 'Ready on this device';
            sttHelp = <p>Runs locally on your device when supported. Best for privacy.</p>;
        }
    } else {
        // native / Browser
        sttCue = 'Browser provider';
        sttHelp = (
            <div className="space-y-1.5">
                <p>Uses your browser&apos;s speech service. Audio may be processed by the browser provider.</p>
                {hasPrivateSampleAccess && (
                    <p className="text-foreground/60">
                        {`Try one Private sample session — up to ${privateCapLabel} per recording during beta, with local transcription so you can compare it with Browser transcription.`}
                    </p>
                )}
            </div>
        );
    }

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
                                    label={`About ${getModeLabel(mode)} transcription`}
                                    testId="stt-mode-help"
                                    panelClassName="w-64"
                                >
                                    {sttHelp}
                                </HelpPopover>
                            </div>

                            {/* Browser path: privacy upsell that switches to Private (detail in help). */}
                            {!isPrivateDownloadRequired && mode === 'native' && canUsePrivate && !isListening && (
                                <button
                                    type="button"
                                    onClick={() => handleModeChange('private')}
                                    className="mt-1 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
                                    data-testid="first-run-setup-private"
                                >
                                    Want more privacy? Set up Private
                                </button>
                            )}

                            {/* Private first-run: no separate "Set up" button — clicking the mic starts the
                                one-time model download and the pill below shows progress until it's ready. */}
                            {isPrivateDownloadRequired && (
                                <p className="mt-1 text-[11px] font-medium text-muted-foreground" data-testid="private-first-run-note">
                                    First-time use: click the mic to download the model. Available once the status turns green.
                                </p>
                            )}
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={isListening}>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-10 w-full justify-center gap-1.5 rounded-md border border-border px-3.5 text-[11px] font-semibold text-foreground transition-all hover:bg-muted hover:text-foreground sm:w-auto"
                                title={isListening ? "Cannot change mode during recording" : "Select mode"}
                                data-testid={TEST_IDS.STT_MODE_SELECT}
                                data-state={mode}
                            >
                                <span className="text-primary">•</span>
                                {getModeLabel(mode)}
                                {!isListening && <ChevronDown className="h-2.5 w-2.5 opacity-50" />}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 overflow-visible">
                            {/* Approved order + labels: Cloud, Browser, 🔒 Private. Rows stay one-line;
                                hovering or keyboard-focusing a row shows a small neutral tooltip bubble
                                beside it. No accent-green / brand highlight — neutral system styling. */}
                            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => handleModeChange(v as RecordingMode)}>
                                <DropdownMenuRadioItem
                                    value="cloud"
                                    className="group relative py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground focus:bg-muted focus:text-foreground"
                                    data-testid={TEST_IDS.STT_MODE_CLOUD}
                                    disabled={!canUseCloudStt}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {!canUseCloudStt && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                                        Cloud
                                    </span>
                                    <span role="tooltip" data-testid="stt-desc-cloud" className={STT_TOOLTIP_CLASS}>
                                        {cloudOptionDesc}
                                    </span>
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="native"
                                    className="group relative py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground focus:bg-muted focus:text-foreground"
                                    data-testid={TEST_IDS.STT_MODE_NATIVE}
                                >
                                    <span>Browser</span>
                                    <span role="tooltip" data-testid="stt-desc-native" className={STT_TOOLTIP_CLASS}>
                                        {nativeOptionDesc}
                                    </span>
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="private"
                                    className="group relative py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground focus:bg-muted focus:text-foreground"
                                    data-testid={TEST_IDS.STT_MODE_PRIVATE}
                                    disabled={!canUsePrivate}
                                >
                                    <span className="flex items-center gap-1.5">
                                        <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                                        Private
                                    </span>
                                    <span role="tooltip" data-testid="stt-desc-private" className={STT_TOOLTIP_CLASS}>
                                        {privateOptionDesc}
                                    </span>
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
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
                                        if (isPrivateDownloadRequired) { onDownloadModel?.(); return; }
                                        // Never start a not-ready Private engine (that was the crash) — the mic
                                        // is disabled in that state, and this guards even if the click slips through.
                                        if (mode === 'private' && !isPrivateModelReady) { return; }
                                        onStartStop();
                                    }}
                                    disabled={isPrivateDownloadRequired ? false : (mode === 'private' ? !isPrivateModelReady : isButtonDisabled)}
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
                                    {isPrivateDownloadRequired
                                        ? 'Tap the mic to set up'
                                        : isDownloadingModel
                                            ? (displayStatusMessage || 'Downloading model…')
                                            : isFinalizing
                                                ? 'Finalizing your transcript…'
                                                : isWarming
                                                    ? 'Getting mic ready — one moment…'
                                                    : justBecameReady
                                                        ? 'Ready — speak now'
                                                        : isPrivateModelReady
                                                            ? 'Ready to record'
                                                            : (displayStatusMessage || (isPaused ? 'Paused' : (isListening ? (activeEngine && activeEngine !== 'none' ? 'Recording' : 'Listening') : 'Ready to record')))}
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
