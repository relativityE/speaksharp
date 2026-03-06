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

export type RecordingMode = 'cloud' | 'native' | 'private';

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
    activeEngine: RecordingMode | 'none' | null;
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
    statusMessage,
    formattedTime,
    elapsedSeconds,
    isButtonDisabled,
    activeEngine,
    className = "",
    onModeChange,
    onStartStop,
}) => {
    // Check if session is too short to save
    const isTooShort = isListening && elapsedSeconds > 0 && elapsedSeconds < MIN_SESSION_DURATION_SECONDS;
    const getModeLabel = (m: RecordingMode) => {
        switch (m) {
            case 'native': return 'Native Browser';
            case 'private': return 'Private';
            case 'cloud': return 'Cloud';
        }
    };

    return (
        <div className={`bg-primary/5 border border-primary/20 rounded-xl p-5 shadow-[0_0_30px_-5px_rgba(251,191,36,0.15)] relative z-10 h-full flex flex-col justify-center ${className}`} data-testid="live-recording-card">
            {/* Horizontal Layout for efficiency */}
            <div className="flex items-center justify-between gap-8">
                {/* Timer & Mode */}
                <div className="flex flex-col">
                    <div className="flex items-center gap-2.5 mb-2">
                        <span className="text-4xl font-mono font-bold text-foreground tracking-tight">
                            {formattedTime}
                        </span>
                        <div className="h-6 w-px bg-border" />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild disabled={isListening}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2.5 gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-80 font-semibold"
                                    title={isListening ? "Cannot change mode during recording" : "Select transcription mode"}
                                    data-testid={TEST_IDS.STT_MODE_SELECT}
                                    data-state={mode}
                                >
                                    {getModeLabel(mode)}
                                    {!isListening && <ChevronDown className="h-4 w-4" />}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onModeChange(v as RecordingMode)}>
                                    <DropdownMenuRadioItem value="native" data-testid={TEST_IDS.STT_MODE_NATIVE}>Native Browser</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="private" disabled={!isProUser}>Private</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="cloud" disabled={!isProUser} data-testid={TEST_IDS.STT_MODE_CLOUD}>Cloud</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <div className="flex items-center gap-2" data-state={isListening ? (activeEngine && activeEngine !== 'none' ? 'recording' : 'connecting') : 'idle'}>
                        <h1 className="text-base font-semibold text-foreground" data-testid="live-session-header">
                            {isListening ? (activeEngine && activeEngine !== 'none' ? "Recording active" : (statusMessage || "Connecting...")) : "Ready to record"}
                        </h1>
                        {isListening && mode === 'private' && (
                            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-bold border border-emerald-500/20 uppercase tracking-tighter" data-state="secure">
                                <Shield className="h-3 w-3" />
                                Secure
                            </div>
                        )}
                    </div>
                </div>

                {/* Waveform (Comfortable size) */}
                <div className="flex-1 flex items-center justify-center gap-1 h-10 bg-muted/20 rounded-xl px-3 overflow-hidden">
                    {isListening && (
                        <div
                            className="flex-1 flex items-center justify-center gap-1"
                            data-testid="recording-indicator"
                        >
                            {[...Array(24)].map((_, i) => (
                                <div
                                    key={i}
                                    className={`w-0.5 rounded-full transition-all duration-150 ${isReady ? "bg-secondary" : "bg-muted-foreground/10"
                                        }`}
                                    style={{
                                        height: isReady
                                            ? `${Math.max(4, Math.random() * 25 + 4)}px`
                                            : "4px"
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Main Action Button (Stable UX) */}
                <div className="flex-shrink-0">
                    {!isListening ? (
                        <Button
                            onClick={onStartStop}
                            disabled={isButtonDisabled}
                            data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                            data-action="start"
                            data-ready={!isButtonDisabled}
                            data-recording="false"
                            size="icon"
                            aria-label="Start Recording"
                            className="w-14 h-14 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground shadow-elegant hover:scale-105 hover:shadow-yellow-glow transition-all duration-300"
                        >
                            <Mic className="w-6 h-6" />
                        </Button>
                    ) : (
                        <Button
                            onClick={onStartStop}
                            disabled={isButtonDisabled}
                            data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                            data-action="stop"
                            data-ready="true" // Stop button is always "ready" once session is active
                            data-recording="true"
                            size="icon"
                            aria-label="Stop Recording"
                            className="w-14 h-14 rounded-full bg-secondary hover:bg-secondary/80 text-secondary-foreground shadow-yellow-glow active:scale-95 transition-all duration-300 animate-pulse"
                        >
                            <Square className="w-6 h-6 fill-current" />
                        </Button>
                    )}
                </div>
            </div>

            {isTooShort && (
                <div className="flex items-center justify-center gap-1 mt-2 text-amber-500 text-[10px] font-medium animate-pulse">
                    <AlertCircle className="h-3 w-3" />
                    <span>Min {MIN_SESSION_DURATION_SECONDS}s needed to save</span>
                </div>
            )}
        </div>
    );
};

export const LiveRecordingCard = (props: LiveRecordingCardProps) => (
    <LocalErrorBoundary componentName="LiveRecordingCard">
        <LiveRecordingCardContent {...props} />
    </LocalErrorBoundary>
);

export default LiveRecordingCard;
