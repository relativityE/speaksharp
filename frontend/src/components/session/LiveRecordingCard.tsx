import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, Download, Lock, Mic, Square, ChevronDown } from 'lucide-react';
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


export type RecordingMode = 'cloud' | 'native' | 'private' | 'mock';

interface LiveRecordingCardProps {
    // State
    mode: RecordingMode;
    isListening: boolean;
    isReady: boolean;
    isProUser: boolean;
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
const LiveRecordingCardContent: React.FC<LiveRecordingCardProps> = ({
    mode,
    isListening,
    isReady,
    isProUser,
    canUseCloudStt = isProUser,
    statusMessage: _statusMessage,
    formattedTime,
    elapsedSeconds,
    isButtonDisabled,
    isPaused = false,
    activeEngine,
    fsmState,
    sttStatusType,
    recordingIntent = false,
    className = "",
    onModeChange,
    onStartStop,
    onDownloadModel,
}) => {
    // Deriving visibility and recording state from the master FSM + Intent
    // isIndicatorVisible: Shows the waveform when the engine is active OR initializing
    const ACTIVE_INDICATOR_STATES: RuntimeState[] = ['RECORDING', 'ENGINE_INITIALIZING', 'INITIATING', 'STOPPING'];
    const ACTIVE_INDICATOR_TYPES = ['recording', 'initializing', 'downloading', 'download-required', 'paused'];

    const isIndicatorVisible = fsmState
        ? (ACTIVE_INDICATOR_STATES.includes(fsmState) || ACTIVE_INDICATOR_TYPES.includes(sttStatusType || '') || isPaused)
        : (isListening || isPaused) && isReady;

    const isStopControlVisible = isListening || recordingIntent;
    // data-recording: Pure intent signal for E2E tests and accessibility
    const isRecordingSignal = isStopControlVisible ? 'true' : 'false';

    // Check if session is too short to save
    const isTooShort = isListening && elapsedSeconds > 0 && elapsedSeconds < MIN_SESSION_DURATION_SECONDS;
    const isPrivateDownloadRequired = mode === 'private' && sttStatusType === 'download-required' && !isListening;
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
    const modeHint: Record<RecordingMode, string> = {
        native: 'Starts instantly with browser speech recognition. Accuracy depends on browser and room.',
        private: 'Runs locally after model setup. All audio processing remains local.',
        cloud: 'Highest-accuracy transcription for Pro. Audio is sent to cloud STT.',
        mock: 'Test transcription mode.',
    };
    const privateModeDescription = isProUser
        ? 'Private / Vault Mode keeps transcription local after model setup. All audio processing remains local.'
        : 'Private / Vault Mode unlocks with an active trial or Pro. It needs a one-time local model setup.';
    const nativeModeDescription = "Free and instant. Uses your browser's built-in speech recognition, so accuracy varies by browser and environment.";
    const cloudModeDescription = canUseCloudStt
        ? 'Pro feature for highest-accuracy transcription. Audio is sent to the cloud STT provider.'
        : 'Cloud STT is a Pro feature (unavailable for trial).';
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
                            <p className="text-sm font-bold leading-snug text-primary">
                                {isPrivateDownloadRequired
                                    ? 'Set up Private / Vault Mode on this computer. All audio processing remains local.'
                                    : modeHint[mode]}
                            </p>
                            {isPrivateDownloadRequired && (
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    {onDownloadModel && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            onClick={onDownloadModel}
                                            className="h-6 gap-1 rounded-md px-2 text-[9px] font-bold uppercase tracking-[0.12em]"
                                            data-testid="download-model-button-inline"
                                        >
                                            <Download className="h-3 w-3" />
                                            Set Up
                                        </Button>
                                    )}
                                </div>
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
                        <DropdownMenuContent align="end" className="w-72">
                            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onModeChange(v as RecordingMode)}>
                                <DropdownMenuRadioItem
                                    value="native"
                                    className="py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground"
                                    data-testid={TEST_IDS.STT_MODE_NATIVE}
                                    title={nativeModeDescription}
                                >
                                    Browser
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="private"
                                    className="py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground"
                                    data-testid={TEST_IDS.STT_MODE_PRIVATE}
                                    disabled={!isProUser}
                                    title={privateModeDescription}
                                >
                                    Private
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="cloud"
                                    className="py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground"
                                    data-testid={TEST_IDS.STT_MODE_CLOUD}
                                    disabled={!canUseCloudStt}
                                    title={cloudModeDescription}
                                >
                                    Cloud
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
                                    onClick={onStartStop}
                                    disabled={isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    data-recording={isRecordingSignal}
                                    aria-label="Start Recording"
                                    title={isPrivateDownloadRequired ? 'Download required' : 'Start Recording'}
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
                            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/55 px-3 py-1">
                                <div className={`h-1.5 w-1.5 rounded-full ${isListening ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
                                <span className="text-[10px] font-bold text-foreground/70 uppercase tracking-[0.14em]" data-testid="stt-status-label">
                                    {isPrivateDownloadRequired
                                        ? 'Ready'
                                        : displayStatusMessage || (isPaused ? "Paused" : (isListening ? (activeEngine && activeEngine !== 'none' ? "Recording" : "Listening") : "Ready"))}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="h-4 w-full max-w-[140px] self-center flex items-center justify-center gap-0.5 overflow-hidden opacity-60">
                    {isIndicatorVisible && (
                        <div
                            className="flex items-center gap-0.5"
                            data-testid="recording-indicator"
                            data-recording={isRecordingSignal}
                            data-paused={isPaused}
                        >
                            {[...Array(10)].map((_, i) => (
                                <div
                                    key={i}
                                    className={`w-0.5 rounded-full ${isPaused ? 'bg-amber-500/40' : 'bg-primary/40'}`}
                                    style={{
                                        height: isPaused ? '4px' : `${Math.max(4, Math.random() * 14 + 4)}px`,
                                    }}
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
