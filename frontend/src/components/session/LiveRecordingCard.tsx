import React from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, ChevronDown, AlertCircle, Shield } from 'lucide-react';
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
}

import { LocalErrorBoundary } from '@/components/LocalErrorBoundary';

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
}) => {
    // Deriving visibility and recording state from the master FSM + Intent
    // isIndicatorVisible: Shows the waveform when the engine is active OR initializing
    const ACTIVE_INDICATOR_STATES: RuntimeState[] = ['RECORDING', 'ENGINE_INITIALIZING', 'INITIATING', 'STOPPING'];
    const ACTIVE_INDICATOR_TYPES = ['recording', 'initializing', 'downloading', 'download-required', 'paused'];

    const isIndicatorVisible = fsmState
        ? (ACTIVE_INDICATOR_STATES.includes(fsmState) || ACTIVE_INDICATOR_TYPES.includes(sttStatusType || '') || isPaused)
        : (isListening || isPaused) && isReady;

    // data-recording: Pure intent signal for E2E tests and accessibility
    const isRecordingSignal = recordingIntent ? 'true' : 'false';

    // Check if session is too short to save
    const isTooShort = isListening && elapsedSeconds > 0 && elapsedSeconds < MIN_SESSION_DURATION_SECONDS;
    const getModeLabel = (m: RecordingMode) => {
        switch (m) {
            case 'native': return 'Native Browser';
            case 'private': return 'Private';
            case 'cloud': return 'Cloud';
        }
    };
    const modeDescriptions: Record<RecordingMode, string> = {
        native: 'Uses your browser speech recognition. Availability varies.',
        private: 'Private local transcription after one-time model setup.',
        cloud: 'High-reliability cloud transcription processed externally.',
        mock: 'Test transcription mode.',
    };

    return (
        <LocalErrorBoundary componentName="LiveRecordingCard">
            <div className={`bg-white border border-border rounded-lg p-6 sm:p-8 shadow-card relative z-10 h-full flex flex-col text-center gap-6 ${className}`} data-testid="live-recording-card">

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-success/12 border border-success/30 text-[10px] font-semibold text-success" data-state="secure">
                            <Shield className="h-2.5 w-2.5 fill-success/10" />
                            <span>SECURE</span>
                        </div>
                        <p className="max-w-72 text-xs leading-snug text-muted-foreground">
                            {modeDescriptions[mode]}
                        </p>
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
                                <DropdownMenuRadioItem value="native" className="items-start py-2.5" data-testid={TEST_IDS.STT_MODE_NATIVE}>
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Native browser transcription</span>
                                        <span className="text-[11px] font-normal normal-case leading-snug text-muted-foreground">
                                            Uses your browser speech recognition. Availability varies.
                                        </span>
                                    </span>
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="private"
                                    className="items-start py-2.5"
                                    data-testid={TEST_IDS.STT_MODE_PRIVATE}
                                    disabled={!isProUser}
                                >
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Private local {!isProUser ? '(Pro)' : ''}</span>
                                        <span className="text-[11px] font-normal normal-case leading-snug text-muted-foreground">
                                            Runs locally after one-time setup. Best for privacy.
                                        </span>
                                    </span>
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem
                                    value="cloud"
                                    className="items-start py-2.5"
                                    data-testid={TEST_IDS.STT_MODE_CLOUD}
                                    disabled={!isProUser}
                                >
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Cloud transcription {!isProUser ? '(Pro)' : ''}</span>
                                        <span className="text-[11px] font-normal normal-case leading-snug text-muted-foreground">
                                            Uses AssemblyAI. Audio is processed externally.
                                        </span>
                                    </span>
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center gap-5">
                    {/* Proportional Vertical Stack: Mic + Timer */}
                    <div className="flex flex-col items-center gap-4">
                        {/* Mic Button (Balanced with Timer weight) */}
                        <div className="relative">
                            {isListening && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="absolute w-12 h-12 rounded-full bg-primary/20 animate-ping opacity-75" />
                                </div>
                            )}

                            {!isListening ? (
                                <Button
                                    onClick={onStartStop}
                                    disabled={isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    data-recording={isRecordingSignal}
                                    aria-label="Start Recording"
                                    className="w-14 h-14 rounded-full bg-primary hover:bg-[#D97706] text-primary-foreground shadow-[0_4px_12px_rgba(245,158,11,0.25)] hover:scale-105 transition-all duration-300 p-0"
                                >
                                    <Mic className="w-6 h-6" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={onStartStop}
                                    disabled={isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    data-recording={isRecordingSignal}
                                    aria-label="Stop Recording"
                                    className="w-14 h-14 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground active:scale-95 transition-all duration-300 animate-pulse p-0"
                                >
                                    <Square className="w-5 h-5 fill-current" />
                                </Button>
                            )}
                        </div>

                        {/* Timer (Matching Mic weight) */}
                        <div className="flex flex-col items-center">
                            <div className="text-4xl font-mono font-bold text-foreground tracking-tighter tabular-nums leading-none">
                                {formattedTime}
                            </div>
                            <div className="mt-2 inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-muted/30 border border-border/60">
                                <div className={`h-1.5 w-1.5 rounded-full ${isListening ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'}`} />
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.14em]" data-testid="stt-status-label">
                                    {_statusMessage || (isPaused ? "Paused" : (isListening ? (activeEngine && activeEngine !== 'none' ? "Recording" : "Listening") : "Ready"))}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stream Indicator (Refined) */}
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
