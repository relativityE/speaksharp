import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle, Lock, ArrowRight } from 'lucide-react';

import { SttStatus, SttStatusType } from '../../types/transcription';
import { useSessionStore } from '@/stores/useSessionStore';

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
}

const statusConfig: Record<SttStatusType, { icon: React.ElementType; bgClass: string; textClass: string; iconClass: string }> = {
    idle: {
        icon: Info,
        bgClass: 'bg-card border-neutral-border-strong surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-muted-foreground',
    },
    initializing: {
        icon: Loader2,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    downloading: {
        icon: Loader2,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    ready: {
        icon: CheckCircle2,
        bgClass: 'bg-card border-neutral-border-strong surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-status',
    },
    // #891 immediate-start gate: mic warming after Record — "Starting…", not yet "Speak now".
    warming: {
        icon: Loader2,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    recording: {
        icon: Info,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    paused: {
        icon: Info,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    fallback: {
        icon: AlertTriangle,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    error: {
        icon: AlertCircle,
        bgClass: 'bg-state-error-ground border-state-error-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-state-error',
    },
    'download-required': {
        icon: AlertCircle,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    'init-failed': {
        icon: AlertCircle,
        bgClass: 'bg-state-error-ground border-state-error-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-state-error',
    },
    warning: {
        icon: AlertTriangle,
        bgClass: 'bg-neutral-band border-neutral-border surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
    info: {
        icon: Info,
        bgClass: 'bg-card border-neutral-border-strong surface-shadow',
        textClass: 'text-foreground',
        iconClass: 'text-neutral-heading',
    },
};

/**
 * Persistent status bar showing STT state transitions.
 * Displays above the Live Recording card to inform users of initialization,
 * fallback, and error states.
 */
export const StatusNotificationBar: React.FC<StatusNotificationBarProps> = ({ status, className = '', analyticsAction }) => {
    // Primary Status Configuration
    const config = statusConfig[status.type];
    const Icon = config.icon;
    const isAnimated = status.type === 'initializing' || status.type === 'downloading';
    const isProminent = status.type === 'download-required' || status.type === 'downloading' || status.type === 'init-failed' || status.type === 'error';
    // #1047: AMBIENT status must RECEDE. At rest this bar said "Mic ready" as a full-width white card
    // with a shadow — identical surface treatment to the recorder card itself, so a passive
    // acknowledgement carried the same visual weight as the thing you actually came here to use.
    // Only the two at-rest states are demoted: the success-state ground and border, status-green
    // 14px/700 text and NO shadow. Every attention-worthy state (warming/recording/downloading/
    // warning/error/init-failed) keeps its existing prominence untouched.
    //
    // CRITICAL CARVE-OUT: this same bar is ALSO the single post-save surface — SessionPage emits
    // `{ type: 'ready', message: reconciliationCopy }` once a session finalizes, and hangs the
    // reconciliation copy and Analytics action off it. That is the most
    // consequential thing on the page at that moment, and demoting it by status TYPE alone would have
    // buried it in the ambient wash. The presence of either action is the reliable signal that this is
    // the post-save bar rather than idle chrome, so it keeps full prominence.
    const carriesPostSaveActions = Boolean(analyticsAction);
    const isQuiet = (status.type === 'ready' || status.type === 'idle') && !carriesPostSaveActions;

    // Secondary status follows the caller-filtered status so inactive Private setup progress does not leak.
    const isListening = useSessionStore((s) => s.isListening);
    const activeEngine = useSessionStore((s) => s.activeEngine);

    // Bounded, SESSION-SCOPED post-save cue on the Analytics action. Keyed on the finalized session id
    // (cueKey) so each newly finalized session fires it once — including a second session finalized
    // without unmounting. Phases:
    //   'pulsing'    — motion users only, ~6.5s bounded pulse (never indefinite).
    //   'persistent' — after the pulse (or IMMEDIATELY for reduced-motion): a static, non-animated,
    //                  visibly-actionable signature emphasis that STAYS until the user clicks or the page
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
        // Reduced motion: never pulse — show the persistent static emphasis immediately.
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
            // Spacing is the CALLER's business: `className` is concatenated, not twMerge'd, so a margin
            // baked in here could not be overridden and silently inserted 26px before whatever the page
            // renders next (the unresolved-recovery banner, in SessionPage's case).
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 w-full border transition-all duration-300 ${
                isQuiet
                    ? 'rounded-[10px] px-[18px] py-[12px] bg-state-success-ground border-state-success-border'
                    : `rounded-xl px-4 ${isProminent ? 'py-4' : 'py-3'} ${config.bgClass}`
            } ${className}`}
            role="status"
            aria-live="polite"
            data-testid="live-session-header"
            data-state={status.type}
            data-quiet={isQuiet ? 'true' : 'false'}
            data-recording={isListening}
            data-engine={activeEngine || 'none'}
            data-session-saved={displayMessage?.includes('✓') || status.message?.includes('✓')}
        >
            {/* Primary Status Indicator */}
            <div className="flex min-w-0 items-start gap-3" data-testid="session-status-indicator">
                <div className="relative mt-0.5 shrink-0">
                    {emoji ? (
                        <span className="text-xl leading-none" role="img" aria-label="status-icon">{emoji}</span>
                    ) : isQuiet ? (
                        // Small circular check — a quiet acknowledgement, not an alert.
                        <CheckCircle2 className="h-4 w-4 text-status" aria-hidden="true" />
                    ) : (
                        <Icon className={`h-5 w-5 ${config.iconClass} ${isAnimated ? 'animate-spin' : ''}`} />
                    )}

                    {/* Private transcription indicator (padlock) */}
                    {activeEngine === 'private' && (
                        <div className="absolute -top-1 -right-1 bg-white rounded-full p-0.5 surface-shadow border border-neutral-border-strong" title="Private transcription: on-device processing">
                            <Lock className="h-2 w-2 text-status fill-state-success-ground" />
                        </div>
                    )}
                </div>
                <div className="flex min-w-0 flex-col">
                    <span className={isQuiet
                        ? 'text-[14px] font-bold leading-snug text-status'
                        : `${isProminent ? 'text-sm' : 'text-[13px]'} font-semibold leading-snug ${config.textClass}`
                    } data-testid="status-message-text">
                        {displayMessage}
                    </span>
                    {displayDetail && (
                        <span className={`${isProminent ? 'text-xs' : 'text-[11px]'} font-medium leading-snug text-foreground/70`}>
                            {displayDetail}
                        </span>
                    )}
                </div>
            </div>

            <div className="hidden sm:block flex-1" />

            {/* Post-save actions. Mobile: ONE compact row below the message — Private CTA left, Analytics
                pushed right (rightmost). Desktop: inline on the right. Analytics always rightmost + carries
                the cue. Tap targets ≥ min-h-9; visible keyboard focus rings. */}
            {analyticsAction && (
                <div className="flex w-full items-center gap-3 sm:w-auto">

                    {/* Existing /analytics destination; bounded then PERSISTENT signature cue; no new button.
                        - pulsing (motion only): bounded ~6.5s pulse over the signature emphasis.
                        - persistent: static, non-animated signature emphasis (ground + ring) that
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
                            // #1480: links are never green. signature-text on the signature-ground pill is 5.6:1
                            // at 13px; visual weight unchanged (font-bold).
                            className={`ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-bold text-signature-text underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:ml-0 ${
                                cuePhase === 'pulsing'
                                    ? 'bg-signature-ground ring-1 ring-signature-border motion-safe:animate-pulse motion-reduce:animate-none'
                                    : cuePhase === 'persistent'
                                        ? 'bg-signature-ground ring-1 ring-signature-border'
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
