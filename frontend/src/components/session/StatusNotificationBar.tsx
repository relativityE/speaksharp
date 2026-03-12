import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle, Lock } from 'lucide-react';

import { SttStatus, SttStatusType } from '../../types/transcription';
import { useSessionStore } from '../../stores/useSessionStore';

interface StatusNotificationBarProps {
    status: SttStatus;
    className?: string;
}

/**
 * STANDARDIZED UI (v3.5.0): Solid Yellow Thin Bar
 * Yellow-400 bg, bold black text, 2px border.
 * Consistent across all operational states.
 */
const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-sm',
        textClass: 'text-black font-black',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-yellow-glow',
        textClass: 'text-black font-black',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-yellow-glow',
        textClass: 'text-black font-black',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-sm',
        textClass: 'text-black font-black',
    },
    recording: {
        icon: Info,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-yellow-glow animate-pulse',
        textClass: 'text-black font-black',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-sm',
        textClass: 'text-black font-black',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-sm',
        textClass: 'text-black font-black',
    },
    info: {
        icon: Info,
        bgClass: 'bg-yellow-400 border-2 border-yellow-500/50 shadow-sm',
        textClass: 'text-black font-black',
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

    // Secondary Status (Background Download) - Read directly from store to persist across mode changes
    const activeEngine = useSessionStore((s) => s.activeEngine);
    const modelLoadingProgress = useSessionStore((s) => s.modelLoadingProgress);
    const hasSecondary = modelLoadingProgress !== null;

    // ✅ FIX: Explicit defaults for display message
    let displayMessage = status.message?.replace(/^(?:⛔|⚠️|🚫)\s*/u, '').trim();

    if (!displayMessage) {
        switch (status.type) {
            case 'idle':
                displayMessage = 'Ready';
                break;
            case 'recording': {
                displayMessage = status.message || 'Recording active';
                break;
            }
            case 'ready':
                displayMessage = 'Ready to record';
                break;
            case 'error':
                displayMessage = 'Error occurred';
                break;
            case 'downloading':
                displayMessage = 'Downloading...';
                break;
            case 'info':
                displayMessage = 'Information';
                break;
            default:
                displayMessage = 'Ready';
        }
    }

    const emoji = status.message?.match(/^(?:⛔|⚠️|🚫)/u)?.[0];

    return (
        <div
            className={`flex items-center gap-4 w-full px-5 py-2 rounded-t-xl border-b border-white/5 ${config.bgClass} ${className} transition-all duration-300`}
            role="status"
            aria-live="polite"
            data-testid="stt-status-bar"
            data-state={status.type}
            data-engine={activeEngine || 'none'}
        >
            {/* Primary Status Indicator */}
            <div className="flex items-center gap-3" data-testid="session-status-indicator">
                <div className="relative">
                    {emoji ? (
                        <span className="text-xl leading-none" role="img" aria-label="status-icon">{emoji}</span>
                    ) : (
                        <Icon className={`h-5 w-5 ${config.textClass} ${isAnimated ? 'animate-spin' : ''}`} />
                    )}

                    {/* Vault Mode Indicator (Padlock) */}
                    {activeEngine === 'private' && (
                        <div className="absolute -top-1 -right-1 bg-background rounded-full p-0.5 shadow-sm border border-white/10" title="Vault Mode: On-Device Processing">
                            <Lock className="h-2 w-2 text-emerald-500 fill-emerald-500/20" />
                        </div>
                    )}
                </div>
                <div className="flex flex-col">
                    <span className={`text-xs font-black uppercase tracking-widest ${config.textClass}`} data-testid="status-message-text">
                        {displayMessage}
                    </span>
                    {status.detail && (
                        <span className={`text-[10px] font-medium opacity-70 ${config.textClass}`}>
                            {status.detail}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex-1" />

            {/* Secondary Status Indicator (Background Task) - Far Right */}
            {hasSecondary && (
                <div
            className="flex items-center gap-4 pl-4 border-l border-black/10"
                    data-testid="background-task-indicator"
                >
                    <div className="flex flex-col items-end">
                <span className={`text-[10px] font-black uppercase tracking-wider ${config.textClass}`}>
                            Private Model
                        </span>
                <span className={`text-[9px] font-bold opacity-70 ${config.textClass}`}>
                            {modelLoadingProgress === 100 ? 'Cached' : 'Downloading...'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 w-32">
                <div className="flex-1 h-1.5 bg-black/10 rounded-full overflow-hidden shadow-inner">
                            <div
                        className="h-full bg-black transition-all duration-500 ease-out"
                                style={{
                            width: `${modelLoadingProgress}%`
                                }}
                            />
                        </div>
                        <span className={`text-[10px] font-black ${config.textClass} min-w-[30px] text-right tabular-nums`}>
                            {Math.round(modelLoadingProgress)}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StatusNotificationBar;
