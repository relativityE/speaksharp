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
        bgClass: 'bg-orange-500',
        textClass: 'text-black',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-orange-500',
        textClass: 'text-black',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-orange-500',
        textClass: 'text-black',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-orange-500',
        textClass: 'text-black',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-orange-500',
        textClass: 'text-black',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-destructive',
        textClass: 'text-white',
    },
};

/**
 * Persistent status bar showing STT state transitions.
 * Displays above the Live Recording card to inform users of initialization,
 * fallback, and error states.
 */
export const StatusNotificationBar: React.FC<StatusNotificationBarProps> = ({ status, className = '' }) => {
    const config = statusConfig[status.type];
    const Icon = config.icon;
    const isAnimated = status.type === 'initializing' || status.type === 'downloading';

    return (
        <div
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${config.bgClass} ${className}`}
            role="status"
            aria-live="polite"
            data-testid={status.type === 'downloading' ? 'model-loading-indicator' : 'stt-status-bar'}
        >
            <Icon className={`h-5 w-5 ${config.textClass} ${isAnimated ? 'animate-spin' : ''}`} />
            <span data-testid="session-status-indicator" className={`text-sm font-bold ${config.textClass}`}>
                {status.message || (status.type === 'idle' ? 'Ready' : '')}
            </span>
            {status.progress !== undefined && status.type === 'downloading' && (
                <div className="flex-1 max-w-32 h-1.5 bg-black/20 rounded-full overflow-hidden ml-2">
                    <div
                        className="h-full bg-black transition-all duration-300"
                        style={{ width: `${status.progress}%` }}
                    />
                </div>
            )}
        </div>
    );
};

export default StatusNotificationBar;
