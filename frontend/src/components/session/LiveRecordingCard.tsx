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
    modelLoadingProgress: number | null;
    formattedTime: string;
    elapsedSeconds: number; // Added for minimum session duration check
    isButtonDisabled: boolean;
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
    modelLoadingProgress,
    formattedTime,
    elapsedSeconds,
    isButtonDisabled,
    onModeChange,
    onStartStop,
}) => {
    // Check if session is too short to save
    const isTooShort = isListening && elapsedSeconds > 0 && elapsedSeconds < MIN_SESSION_DURATION_SECONDS;
    const getModeLabel = (m: RecordingMode) => {
        switch (m) {
            case 'native': return 'Native';
            case 'private': return 'Private';
            case 'cloud': return 'Cloud';
        }
    };

    return (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl relative" data-testid="live-recording-card">

            {/* Mode Selector - Absolute Top Right */}
            <div className="absolute top-6 right-6">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={isListening}>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-2 text-muted-foreground hover:text-foreground disabled:opacity-80"
                            title={isListening ? "Cannot change mode during recording" : "Select transcription mode"}
                            data-testid={TEST_IDS.STT_MODE_SELECT}
                        >
                            {getModeLabel(mode)}
                            {!isListening && <ChevronDown className="h-4 w-4" />}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onModeChange(v as RecordingMode)}>
                            <DropdownMenuRadioItem value="native" data-testid={TEST_IDS.STT_MODE_NATIVE}>Native (Browser)</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="private" disabled={!isProUser} data-testid={TEST_IDS.STT_MODE_PRIVATE}>
                                Private {!isProUser && '(Pro)'}
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="cloud" disabled={!isProUser} data-testid={TEST_IDS.STT_MODE_CLOUD}>
                                Cloud {!isProUser && '(Pro)'}
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Header */}
            <div className="text-center mb-8 mt-2">
                <h1 className="text-3xl font-bold text-foreground mb-2" data-testid="live-session-header">
                    {isListening
                        ? (isReady ? "Recording..." : "Connecting...")
                        : modelLoadingProgress !== null
                            ? "Initializing..."
                            : "Live Session"}
                </h1>
                <p className="text-muted-foreground" data-testid="live-session-description">
                    {isListening
                        ? "Speak clearly into your microphone"
                        : modelLoadingProgress !== null
                            ? `Downloading model: ${Math.round(modelLoadingProgress)}%`
                            : "Click the microphone to start your session"}
                </p>
            </div>

            {/* Waveform Visualization */}
            <div
                className="flex items-center justify-center gap-1 h-24 mb-8 bg-muted/30 rounded-xl p-4 overflow-hidden"
                data-testid="recording-indicator"
            >
                {[...Array(40)].map((_, i) => (
                    <div
                        key={i}
                        className={`w-1.5 rounded-full transition-all duration-150 ${isListening && isReady ? "bg-secondary" : "bg-muted-foreground/20"
                            }`}
                        style={{
                            height: isListening && isReady
                                ? `${Math.max(8, Math.random() * 60 + 20)}px`
                                : "8px"
                        }}
                    />
                ))}
            </div>

            {/* Timer */}
            <div className="text-center mb-10">
                <span className="text-6xl font-mono font-bold text-foreground tracking-wider">
                    {formattedTime}
                </span>
                {isTooShort && (
                    <div className="flex items-center justify-center gap-2 mt-4 text-amber-500 font-medium animate-pulse">
                        <AlertCircle className="h-4 w-4" />
                        <span>Minimum duration: {MIN_SESSION_DURATION_SECONDS}s</span>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
                {!isListening ? (
                    <Button
                        onClick={onStartStop}
                        disabled={isButtonDisabled}
                        data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                        size="lg"
                        aria-label="Start Recording"
                        className="w-24 h-24 rounded-full bg-secondary hover:bg-secondary/90 text-secondary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center"
                    >
                        <Mic className="w-10 h-10" />
                        <span className="sr-only">Start</span>
                    </Button>
                ) : (
                    <>
                        {/* Stop Button */}
                        <Button
                            onClick={onStartStop}
                            disabled={isButtonDisabled}
                            data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                            size="lg"
                            aria-label="Stop Recording"
                            className="w-24 h-24 rounded-full bg-destructive hover:bg-destructive/90 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center"
                        >
                            <Square className="w-10 h-10 fill-current" />
                            <span className="sr-only">Stop</span>
                        </Button>
                    </>
                )}
            </div>

            {/* Status Footer */}
            <div className="mt-8 text-center">
                {isListening && mode === 'private' && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-medium border border-emerald-500/20">
                        <Shield className="h-3 w-3" />
                        Private On-Device Processing
                    </div>
                )}
            </div>
        </div>
    );
};

export const LiveRecordingCard = (props: LiveRecordingCardProps) => (
    <LocalErrorBoundary componentName="LiveRecordingCard">
        <LiveRecordingCardContent {...props} />
    </LocalErrorBoundary>
);

export default LiveRecordingCard;
