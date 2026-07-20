import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle, Lock, ArrowRight } from 'lucide-react';

import { SttStatus, SttStatusType } from '../../types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';
import { speechRuntimeController } from '../../services/SpeechRuntimeController';

// prefers-reduced-motion, reactive + SSR/jsdom-safe. Used to SKIP the pulse entirely for reduced-motion
// users (they get the persistent static emphasis immediately).
function usePrefersReducedMotion(): boolean {
    const query = '(prefers-reduced-motion: reduce)';
    const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches : false;
    const [reduced, setReduced] = React.useState<boolean>(get);
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(query);
        const onChange = () => setReduced(mq.matches);
        onChange();
        mq.addEventListener?.('change', onChange);
        return () => mq.removeEventListener?.('change', onChange);
    }, []);
    return reduced;
}

interface StatusNotificationBarProps {
    status: SttStatus;
    className?: string;
    /**
     * Post-save Analytics action folded into this single status bar (replaces the separate
     * post-save-review-actions surface). Reuses the existing /analytics destination — NOT a new button.
     *
     * `cueKey` is SESSION-SCOPED: pass the finalized session's id (or any value that changes once per
     * newly finalized session). A change in cueKey fires the bounded, reduced-motion-safe cue exactly
     * once — so a second session finalized WITHOUT unmounting SessionPage re-triggers it. Leave it
     * undefined for no cue.
     */
    analyticsAction?: {
        cueKey?: string | number;
        onSelect?: () => void;
    };
    /**
     * Existing Native→Private nudge, folded into this bar as the QUIET secondary action (left of the
     * Analytics action, which stays rightmost). SessionPage decides visibility (post-save + Native +
     * canUsePrivateStt); when omitted, nothing renders. Preserves the existing copy + setMode('private')
     * action. On mobile the bar stacks (flex-col), so this sits within the same surface — never a new one.
     */
    privateCta?: {
        onSelect: () => void;
    };
}

const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string; iconClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'bg-card border-[hsl(var(--border-strong))] surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-muted-foreground',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-card border-[hsl(var(--border-strong))] surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-success',
    },
    // #891 immediate-start gate: mic warming after Record — "Starting…", not yet "Speak now".
    warming: {
        icon: Loader2,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    recording: {
        icon: Info,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    paused: {
        icon: Info,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-red-50 border-red-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-destructive',
    },
    'download-required': {
        icon: AlertCircle,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    'init-failed': {
        icon: AlertCircle,
        bgClass: 'bg-red-50 border-red-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-destructive',
    },
    warning: {
        icon: AlertTriangle,
        bgClass: 'bg-amber-50 border-amber-300 surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
    info: {
        icon: Info,
        bgClass: 'bg-card border-[hsl(var(--border-strong))] surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-primary',
    },
};

/**
 * Persistent status bar showing STT state transitions.
 * Displays above the Live Recording card to inform users of initialization,
 * fallback, and error states.
 */
export const StatusNotificationBar: React.FC<StatusNotificationBarProps> = ({ status, className = '', analyticsAction, privateCta }) => {
    // Primary Status Configuration
    const config = statusConfig[status.type];
    const Icon = config.icon;
    const isAnimated = status.type === 'initializing' || status.type === 'downloading';
    const isProminent = status.type === 'download-required' || status.type === 'downloading' || status.type === 'init-failed' || status.type === 'error';

    // Secondary status follows the caller-filtered status so inactive private setup
    // progress does not leak into Free/Native Browser views.
    const isListening = useSessionStore((s) => s.isListening);
    const activeEngine = useSessionStore((s) => s.activeEngine);

    // Bounded, SESSION-SCOPED post-save cue on the Analytics action. Keyed on the finalized session id
    // (cueKey) so each newly finalized session fires it once — including a second session finalized
    // without unmounting. Phases:
    //   'pulsing'    — motion users only, ~6.5s bounded pulse (never indefinite).
    //   'persistent' — after the pulse (or IMMEDIATELY for reduced-motion): a static, non-animated,
    //                  visibly-actionable green emphasis that STAYS until the user clicks or the page
    //                  unmounts (leaving the session). This is what keeps Analytics discoverable.
    //   'idle'       — no cue (before a finalized session, or after the user has clicked Analytics).
    const cueKey = analyticsAction?.cueKey;
    const prefersReducedMotion = usePrefersReducedMotion();
    const [cuePhase, setCuePhase] = React.useState<'idle' | 'pulsing' | 'persistent'>('idle');
    // The pulse→persistent timer lives in a ref so clearCue() (on click) can cancel it. Without this a
    // click DURING the pulse leaves the pending timeout alive, and ~6.5s later it would REACTIVATE the cue
    // (→ persistent) even though the user already dismissed it.
    const pulseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearPulseTimer = React.useCallback(() => {
        if (pulseTimerRef.current !== null) { clearTimeout(pulseTimerRef.current); pulseTimerRef.current = null; }
    }, []);
    React.useEffect(() => {
        clearPulseTimer();
        if (cueKey === undefined || cueKey === null) { setCuePhase('idle'); return; }
        // Reduced motion: never pulse — show the persistent static green emphasis immediately.
        if (prefersReducedMotion) { setCuePhase('persistent'); return; }
        setCuePhase('pulsing');
        pulseTimerRef.current = setTimeout(() => {
            pulseTimerRef.current = null;
            // Guard: only promote a STILL-pulsing cue. If it was cleared (click) or replaced by a new
            // session, do nothing — never resurrect a dismissed/stale cue.
            setCuePhase((prev) => (prev === 'pulsing' ? 'persistent' : prev));
        }, 6500);
        return () => clearPulseTimer();
    }, [cueKey, prefersReducedMotion, clearPulseTimer]);
    const cueActive = cuePhase !== 'idle'; // emphasized (pulsing OR persistent) until click/unmount
    const clearCue = React.useCallback(() => { clearPulseTimer(); setCuePhase('idle'); }, [clearPulseTimer]);
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
                displayMessage = 'Private transcription could not finish setup.';
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
            ? 'Set up the Private model in this browser. All audio processing remains local.'
            : status.type === 'init-failed'
                ? status.detail || 'Check microphone permission and browser storage, then retry setup. All audio processing remains local.'
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

                    {/* Private transcription indicator (padlock) */}
                    {activeEngine === 'private' && (
                        <div className="absolute -top-1 -right-1 bg-white rounded-full p-0.5 surface-shadow border border-[hsl(var(--border-strong))]" title="Private transcription: on-device processing">
                            <Lock className="h-2 w-2 text-success fill-success/20" />
                        </div>
                    )}
                </div>
                <div className="flex min-w-0 flex-col">
                    <span className={`${isProminent ? 'text-sm' : 'text-[13px]'} font-semibold leading-snug ${config.textClass}`} data-testid="status-message-text">
                        {displayMessage}
                    </span>
                    {displayDetail && (
                        <span className={`${isProminent ? 'text-xs' : 'text-[11px]'} font-medium leading-snug text-foreground/70`}>
                            {displayDetail}
                        </span>
                    )}
                </div>
            </div>

            {status.isFrozen && (
                <button
                    onClick={() => { void speechRuntimeController.switchToNative(); }}
                    className="sm:ml-4 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-md surface-shadow hover:bg-primary/90 transition-all active:scale-95 border border-primary/30"
                    data-action="switch-to-native"
                >
                    Switch to Browser
                </button>
            )}

            <div className="hidden sm:block flex-1" />

            {/* Post-save actions. Mobile: ONE compact row below the message — Private CTA left, Analytics
                pushed right (rightmost). Desktop: inline on the right. Analytics always rightmost + carries
                the cue. Tap targets ≥ min-h-9; visible keyboard focus rings. */}
            {(privateCta || analyticsAction) && (
                <div className="flex w-full items-center gap-3 sm:w-auto">
                    {/* Quiet secondary Native→Private nudge — muted so Analytics stays primary. */}
                    {privateCta && (
                        <button
                            type="button"
                            onClick={() => privateCta.onSelect()}
                            data-testid="post-save-private-cta"
                            className="inline-flex min-h-9 items-center rounded-md px-2 py-1.5 text-left text-[13px] font-medium leading-snug text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            Try Private — the main beta experience
                        </button>
                    )}

                    {/* Existing /analytics destination; bounded then PERSISTENT success-green cue; no new button.
                        - pulsing (motion only): bounded ~6.5s pulse over the green emphasis.
                        - persistent: static, non-animated success-green emphasis (subtle bg + ring) that
                          stays actionable until the user clicks Analytics or leaves the session page.
                        - reduced-motion: skips the pulse and shows the persistent static emphasis at once. */}
                    {analyticsAction && (
                        <Link
                            to="/analytics"
                            onClick={() => { clearCue(); analyticsAction.onSelect?.(); }}
                            // Middle-click (open-in-new-tab) does not fire onClick; clear the cue here too so
                            // no click variant leaves a live timer that could reactivate it. (Cmd/Ctrl-click
                            // still fires onClick above.)
                            onAuxClick={(e) => { if (e.button === 1) clearCue(); }}
                            data-testid="post-save-review-session-link"
                            data-cue-active={cueActive}
                            data-cue-phase={cuePhase}
                            // Accessible success-green: emerald-800 (light) / emerald-300 (dark) both measure
                            // >=4.5:1 against the pale-green pill background (the prior --success green was only
                            // ~3.7:1 at 13px). Subtle green bg + ring retained; visual weight unchanged (font-bold).
                            className={`ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-bold text-emerald-800 dark:text-emerald-300 underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:ml-0 ${
                                cuePhase === 'pulsing'
                                    ? 'bg-[hsl(var(--success)/0.1)] ring-1 ring-[hsl(var(--success)/0.4)] motion-safe:animate-pulse motion-reduce:animate-none'
                                    : cuePhase === 'persistent'
                                        ? 'bg-[hsl(var(--success)/0.1)] ring-1 ring-[hsl(var(--success)/0.4)]'
                                        : ''
                            }`}
                        >
                            Analytics
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                    )}
                </div>
            )}

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
                        <span className="text-[10px] font-medium text-foreground/70">
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
