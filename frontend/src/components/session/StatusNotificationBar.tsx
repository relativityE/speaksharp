import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle } from 'lucide-react';

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'fallback' | 'error';

export interface SttStatus {
    type: SttStatusType;
    message: string;
    progress?: number; // 0-100 for downloading state
}

interface StatusNotificationBarProps {
    status: SttStatus;
    className?: string;
}

const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'bg-secondary',
        textClass: 'text-secondary-foreground',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-secondary',
        textClass: 'text-secondary-foreground',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-secondary',
        textClass: 'text-secondary-foreground',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-secondary',
        textClass: 'text-secondary-foreground',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-secondary',
        textClass: 'text-secondary-foreground',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-destructive',
        textClass: 'text-destructive-foreground',
    },
};

/**
 * Persistent status bar showing STT state transitions.
 * Displays above the Live Recording card to inform users of initialization,
 * fallback, and error states.
 */
export const StatusNotificationBar: React.FC<StatusNotificationBarProps> = ({ status, className = '' }) => {
    // EXECUTIVE PATTERN: Dual-State Display
    // If we have a secondary status (background task), we show it alongside the primary status.
    // If not, we fallback to the original single-state behavior.

    // Primary Status Configuration
    const config = statusConfig[status.type];
    const Icon = config.icon;
    const isAnimated = status.type === 'initializing';

    // Secondary Status (Background Download)
    // We explicitly look for the 'progress' field in the status object.
    // In the new pattern, 'status.progress' being defined implies a secondary background task.
    const hasSecondary = status.progress !== undefined;

    return (
        <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${config.bgClass} ${className}`}
            role="status"
            aria-live="polite"
            data-testid="stt-status-bar"
        >
            {/* Primary Status Indicator */}
            <div className="flex items-center gap-2" data-testid="session-status-indicator">
                <Icon className={`h-5 w-5 ${config.textClass} ${isAnimated ? 'animate-spin' : ''}`} />
                <span className={`text-sm font-bold ${config.textClass}`}>
                    {status.message || (status.type === 'idle' ? 'Ready' : '')}
                </span>
            </div>

            {/* Secondary Status Indicator (Background Task) */}
            {hasSecondary && (
                <div
                    className="flex items-center gap-3 pl-4 ml-auto border-l border-black/20"
                    data-testid="background-task-indicator"
                >
                    <span className={`text-xs font-medium ${config.textClass}`}>
                        Downloading private model
                    </span>
                    <div className="flex items-center gap-2 w-32">
                        <div className="flex-1 h-1.5 bg-black/20 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-black transition-all duration-300"
                                style={{ width: `${status.progress}%` }}
                            />
                        </div>
                        <span className={`text-[10px] font-bold ${config.textClass} min-w-[24px]`}>
                            {Math.round(status.progress!)}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StatusNotificationBar;
