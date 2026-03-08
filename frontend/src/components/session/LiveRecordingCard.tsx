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
    formattedTime,
    elapsedSeconds,
    statusMessage,
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
        <LocalErrorBoundary componentName="LiveRecordingCard">
            <div className={`bg-primary/5 border border-primary/20 rounded-2xl p-8 shadow-[0_0_40px_-10px_rgba(251,191,36,0.15)] relative z-10 h-full flex flex-col items-center justify-center text-center gap-4 ${className}`} data-testid="live-recording-card">

                {/* Visual Center with Left Controls */}
                <div className="flex items-center justify-center gap-6 w-full translate-x-[-10px]"> {/* Offset to visually center the mic/timer duo */}

                    {/* Left Column Stack: Secure + Selector */}
                    <div className="flex flex-col items-start gap-1 flex-shrink-0 min-w-0">
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[7px] font-black text-emerald-500 uppercase tracking-tighter" data-state="secure">
                            <Shield className="h-2 w-2 fill-emerald-500/10" />
                            <span>SECURE</span>
                        </div>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild disabled={isListening}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-1.5 gap-1 text-[9px] uppercase tracking-widest font-black text-muted-foreground hover:text-foreground hover:bg-background/40 rounded border border-primary/10 transition-all font-mono"
                                    title={isListening ? "Cannot change mode during recording" : "Select mode"}
                                    data-testid={TEST_IDS.STT_MODE_SELECT}
                                    data-state={mode}
                                >
                                    <span className="text-primary">•</span>
                                    {getModeLabel(mode)}
                                    {!isListening && <ChevronDown className="h-2.5 w-2.5 opacity-50" />}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-[140px]">
                                <DropdownMenuRadioGroup value={mode} onValueChange={(v) => onModeChange(v as RecordingMode)}>
                                    <DropdownMenuRadioItem value="native" className="text-xs uppercase" data-testid={TEST_IDS.STT_MODE_NATIVE}>Native Browser</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="private" disabled={!isProUser} className="text-xs uppercase" data-testid={TEST_IDS.STT_MODE_PRIVATE}>Private (Pro)</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="cloud" disabled={!isProUser} className="text-xs uppercase" data-testid={TEST_IDS.STT_MODE_CLOUD}>Cloud (Pro)</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* Proportional Vertical Stack: Mic + Timer */}
                    <div className="flex flex-col items-center gap-3 flex-shrink-0">
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
                                    aria-label="Start Recording"
                                    className="w-11 h-11 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-elegant hover:scale-105 transition-all duration-300 p-0"
                                >
                                    <Mic className="w-5 h-5" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={onStartStop}
                                    disabled={isButtonDisabled}
                                    data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                                    aria-label="Stop Recording"
                                    className="w-11 h-11 rounded-full bg-primary hover:bg-primary/80 text-primary-foreground active:scale-95 transition-all duration-300 animate-pulse p-0"
                                >
                                    <Square className="w-4 h-4 fill-current" />
                                </Button>
                            )}
                        </div>

                        {/* Timer (Matching Mic weight) */}
                        <div className="flex flex-col items-center">
                            <div className="text-4xl font-mono font-bold text-foreground tracking-tighter tabular-nums leading-none">
                                {formattedTime}
                            </div>
                            <div className="mt-1 inline-flex items-center gap-1.5 py-0.5 px-2 rounded-full bg-muted/5 border border-muted/10 opacity-60">
                                <div className={`h-1 w-1 rounded-full ${isListening ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                                <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
                                    {isListening ? (activeEngine && activeEngine !== 'none' ? "Recording" : "Syncing") : (statusMessage || "Engine Ready")}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Empty Space for visual symmetry on the left controls */}
                    <div className="flex-1 hidden sm:block min-w-[60px]" aria-hidden="true" />
                </div>

                {/* Stream Indicator (Refined) */}
                <div className="h-4 w-full max-w-[140px] flex items-center justify-center gap-0.5 overflow-hidden opacity-30">
                    {isListening && isReady && (
                        <div className="flex items-center gap-0.5" data-testid="recording-indicator">
                            {[...Array(10)].map((_, i) => (
                                <div
                                    key={i}
                                    className="w-0.5 rounded-full bg-primary/40"
                                    style={{
                                        height: `${Math.max(4, Math.random() * 14 + 4)}px`,
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
