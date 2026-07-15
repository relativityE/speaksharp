import React from 'react';

interface PostSaveToastProps {
    /**
     * Changes to a new value once per successfully finalized+persisted session (the finalized session
     * id, published only at the terminal of finalization). The toast shows exactly once per new value.
     * Null/undefined shows nothing — so it never appears before reconciliation + persistence + the native
     * formatter reach terminal.
     */
    sessionKey: string | number | null | undefined;
    className?: string;
}

/**
 * One-shot post-save completion notice (Track 1). Rendered in NORMAL DOCUMENT FLOW between the recording
 * card and the transcript panel — no fixed/absolute/sticky positioning, no backdrop blur — so it can never
 * cover the transcript or collide with the mobile sticky action bar. Informational only: NO button/CTA
 * (the Analytics action lives on the status bar). aria-live="polite", never steals focus, visible ≥5s,
 * pauses on hover/focus, and dismisses with a smooth bounded fade+collapse (reduced-motion → instant).
 */
export const PostSaveToast: React.FC<PostSaveToastProps> = ({ sessionKey, className = '' }) => {
    const DURATION_MS = 8000;   // ≥ 5s; hover/focus pauses the countdown.
    const COLLAPSE_MS = 260;    // bounded fade+collapse on dismiss (no abrupt page jump).
    const [mounted, setMounted] = React.useState(false);
    const [leaving, setLeaving] = React.useState(false);
    const shownForRef = React.useRef<string | number | null | undefined>(null);
    const dismissTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const collapseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearDismiss = React.useCallback(() => {
        if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    }, []);
    const beginLeave = React.useCallback(() => {
        setLeaving(true);
        collapseTimer.current = setTimeout(() => { setMounted(false); setLeaving(false); }, COLLAPSE_MS);
    }, []);
    const startDismiss = React.useCallback(() => {
        clearDismiss();
        dismissTimer.current = setTimeout(beginLeave, DURATION_MS);
    }, [clearDismiss, beginLeave]);

    // Show once per newly finalized session.
    React.useEffect(() => {
        if (sessionKey === null || sessionKey === undefined) return;
        if (shownForRef.current === sessionKey) return;
        shownForRef.current = sessionKey;
        setLeaving(false);
        setMounted(true);
        startDismiss();
        return () => {
            clearDismiss();
            if (collapseTimer.current) { clearTimeout(collapseTimer.current); collapseTimer.current = null; }
        };
    }, [sessionKey, startDismiss, clearDismiss]);

    if (!mounted) return null;

    // Absolutely anchored to STRADDLE the recording/transcript boundary (parent wrapper is `relative`).
    // Biased up (-translate-y-[78%]) so the toast centers near the gap: its top sits in the recording
    // card's empty bottom padding, its bottom in the transcript card's top padding — ABOVE the left
    // "Live Transcript" heading and clear of the transcript text. Out of flow → cards never move.
    return (
        <div
            data-testid="post-save-toast"
            data-leaving={leaving}
            role="status"
            aria-live="polite"
            tabIndex={-1}
            onMouseEnter={clearDismiss}
            onMouseLeave={startDismiss}
            onFocus={clearDismiss}
            onBlur={startDismiss}
            className={`pointer-events-auto absolute right-3 top-0 z-30 w-[14.5rem] -translate-y-[78%] transition-opacity duration-[240ms] ease-out motion-reduce:transition-none sm:right-4 sm:w-auto sm:max-w-[24rem] ${leaving ? 'opacity-0' : 'opacity-100'} ${className}`}
        >
            {/* Opaque surface — no backdrop blur, so no content shows through. */}
            <div className="rounded-xl border border-primary/45 bg-card px-3.5 py-2 surface-shadow ring-1 ring-primary/10">
                <p className="text-[13px] font-bold leading-tight text-primary sm:text-sm">Next: Analytics</p>
                <p className="mt-0.5 text-[11px] font-medium leading-snug text-foreground/75 sm:text-[13px]">
                    See your trends and deeper feedback.
                </p>
            </div>
        </div>
    );
};

export default PostSaveToast;
