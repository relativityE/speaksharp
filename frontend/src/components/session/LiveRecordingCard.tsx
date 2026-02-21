import React from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, ChevronDown, AlertCircle, Shield, Pause } from 'lucide-react';
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
        <div className="glass-strong rounded-3xl p-8 relative overflow-hidden flex flex-col items-center justify-center space-y-8" data-testid="live-recording-card">
            {/* Mode Selector - Top Right */}
            <div className="absolute top-6 right-6 z-20">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={isListening}>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-3 gap-1.5 text-xs text-muted-foreground hover:text-foreground glass rounded-full"
                            title={isListening ? "Cannot change mode during recording" : "Select transcription mode"}
                            data-testid={TEST_IDS.STT_MODE_SELECT}
                        >
                            {getModeLabel(mode)}
                            {!isListening && <ChevronDown className="h-3 w-3" />}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onModeChange(v as RecordingMode)}>
                            <DropdownMenuRadioItem value="native" data-testid={TEST_IDS.STT_MODE_NATIVE}>Native Browser</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="private" disabled={!isProUser}>Private</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="cloud" disabled={!isProUser} data-testid={TEST_IDS.STT_MODE_CLOUD}>Cloud</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Timer */}
            <div className="text-center space-y-2">
                <span className="text-6xl font-mono font-bold text-foreground tracking-wider block">
                    {formattedTime}
                </span>
                <div className="flex items-center justify-center gap-2">
                    <h1 className="text-sm font-medium text-muted-foreground uppercase tracking-widest" data-testid="live-session-header">
                        {isListening ? (activeEngine && activeEngine !== 'none' ? "Recording" : (statusMessage || "Connecting...")) : "Ready"}
                    </h1>
                    {isListening && mode === 'private' && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold border border-primary/20 uppercase tracking-tighter">
                            <Shield className="h-3 w-3" />
                            Secure
                        </div>
                    )}
                </div>
            </div>

            {/* Waveform */}
            <div
                className="flex items-center justify-center gap-1.5 h-16 w-full max-w-md"
                data-testid="recording-indicator"
            >
                {[...Array(32)].map((_, i) => (
                    <div
                        key={i}
                        className={`w-[3px] rounded-full transition-all duration-150 ${isListening && isReady ? "bg-primary animate-pulse" : "bg-muted-foreground/20"
                            }`}
                        style={{
                            height: isListening && isReady
                                ? `${Math.max(6, Math.random() * 40 + 6)}px`
                                : "6px",
                            animationDelay: `${i * 0.05}s`
                        }}
                    />
                ))}
            </div>

            {/* Control Buttons */}
            <div className="flex items-center gap-6">
                {isListening && (
                   <Button
                        variant="ghost"
                        size="icon"
                        className="w-16 h-16 rounded-full glass border-white/10 text-primary hover:bg-white/10"
                        title="Pause (Visual Only)"
                    >
                        <Pause className="w-6 h-6" />
                    </Button>
                )}

                {!isListening ? (
                    <Button
                        onClick={onStartStop}
                        disabled={isButtonDisabled}
                        data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                        data-ready={!isButtonDisabled}
                        data-recording="false"
                        size="icon"
                        aria-label="Start Recording"
                        className="w-24 h-24 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground glow-secondary transition-all duration-300 hover:scale-105 active:scale-95"
                    >
                        <Mic className="w-10 h-10" />
                    </Button>
                ) : (
                    <Button
                        onClick={onStartStop}
                        disabled={isButtonDisabled}
                        data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                        data-ready="true"
                        data-recording="true"
                        size="icon"
                        aria-label="Stop Recording"
                        className="w-24 h-24 rounded-full bg-destructive hover:bg-destructive/90 text-destructive-foreground glow-secondary transition-all duration-300 hover:scale-105 active:scale-95"
                    >
                        <Square className="w-10 h-10 fill-current" />
                    </Button>
                )}
            </div>

            {isTooShort && (
                <div className="absolute bottom-4 flex items-center justify-center gap-1 text-amber-500 text-[10px] font-medium animate-pulse">
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
