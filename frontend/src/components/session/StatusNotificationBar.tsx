import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle, Lock } from 'lucide-react';

import { SttStatus, SttStatusType } from '../../types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';

interface StatusNotificationBarProps {
    status: SttStatus;
    className?: string;
}

const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string; iconClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'bg-card border-[hsl(var(--border-strong))] shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-[#4B5563]',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-card border-[hsl(var(--border-strong))] shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-success',
    },
    recording: {
        icon: Info,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    paused: {
        icon: Info,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-red-50 border-red-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-destructive',
    },
    'download-required': {
        icon: AlertCircle,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    'init-failed': {
        icon: AlertCircle,
        bgClass: 'bg-red-50 border-red-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-destructive',
    },
    warning: {
        icon: AlertTriangle,
        bgClass: 'bg-amber-50 border-amber-300 shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    info: {
        icon: Info,
        bgClass: 'bg-card border-[hsl(var(--border-strong))] shadow-card',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
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
    const isProminent = status.type === 'download-required' || status.type === 'downloading' || status.type === 'init-failed' || status.type === 'error';

    // Secondary status follows the caller-filtered status so inactive private setup
    // progress does not leak into Basic/Native Browser views.
    const isListening = useSessionStore((s) => s.isListening);
    const activeEngine = useSessionStore((s) => s.activeEngine);
    const modelLoadingProgress = status.progress ?? null;
    const hasSecondary = modelLoadingProgress !== null;

    // Explicit defaults for status display message
    let displayMessage = status.message?.replace(/^(?:⛔|⚠️|🚫)\s*/u, '').trim();
    if (status.type === 'error' && /^error occurred$/i.test(displayMessage || '')) {
        displayMessage = '';
    }
    if (status.type === 'download-required') {
        displayMessage = 'Private model required';
    }

    if (!displayMessage) {
        switch (status.type) {
            case 'idle':
                displayMessage = 'Ready';
                break;
            case 'recording': {
                displayMessage = status.message || 'Recording - speak naturally';
                break;
            }
            case 'ready':
                displayMessage = 'Ready to record';
                break;
            case 'error':
                displayMessage = 'Recording could not start. Check microphone permission and try again.';
                break;
            case 'download-required':
                displayMessage = 'Private model required';
                break;
            case 'downloading':
                displayMessage = 'Downloading private model...';
                break;
            case 'init-failed':
                displayMessage = 'Private setup failed. Retry setup.';
                break;
            case 'info':
                displayMessage = 'Information';
                break;
            default:
                displayMessage = 'Ready';
        }
    }

    const displayDetail = (
        status.type === 'download-required'
            ? 'Download once to use private local transcription in this browser.'
            : status.detail || ''
    );
    const emoji = status.message?.match(/^(?:⛔|⚠️|🚫)/u)?.[0];

    return (
        <div
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 w-full px-4 ${isProminent ? 'py-4' : 'py-3'} rounded-xl border ${config.bgClass} ${className} transition-all duration-300`}
            role="status"
            aria-live="polite"
            data-testid="live-session-header"
            data-state={status.type}
            data-recording={isListening}
            data-engine={activeEngine || 'none'}
            data-session-saved={displayMessage?.includes('✓') || status.message?.includes('✓')}
        >
            {/* Primary Status Indicator */}
            <div className="flex min-w-0 items-start gap-3" data-testid="session-status-indicator">
                <div className="relative mt-0.5 shrink-0">
                    {emoji ? (
                        <span className="text-xl leading-none" role="img" aria-label="status-icon">{emoji}</span>
                    ) : (
                        <Icon className={`h-5 w-5 ${config.iconClass} ${isAnimated ? 'animate-spin' : ''}`} />
                    )}

                    {/* Vault Mode Indicator (Padlock) */}
                    {activeEngine === 'private' && (
                        <div className="absolute -top-1 -right-1 bg-white rounded-full p-0.5 shadow-card border border-[hsl(var(--border-strong))]" title="Vault Mode: On-Device Processing">
                            <Lock className="h-2 w-2 text-success fill-success/20" />
                        </div>
                    )}
                </div>
                <div className="flex min-w-0 flex-col">
                    <span className={`${isProminent ? 'text-sm' : 'text-[13px]'} font-semibold leading-snug ${config.textClass}`} data-testid="status-message-text">
                        {displayMessage}
                    </span>
                    {displayDetail && (
                        <span className={`${isProminent ? 'text-xs' : 'text-[11px]'} font-normal leading-snug text-[#4B5563]`}>
                            {displayDetail}
                        </span>
                    )}
                </div>
            </div>

            {status.isFrozen && (
                <button
                    onClick={() => { void speechRuntimeController.switchToNative(); }}
                    className="sm:ml-4 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-md shadow-card hover:bg-[#D97706] transition-all active:scale-95 border border-primary/30"
                    data-action="switch-to-native"
                >
                    Switch to Native (Basic)
                </button>
            )}

            <div className="hidden sm:block flex-1" />

            {/* Secondary Status Indicator (Background Task) - Far Right */}
            {hasSecondary && (
                <div
                    className="flex w-full items-center gap-3 border-t border-border pt-3 sm:w-auto sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"
                    data-testid="background-task-indicator"
                >
                    <div className="flex flex-col sm:items-end">
                        <span className="text-[11px] font-semibold text-foreground">
                            Private Model
                        </span>
                        <span className="text-[10px] font-normal text-[#4B5563]">
                            {modelLoadingProgress === 100 ? 'Complete' : 'Downloading...'}
                        </span>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-3 sm:w-32 sm:flex-none">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden shadow-inner">
                            <div
                                className="h-full bg-primary transition-all duration-500 ease-out"
                                style={{
                                    width: `${modelLoadingProgress}%`,
                                }}
                            />
                        </div>
                        <span className="min-w-[30px] text-right text-[11px] font-semibold tabular-nums text-foreground">
                            {Math.round(modelLoadingProgress)}%
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StatusNotificationBar;
