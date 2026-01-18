import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Square, Play, ChevronDown, AlertCircle, Shield } from 'lucide-react';
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

/**
 * The main recording control panel with mode selector, mic indicator,
 * timer, and start/stop button.
 * Extracted from SessionPage for better reusability and testability.
 */
export const LiveRecordingCard: React.FC<LiveRecordingCardProps> = ({
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
            case 'native':
                return 'Native';
            case 'private':
                return 'Private';
            case 'cloud':
                return 'Cloud';
        }
    };

    return (
        <div className="bg-card border border-border rounded-lg shadow-elegant" data-testid="live-recording-card">
            <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-semibold text-foreground">Live Recording</h2>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-2">
                                    {getModeLabel(mode)}
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuRadioGroup
                                    value={mode}
                                    onValueChange={(v) => onModeChange(v as RecordingMode)}
                                >
                                    <DropdownMenuRadioItem value="native">
                                        Native (Browser)
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="private" disabled={!isProUser}>
                                        Private {!isProUser && '(Pro)'}
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="cloud" disabled={!isProUser}>
                                        Cloud {!isProUser && '(Pro)'}
                                    </DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Settings button removed/moved to FillerWordsCard */}
                        <Badge
                            className={`${isListening && isReady
                                ? 'bg-green-600 text-white border-green-600'
                                : 'bg-secondary text-white border-secondary'
                                } `}
                            data-testid={TEST_IDS.SESSION_STATUS_INDICATOR}
                        >
                            {modelLoadingProgress !== null
                                ? 'Initializing...'
                                : isListening
                                    ? (isReady ? `● Recording (${mode === 'native' ? 'Browser' : mode === 'private' ? 'Private' : 'Cloud'})` : 'Connecting...')
                                    : 'Ready'}
                        </Badge>
                        {/* Privacy indicator for Private STT mode */}
                        {isListening && mode === 'private' && (
                            <Badge
                                className="bg-emerald-600/90 text-white border-emerald-600 gap-1"
                                data-testid="privacy-indicator"
                            >
                                <Shield className="h-3 w-3" />
                                On-Device
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="flex flex-col items-center py-4 bg-background/30 rounded-lg border border-white/10">
                    {/* Mic Icon Circle */}
                    <div
                        className={`w - 16 h - 16 rounded - full flex items - center justify - center mb - 4 ${isListening ? 'bg-red-500/20' : 'bg-primary'
                            } `}
                    >
                        {isListening ? (
                            <Mic className="w-8 h-8 text-red-500" strokeWidth={2} />
                        ) : (
                            <MicOff className="w-8 h-8 text-white" strokeWidth={2} />
                        )}
                    </div>

                    {/* Model Loading Indicator */}
                    {modelLoadingProgress !== null && (
                        <div className="mb-6 w-full max-w-md" data-testid={TEST_IDS.MODEL_LOADING_INDICATOR}>
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-muted-foreground">Downloading model...</span>
                                <span className="text-primary font-medium">
                                    {Math.round(modelLoadingProgress * 100)}%
                                </span>
                            </div>
                            <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${modelLoadingProgress * 100}% ` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Timer */}
                    <div className="text-3xl font-medium text-foreground mb-2">{formattedTime}</div>
                    <p className="text-muted-foreground" data-testid={TEST_IDS.TRANSCRIPT_DISPLAY}>
                        {modelLoadingProgress !== null
                            ? 'Preparing AI model...'
                            : isListening
                                ? 'Recording in progress...'
                                : 'Click start to begin recording'}
                    </p>

                    {/* Inline warning for short sessions */}
                    {isTooShort && (
                        <div className="flex items-center gap-2 mt-3 text-amber-500 text-sm" data-testid="short-session-warning">
                            <AlertCircle className="h-4 w-4" />
                            <span>Suggestion: Record at least {MIN_SESSION_DURATION_SECONDS} seconds for accurate metrics</span>
                        </div>
                    )}
                </div>

                {/* Control Button - Outside shaded box */}
                <div className="flex justify-center mt-6">
                    <Button
                        onClick={onStartStop}
                        size="lg"
                        variant={isListening ? 'destructive' : 'default'}
                        className="w-48 h-12 text-lg font-semibold hidden md:flex"
                        disabled={isButtonDisabled}
                        data-testid={TEST_IDS.SESSION_START_STOP_BUTTON}
                    >
                        {modelLoadingProgress !== null ? (
                            <>
                                <Square className="w-5 h-5 mr-2" /> Cancel
                            </>
                        ) : isListening ? (
                            <>
                                <Square className="w-5 h-5 mr-2" /> {isReady ? 'Stop' : 'Cancel'}
                            </>
                        ) : (
                            <>
                                <Play className="w-5 h-5 mr-2" /> Start
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default LiveRecordingCard;
