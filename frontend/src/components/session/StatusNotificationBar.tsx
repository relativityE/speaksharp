import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle, Lock } from 'lucide-react';

import { SttStatus, SttStatusType } from '../../types/transcription';
import { useSessionStore } from '../../stores/useSessionStore';

interface StatusNotificationBarProps {
    status: SttStatus;
    className?: string;
}

const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'glass border-white/5 shadow-sm',
        textClass: 'text-muted-foreground font-semibold',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-primary/10 border-primary/20 shadow-glow backdrop-blur-xl',
        textClass: 'text-primary font-bold',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-primary/20 border-primary/30 shadow-cyan-glow backdrop-blur-2xl',
        textClass: 'text-primary font-bold',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-emerald-500/10 border-emerald-500/20 shadow-sm backdrop-blur-xl',
        textClass: 'text-emerald-500 font-bold',
    },
    recording: {
        icon: Info,
        bgClass: 'bg-secondary/10 border-secondary/20 shadow-yellow-glow backdrop-blur-xl animate-pulse',
        textClass: 'text-secondary font-bold',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-orange-500/10 border-orange-500/20 shadow-sm backdrop-blur-xl',
        textClass: 'text-orange-500 font-bold',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-destructive/10 border-destructive/20 shadow-sm backdrop-blur-xl',
        textClass: 'text-destructive font-bold',
    },
    info: {
        icon: Info,
        bgClass: 'glass border-primary/20 shadow-sm backdrop-blur-xl',
        textClass: 'text-primary font-bold',
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
            data-testid="live-session-header"
            data-state={status.type}
            data-recording={status.type === 'recording' || status.type === 'fallback'}
            data-engine={activeEngine || 'none'}
            data-session-saved={displayMessage?.includes('✓') || status.message?.includes('✓')}
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
                    className="flex items-center gap-4 pl-4 border-l border-white/10"
                    data-testid="background-task-indicator"
                >
                    <div className="flex flex-col items-end">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${config.textClass}`}>
                            Private Model
                        </span>
                        <span className={`text-[9px] font-medium opacity-60 ${config.textClass}`}>
                            {modelLoadingProgress === 100 ? 'Cached' : 'Downloading...'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 w-32">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden shadow-inner">
                            <div
                                className="h-full bg-current transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                                style={{
                                    width: `${modelLoadingProgress}%`,
                                    backgroundColor: 'currentColor'
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
