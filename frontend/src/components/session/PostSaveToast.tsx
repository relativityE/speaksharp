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
            className={`overflow-hidden transition-all duration-[260ms] ease-out motion-reduce:transition-none ${leaving ? 'max-h-0 opacity-0' : 'max-h-40 opacity-100'} ${className}`}
        >
            <div className="w-full rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 surface-shadow sm:ml-auto sm:max-w-[28rem]">
                <p className="text-sm font-bold text-primary">Next: Analytics</p>
                <p className="mt-0.5 text-[13px] font-medium leading-snug text-foreground/80">
                    See your trends and deeper feedback.
                </p>
            </div>
        </div>
    );
};

export default PostSaveToast;
