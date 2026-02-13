import React from 'react';
import { useSessionStore } from '@/stores/useSessionStore';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import { AlertCircle } from 'lucide-react';

interface TimerDisplayProps {
    isListening: boolean;
    className?: string;
}

/**
 * PERFORMANCE OPTIMIZATION: TimerDisplay (Leaf Component)
 * 
 * Subscribes directly to useSessionStore.elapsedTime.
 * By isolating this high-frequency (1Hz) update here, we prevent 
 * the entire SessionPage and LiveRecordingCard from re-rendering 
 * every second.
 */
export const TimerDisplay: React.FC<TimerDisplayProps> = ({ isListening, className = '' }) => {
    // Select only what we need for the timer
    const elapsedSeconds = useSessionStore(state => state.elapsedTime);

    // Format seconds as MM:SS
    const formattedTime = `${Math.floor(elapsedSeconds / 60)
        .toString()
        .padStart(2, '0')}:${(elapsedSeconds % 60).toString().padStart(2, '0')}`;

    const isTooShort = isListening && elapsedSeconds > 0 && elapsedSeconds < MIN_SESSION_DURATION_SECONDS;

    return (
        <div className={`text-center ${className}`}>
            <span className="text-6xl font-mono font-bold text-foreground tracking-wider" data-testid="session-timer">
                {formattedTime}
            </span>
            {isTooShort && (
                <div className="flex items-center justify-center gap-2 mt-4 text-amber-500 font-medium animate-pulse" data-testid="min-duration-warning">
                    <AlertCircle className="h-4 w-4" />
                    <span>Minimum duration: {MIN_SESSION_DURATION_SECONDS}s</span>
                </div>
            )}
        </div>
    );
};

export default TimerDisplay;
