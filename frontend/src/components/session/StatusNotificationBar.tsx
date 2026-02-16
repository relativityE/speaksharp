import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle } from 'lucide-react';

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'fallback' | 'error';

export interface SttStatus {
    type: SttStatusType;
    message: string;
    detail?: string;
    progress?: number; // 0-100 for downloading state
}

interface StatusNotificationBarProps {
    status: SttStatus;
    className?: string;
}

const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'bg-yellow-400 border-yellow-600 shadow-md',
        textClass: 'text-black font-black uppercase',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-yellow-400 border-yellow-600 shadow-xl',
        textClass: 'text-black font-black uppercase',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-yellow-400 border-yellow-600 shadow-xl',
        textClass: 'text-black font-black uppercase',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-yellow-400 border-yellow-600 shadow-xl',
        textClass: 'text-black font-black uppercase',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-yellow-400 border-yellow-600 shadow-xl',
        textClass: 'text-black font-black uppercase',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-red-600 border-red-800 shadow-xl',
        textClass: 'text-white font-black uppercase',
    },
};

/**
 * Persistent status bar showing STT state transitions.
 * Displays above the Live Recording card to inform users of initialization,
 * fallback, and error states.
 */
export const StatusNotificationBar: React.FC<StatusNotificationBarProps> = ({ status, className = '' }) => {
    // Primary Status Configuration
    const config = statusConfig[status.type];
    const Icon = config.icon;
    const isAnimated = status.type === 'initializing' || status.type === 'downloading';

    // Secondary Status (Background Download)
    const hasSecondary = typeof status.progress === 'number';
    const displayMessage = status.message?.replace(/^[⛔⚠️🚫]\s*/, '').trim() || status.message;
    const emoji = status.message?.match(/^[⛔⚠️🚫]/)?.[0];

    return (
        <div
            className={`flex items-center gap-3 w-full px-6 py-2 rounded-none border-y-2 ${config.bgClass} ${className} transition-all duration-300`}
            role="status"
            aria-live="polite"
            data-testid="stt-status-bar"
        >
            {/* Primary Status Indicator */}
            <div className="flex items-center gap-3 flex-1" data-testid="session-status-indicator">
                {emoji ? (
                    <span className="text-lg leading-none" role="img" aria-label="status-icon">{emoji}</span>
                ) : (
                    <Icon className={`h-5 w-5 ${config.textClass} ${isAnimated ? 'animate-spin' : ''}`} />
                )}
                <div className="flex flex-col">
                    <span className={`text-sm font-black uppercase tracking-tight ${config.textClass}`} data-testid="status-message-text">
                        {displayMessage || (status.type === 'idle' ? 'Ready' : '')}
                    </span>
                    {status.detail && (
                        <span className={`text-[10px] font-medium opacity-80 ${config.textClass}`}>
                            {status.detail}
                        </span>
                    )}
                </div>
            </div>

            {/* Secondary Status Indicator (Background Task) */}
            {hasSecondary && (
                <div
                    className="flex items-center gap-3 pl-3 ml-auto border-l border-current/20"
                    data-testid="background-task-indicator"
                >
                    <span className={`text-[10px] font-medium ${config.textClass}`}>
                        Downloading private model
                    </span>
                    <div className="flex items-center gap-2 w-24">
                        <div className="flex-1 h-1 bg-current/10 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-current transition-all duration-300 opacity-60"
                                style={{
                                    width: status.progress === -1 ? '40%' : `${status.progress}%`,
                                    backgroundColor: 'currentColor'
                                }}
                            />
                        </div>
                        <span className={`text-[9px] font-bold ${config.textClass} min-w-[20px] text-right`}>
                            {status.progress === -1 ? 'Indeterminate' : `${Math.round(status.progress!)}%`}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StatusNotificationBar;
